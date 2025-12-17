import crypto from "crypto";

const { SESSION_SECRET } = process.env;
const SESSION_COOKIE = "fp_session";

function timingSafeEqual(a, b) {
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function ensureRes(res) {
  if (!res) return res;
  if (typeof res.status !== "function") {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
  }
  if (typeof res.json !== "function") {
    res.json = (data) => {
      if (!res.getHeader?.("Content-Type")) res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return res;
    };
  }
  return res;
}

export function normalizeRole(roleRaw) {
  const r = String(roleRaw || "").trim().toLowerCase();
  if (r === "fisioterapista" || r === "physio") return "physio";
  if (r === "front office" || r === "front-office" || r === "front") return "front";
  if (r === "manager" || r === "admin" || r === "amministratore") return "manager";
  return "";
}

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
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function requireSession(req) {
  const token = getCookie(req, SESSION_COOKIE);
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
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function clearSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

export function requireRoles(req, res, allowedRoles) {
  ensureRes(res);
  const session = requireSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }

  const role = normalizeRole(session.role);
  const allowed = (allowedRoles || []).map(normalizeRole).filter(Boolean);
  if (allowed.length && !allowed.includes(role)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return null;
  }

  return { ...session, role };
}

export async function airtableFetch(path, init = {}) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    const err = new Error("Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID");
    err.status = 500;
    throw err;
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
  const headers = {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    ...(init.headers || {}),
  };

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.error?.message || json?.error || text || `Airtable error ${res.status}`;
    const err = new Error(msg);
    err.status = 502;
    err.airtable = json;
    throw err;
  }

  return json;
}
