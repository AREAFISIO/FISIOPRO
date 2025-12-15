import crypto from "crypto";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  COLLABORATORS_TABLE = "COLLABORATORI",
  AUTH_SECRET,
} = process.env;

// ⬇️ se i campi in Airtable hanno nomi diversi, cambia QUI:
const FIELDS = {
  email: "Email",
  role: "Ruolo",
  code: "Codice accesso",
  active: "Attivo",
  name: "Collaboratore",
};

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}
function b64urlToJson(str) {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
}
function hmac(data) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(data).digest("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function assertEnv() {
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AUTH_SECRET) {
    throw new Error("Missing env vars: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AUTH_SECRET");
  }
}

export function signToken(payload, ttlSeconds = 60 * 60 * 12) { // 12h
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const p = b64urlJson(body);
  const sig = hmac(p);
  return `${p}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  const expected = hmac(p);
  if (sig !== expected) return null;
  const body = b64urlToJson(p);
  const now = Math.floor(Date.now() / 1000);
  if (!body.exp || now > body.exp) return null;
  return body;
}

export function getAuth(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : null;
  const user = verifyToken(token);
  return { token, user };
}

export function requireRoles(req, res, roles) {
  const { user } = getAuth(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!roles.includes(user.role)) {
    res.status(403).json({ error: "Forbidden", role: user.role });
    return null;
  }
  return user;
}

export async function airtableFetch(path, options = {}) {
  assertEnv();
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    throw new Error(`Airtable error: ${r.status} ${msg}`);
  }
  return data;
}

export async function findCollaboratorByEmail(email) {
  const table = encodeURIComponent(COLLABORATORS_TABLE);
  const formula = `LOWER({${FIELDS.email}})=LOWER("${String(email).replace(/"/g, '\\"')}")`;
  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
  });

  const data = await airtableFetch(`${table}?${qs.toString()}`);
  const rec = data.records?.[0];
  if (!rec) return null;

  const f = rec.fields || {};
  return {
    id: rec.id,
    email: f[FIELDS.email] || "",
    role: f[FIELDS.role] || "",
    code: f[FIELDS.code] || "",
    active: !!f[FIELDS.active],
    name: f[FIELDS.name] || "",
  };
}
