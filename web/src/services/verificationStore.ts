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
  /** When this browser was last opened automatically. Stops a second automatic open in the same window. */
  autoPromptedAt?: number;
  ip: string;
  location: string;
  os: string;
  userAgent: string;
  page: string;
  /** False once the visitor closes the page. A tab left open in the background still counts. */
  visible?: boolean;
}

const sessions = new Map<string, VerifySession>();
let nextPassNumber = 1;
/** A browser drops off the list after it stops checking in. Short so a closed page does not stay on the list. */
const ACTIVE_MS = 12_000;
/** After a pass, automatic mode waits this long before opening the check again. The admin can change it. */
const DEFAULT_AGAIN_MS = 24 * 60 * 60 * 1000;
const MIN_AGAIN_MS = 5_000;
const MAX_AGAIN_MS = 30 * 24 * 60 * 60 * 1000;

export type PromptMode = "manual" | "automatic";
let promptMode: PromptMode = "manual";
let autoAgainMs = DEFAULT_AGAIN_MS;

export function getPromptMode(): PromptMode {
  return promptMode;
}

export function setPromptMode(mode: PromptMode) {
  promptMode = mode;
}

export function getAutoAgainMs(): number {
  return autoAgainMs;
}

export function setAutoAgainMs(ms: number) {
  autoAgainMs = Math.min(MAX_AGAIN_MS, Math.max(MIN_AGAIN_MS, Math.round(ms)));
}

export function detectOs(userAgent: string, platformHint = ""): string {
  const hint = platformHint.trim().replace(/^"|"$/g, "");
  if (/^mac/i.test(hint) || hint === "MacIntel") return "macOS";
  if (/android/i.test(hint)) return "Android";
  if (/iphone|ipad|^ios$/i.test(hint)) return "iOS";
  if (/windows/i.test(hint)) return /Windows NT 10\.0/.test(userAgent) ? "Windows 10/11" : "Windows";
  if (/cros|chrome os/i.test(hint)) return "ChromeOS";
  if (/linux/i.test(hint)) return "Linux";
  if (/Windows NT 10\.0/.test(userAgent)) return "Windows 10/11";
  if (/Windows NT/.test(userAgent)) return "Windows";
  if (/Android/.test(userAgent)) return "Android";
  if (/iPhone|iPad|iOS/.test(userAgent)) return "iOS";
  if (/Macintosh|Mac OS X|macOS/.test(userAgent)) return "macOS";
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

/** Keep one session per IP and operating system. A Mac and a Linux computer can share an address. */
function collapseMachine(keeper: VerifySession) {
  for (const [id, session] of [...sessions.entries()]) {
    if (id !== keeper.id && session.ip === keeper.ip && session.os === keeper.os) {
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
  platform?: string;
  /** When this browser last passed. The page remembers this for 24 hours. */
  passedAt?: number | null;
  page: string;
  visible?: boolean;
}): VerifySession | undefined {
  prune();
  const visible = input.visible !== false;
  const ip = normalizeIp(input.ip);
  const os = detectOs(input.userAgent, input.platform || "");
  const byClient = [...sessions.values()].find((session) => session.clientId === input.clientId);
  const sameMachine = [...sessions.values()].find(
    (session) => session.ip === ip && (session.os === os || session.os === "Unknown" || os === "Unknown")
  );
  const existing = byClient || sameMachine;
  if (existing) {
    if (byClient && sameMachine && byClient.id !== sameMachine.id && (byClient.os === sameMachine.os || sameMachine.os === "Unknown")) {
      sessionAliases.set(sameMachine.id, byClient.id);
      sessions.delete(sameMachine.id);
    }
    existing.lastSeenAt = Date.now();
    existing.visible = visible;
    existing.page = input.page;
    existing.userAgent = input.userAgent;
    if (os !== "Unknown") existing.os = os;
    if (existing.ip !== ip) {
      existing.ip = ip;
      existing.location = "";
    }
    collapseMachine(existing);
    ensureLocation(existing);
    if (!visible) return existing;
    return considerAutoShow(existing, input.passedAt ?? null);
  }
  if (!visible) return undefined;
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
    os,
    userAgent: input.userAgent,
    page: input.page,
    visible: true,
  };
  sessions.set(session.id, session);
  ensureLocation(session);
  return considerAutoShow(session, input.passedAt ?? null);
}

/** Open once on arrival, then once more after the admin's reopen time. Manual mode never does this. */
function considerAutoShow(session: VerifySession, passedAt: number | null): VerifySession {
  if (promptMode !== "automatic") return session;
  const now = Date.now();
  const due = passedAt == null || now - passedAt >= autoAgainMs;
  if (!due) return session;
  const windowStart = passedAt == null ? 0 : passedAt + autoAgainMs;
  if (session.autoPromptedAt && session.autoPromptedAt >= windowStart) return session;
  const opened = showVerification(session.id);
  return opened || session;
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
  session.autoPromptedAt = Date.now();
  return session;
}

export function listSessions(): VerifySession[] {
  prune();
  const seen = new Set<string>();
  for (const session of [...sessions.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)) {
    const key = `${session.ip}\n${session.os}`;
    if (seen.has(key)) continue;
    seen.add(key);
    collapseMachine(session);
  }
  const now = Date.now();
  return [...sessions.values()]
    .filter((session) => session.visible !== false && now - session.lastSeenAt <= ACTIVE_MS)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
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
