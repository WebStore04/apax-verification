import { Router, Request, Response, NextFunction } from "express";
import {
  createSession,
  getSession,
  listSessions,
  markChecked,
  markCopied,
  publicSession,
  sendCode,
  showVerification,
  submitCode,
  normalizeIp,
} from "../services/verificationStore";

const router = Router();
const adminTokens = new Map<string, number>();

function adminCredentials() {
  const adminId = process.env.VERIFY_ADMIN_ID || (process.env.NODE_ENV === "production" ? "" : "admin");
  const password = process.env.VERIFY_ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "!@#QWEASDZXC");
  return { adminId, password };
}

function clientIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return normalizeIp(forwarded.split(",")[0].trim());
  }
  return normalizeIp(req.ip || req.socket.remoteAddress || "unknown");
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.header("x-admin-token") || "";
  const expires = adminTokens.get(token);
  if (!token || !expires || expires < Date.now()) {
    adminTokens.delete(token);
    return res.status(401).json({ error: "Log in again." });
  }
  next();
}

router.post("/admin/login", (req: Request, res: Response) => {
  const { adminId, password } = adminCredentials();
  if (!adminId || !password) {
    return res.status(503).json({ error: "Set VERIFY_ADMIN_ID and VERIFY_ADMIN_PASSWORD first." });
  }
  const providedId = typeof req.body?.adminId === "string" ? req.body.adminId : "";
  const providedPassword = typeof req.body?.password === "string" ? req.body.password : "";
  if (providedId !== adminId || providedPassword !== password) {
    return res.status(401).json({ error: "Admin ID or password was not accepted." });
  }
  const token = crypto.randomUUID();
  adminTokens.set(token, Date.now() + 12 * 60 * 60 * 1000);
  res.json({ token });
});

router.post("/sessions", (req: Request, res: Response) => {
  const page = typeof req.body?.page === "string" ? req.body.page.slice(0, 200) : "/";
  const clientId = typeof req.body?.clientId === "string" ? req.body.clientId.slice(0, 80) : "";
  if (!/^[A-Za-z0-9-]{8,80}$/.test(clientId)) {
    return res.status(400).json({ error: "Missing visitor id." });
  }
  const session = createSession({
    clientId,
    ip: clientIp(req),
    userAgent: (req.headers["user-agent"] || "").slice(0, 300),
    page,
  });
  res.status(201).json(publicSession(session));
});

router.get("/sessions/:id", (req: Request, res: Response) => {
  const session = getSession(String(req.params.id));
  if (!session) return res.status(404).json({ error: "This check has expired. Refresh the page." });
  res.json(publicSession(session));
});

router.post("/sessions/:id/check", (req: Request, res: Response) => {
  const session = markChecked(String(req.params.id));
  if (!session) return res.status(404).json({ error: "This check has expired. Refresh the page." });
  res.json(publicSession(session));
});

router.post("/sessions/:id/copy", (req: Request, res: Response) => {
  const session = markCopied(String(req.params.id));
  if (!session) return res.status(404).json({ error: "This check has expired. Refresh the page." });
  res.json(publicSession(session));
});

router.post("/sessions/:id/submit", (req: Request, res: Response) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code.trim()) return res.status(400).json({ error: "Enter the code from the capture." });
  const result = submitCode(String(req.params.id), code);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json(publicSession(result.session));
});

router.get("/admin/sessions", requireAdmin, (_req: Request, res: Response) => {
  res.json({ sessions: listSessions() });
});

router.post("/admin/sessions/:id/show", requireAdmin, (req: Request, res: Response) => {
  const session = getSession(String(req.params.id));
  if (!session) return res.status(404).json({ error: "That visitor is no longer on the page." });
  const updated = showVerification(session.id);
  res.json({ session: updated });
});

router.post("/admin/sessions/:id/code", requireAdmin, (req: Request, res: Response) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!/^[A-Za-z0-9-]{4,12}$/.test(code)) {
    return res.status(400).json({ error: "Use 4 to 12 letters or numbers." });
  }
  const session = getSession(String(req.params.id));
  if (!session) return res.status(404).json({ error: "That visitor is no longer waiting." });
  if (session.status === "verified") {
    return res.status(409).json({ error: "This visitor already finished the check." });
  }
  const updated = sendCode(session.id, code);
  res.json({ session: updated });
});

export default router;
