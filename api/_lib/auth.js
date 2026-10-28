import crypto from "crypto";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, "Server is not configured (AUTH_SECRET missing).");
  return s;
}

const b64 = b => Buffer.from(b).toString("base64url");

export function sign(payload, ttlMs) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const good = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function bearer(req) {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export function hmac(text) {
  return crypto.createHmac("sha256", secret()).update(String(text)).digest("hex");
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function adminPasswordOk(pw) {
  const real = process.env.ADMIN_PASSWORD;
  return !!real && real.length >= 4 && safeEqual(pw || "", real);
}

export function isAdmin(req) {
  const p = verify(String(req.headers["x-admin"] || ""));
  return !!(p && p.adm);
}
