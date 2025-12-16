import crypto from "crypto";

const { SESSION_SECRET } = process.env;

export function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((s) => s.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

export function signSession(payload) {
  if (!SESSION_SECRET) throw new Error("Missing SESSION_SECRET");
  const json = JSON.stringify({ ...payload, iat: Date.now() });
  const b64 = Buffer.from(json).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function verifySession(token) {
  if (!SESSION_SECRET) return null;
  const [b64, sig] = String(token || "").split(".");
  if (!b64 || !sig) return null;

  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  if (sig !== expected) return null;

  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function requireSession(req) {
  const token = getCookie(req, "fp_session");
  return token ? verifySession(token) : null;
}

export function setJson(res, status, data, cookie) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.end(JSON.stringify(data));
}

export function makeSessionCookie(token, maxAgeSeconds = 60 * 60 * 8) {
  // 8 ore (meglio per sanità)
  return [
    `fp_session=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function clearSessionCookie() {
  return [
    "fp_session=",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}
