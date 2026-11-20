import http from "node:http"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
])

/** The browser talks to the site. This forwards /verify to the local API and keeps the visitor address. */
async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params
  const suffix = path.map((part) => encodeURIComponent(part)).join("/")
  const target = new URL(`http://127.0.0.1:4000/verify${suffix ? `/${suffix}` : ""}${request.nextUrl.search}`)
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    if (!HOP.has(key.toLowerCase())) headers[key] = value
  })
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer())

  try {
    const upstream = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>(
      (resolve, reject) => {
        const upstreamRequest = http.request(
          target,
          { method: request.method, headers },
          (upstreamResponse) => {
            const chunks: Buffer[] = []
            upstreamResponse.on("data", (chunk: Buffer) => chunks.push(chunk))
            upstreamResponse.on("end", () => {
              resolve({
                status: upstreamResponse.statusCode || 502,
                headers: upstreamResponse.headers,
                body: Buffer.concat(chunks),
              })
            })
          }
        )
        upstreamRequest.on("error", reject)
        if (body && body.length > 0) upstreamRequest.write(body)
        upstreamRequest.end()
      }
    )

    const out = new Headers()
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (!key || HOP.has(key.toLowerCase()) || value === undefined) continue
      out.set(key, Array.isArray(value) ? value.join(", ") : value)
    }
    const payload = upstream.status === 204 || upstream.body.length === 0 ? null : upstream.body
    return new NextResponse(payload, { status: upstream.status, headers: out })
  } catch (error) {
    console.error("Verify proxy failed", target.href, error)
    return NextResponse.json({ error: "The check could not be completed." }, { status: 502 })
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const OPTIONS = proxy
