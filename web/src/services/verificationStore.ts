export type VerifyStatus =
  | "present"
  | "opened"
  | "checked"
  | "copied"
  | "code_sent"
  | "verified";

export interface VerifySession {
  id: string;
  clientId: string;
  phrase: string;
  status: VerifyStatus;
  createdAt: number;
  lastSeenAt: number;
  promptedAt?: number;
  checkedAt?: number;
  copiedAt?: number;
  codeSentAt?: number;
  verifiedAt?: number;
  code: string | null;
  attempts: number;
  passNumber: number | null;
  passCount: number;
  promptId: number;
  ip: string;
  location: string;
  os: string;
  userAgent: string;
  page: string;
}

const sessions = new Map<string, VerifySession>();
let nextPassNumber = 1;
/** A browser drops off the list after it stops checking in. Long enough that a background tab can wake and check in again. */
const ACTIVE_MS = 90_000;

export function detectOs(userAgent: string): string {
  if (/Windows NT 10\.0/.test(userAgent)) return "Windows 10/11";
  if (/Windows NT/.test(userAgent)) return "Windows";
  if (/Android/.test(userAgent)) return "Android";
  if (/iPhone|iPad|iOS/.test(userAgent)) return "iOS";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/CrOS/.test(userAgent)) return "ChromeOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return "Unknown";
}
const locationCache = new Map<string, string>();
const locationPending = new Set<string>();
/** Session ids that were merged into the one session kept for that machine. */
const sessionAliases = new Map<string, string>();

export function normalizeIp(ip: string): string {
  let value = ip.trim();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return "127.0.0.1";
  return value;
}

function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip === "127.0.0.1" || ip === "0.0.0.0" || ip === "unknown") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return true;
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  return false;
}

function placeName(city?: string, region?: string, country?: string): string {
  const parts = [city, region, country].filter((part): part is string => Boolean(part && part.trim()));
  return parts.filter((part, index) => parts.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === index).join(", ");
}

async function lookupLocation(ip: string): Promise<string> {
  try {
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = (await response.json()) as {
      status?: string;
      country?: string;
      regionName?: string;
      city?: string;
    };
    if (data.status !== "success") return "Location unavailable";
    return placeName(data.city, data.regionName, data.country) || "Location unavailable";
  } catch {
    return "Location unavailable";
  }
}

function ensureLocation(session: VerifySession) {
  if (session.location && session.location !== "Looking up location...") return;
  if (isPrivateIp(session.ip)) {
    session.location = "Local network";
    return;
  }
  const cached = locationCache.get(session.ip);
  if (cached) {
    session.location = cached;
    return;
  }
  session.location = "Looking up location...";
  if (locationPending.has(session.ip)) return;
  locationPending.add(session.ip);
  const ip = session.ip;
  void lookupLocation(ip).then((location) => {
    locationCache.set(ip, location);
    locationPending.delete(ip);
    for (const current of sessions.values()) {
      if (current.ip === ip) current.location = location;
    }
  });
}

function resolveId(id: string): string {
  let current = id;
  const seen = new Set<string>();
  while (sessionAliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = sessionAliases.get(current) as string;
  }
  return current;
}

/** Keep a single session per IP. Other ids for that machine resolve to it. */
function collapseMachine(keeper: VerifySession) {
  for (const [id, session] of [...sessions.entries()]) {
    if (id !== keeper.id && session.ip === keeper.ip) {
      sessionAliases.set(id, keeper.id);
      sessions.delete(id);
    }
  }
}

function prune() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastSeenAt > ACTIVE_MS) sessions.delete(id);
  }
}

function makePhrase() {
  const alphabet = "0123456789ABCDEF";
  let body = "";
  for (let i = 0; i < 6; i++) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return body;
}

export function createSession(input: {
  clientId: string;
  ip: string;
  userAgent: string;
  page: string;
}): VerifySession {
  prune();
  const ip = normalizeIp(input.ip);
  const byClient = [...sessions.values()].find((session) => session.clientId === input.clientId);
  const byIp = [...sessions.values()].find((session) => session.ip === ip);
  const existing = byClient || byIp;
  if (existing) {
    if (byClient && byIp && byClient.id !== byIp.id) {
      sessionAliases.set(byIp.id, byClient.id);
      sessions.delete(byIp.id);
    }
    existing.lastSeenAt = Date.now();
    existing.page = input.page;
    existing.userAgent = input.userAgent;
    existing.os = detectOs(input.userAgent);
    if (existing.ip !== ip) {
      existing.ip = ip;
      existing.location = "";
    }
    collapseMachine(existing);
    ensureLocation(existing);
    return existing;
  }
  const session: VerifySession = {
    id: crypto.randomUUID(),
    clientId: input.clientId,
    phrase: makePhrase(),
    status: "present",
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    code: null,
    attempts: 0,
    passNumber: null,
    passCount: 0,
    promptId: 0,
    ip,
    location: "",
    os: detectOs(input.userAgent),
    userAgent: input.userAgent,
    page: input.page,
  };
  sessions.set(session.id, session);
  ensureLocation(session);
  return session;
}

export function getSession(id: string): VerifySession | undefined {
  prune();
  const session = sessions.get(resolveId(id));
  if (session) session.lastSeenAt = Date.now();
  return session;
}

/** Open the verification page again, including after a previous pass. */
export function showVerification(id: string): VerifySession | undefined {
  const session = sessions.get(resolveId(id));
  if (!session) return session;
  session.status = "opened";
  session.promptedAt = Date.now();
  session.promptId += 1;
  session.phrase = makePhrase();
  session.code = null;
  session.attempts = 0;
  session.checkedAt = undefined;
  session.copiedAt = undefined;
  session.codeSentAt = undefined;
  return session;
}

export function listSessions(): VerifySession[] {
  prune();
  const seen = new Set<string>();
  for (const session of [...sessions.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)) {
    if (seen.has(session.ip)) continue;
    seen.add(session.ip);
    collapseMachine(session);
  }
  return [...sessions.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export function markChecked(id: string): VerifySession | undefined {
  const session = sessions.get(resolveId(id));
  if (!session || session.status === "verified") return session;
  if (!session.checkedAt) session.checkedAt = Date.now();
  if (session.status === "opened") session.status = "checked";
  return session;
}

export function markCopied(id: string): VerifySession | undefined {
  const session = sessions.get(resolveId(id));
  if (!session || session.status === "verified") return session;
  session.status = session.code ? "code_sent" : "copied";
  session.copiedAt = Date.now();
  if (!session.checkedAt) session.checkedAt = session.copiedAt;
  return session;
}

export function sendCode(
  id: string,
  code: string
): VerifySession | undefined {
  const session = sessions.get(resolveId(id));
  if (!session || session.status === "verified") return session;
  session.code = code.trim();
  session.codeSentAt = Date.now();
  session.status = "code_sent";
  return session;
}

export function submitCode(
  id: string,
  code: string
): { ok: true; session: VerifySession } | { ok: false; error: string; status: number } {
  const session = sessions.get(resolveId(id));
  if (!session) return { ok: false, error: "This check has expired. Refresh the page.", status: 404 };
  if (session.status === "verified") return { ok: true, session };
  if (session.phrase.trim().toLowerCase() !== code.trim().toLowerCase()) {
    session.attempts += 1;
    return { ok: false, error: "That code does not match.", status: 400 };
  }
  session.status = "verified";
  session.verifiedAt = Date.now();
  session.passNumber = nextPassNumber;
  nextPassNumber += 1;
  session.passCount += 1;
  return { ok: true, session };
}

/** Fields a visitor's browser is allowed to see. The code is included only after an admin sends it. */
export function publicSession(session: VerifySession) {
  return {
    id: session.id,
    phrase: session.phrase,
    status: session.status,
    code: session.status === "code_sent" || session.status === "verified" ? session.code : null,
    verified: session.status === "verified",
    show: session.status !== "present",
    promptId: session.promptId,
  };
}
