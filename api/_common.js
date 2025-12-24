// Shared small helpers for Vercel serverless functions (Airtable-backed).

export function enc(x) {
  return encodeURIComponent(String(x ?? ""));
}

export function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export function asLinkArray(id) {
  const s = norm(id);
  if (!s) return null;
  return [s];
}

export async function readJsonBody(req) {
  // Vercel may populate req.body (object or string).
  if (req?.body && typeof req.body === "object") return req.body;
  if (typeof req?.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

export function filterByLinkedRecordId({ linkField, recordId }) {
  const rid = escAirtableString(recordId);
  const field = String(linkField || "").trim();
  if (!field || !rid) return "";
  return `FIND("${rid}", ARRAYJOIN({${field}}))`;
}

// ---------------------
// Tiny in-memory cache (best-effort for serverless warm instances)
// ---------------------

const _memCache = new Map(); // key -> { exp:number, value:any }
const _memCacheMax = 250;

export function memGet(key) {
  const k = String(key || "");
  if (!k) return undefined;
  const hit = _memCache.get(k);
  if (!hit) return undefined;
  if (Date.now() > hit.exp) {
    _memCache.delete(k);
    return undefined;
  }
  return hit.value;
}

export function memSet(key, value, ttlMs = 60_000) {
  const k = String(key || "");
  if (!k) return;
  const exp = Date.now() + Math.max(1_000, Number(ttlMs) || 60_000);
  _memCache.set(k, { exp, value });

  // simple bound
  if (_memCache.size > _memCacheMax) {
    // delete oldest-ish by exp
    const entries = Array.from(_memCache.entries()).sort((a, b) => a[1].exp - b[1].exp);
    for (let i = 0; i < Math.ceil(_memCacheMax * 0.15); i++) {
      const kk = entries[i]?.[0];
      if (kk) _memCache.delete(kk);
    }
  }
}

export async function memGetOrSet(key, ttlMs, fn) {
  const cached = memGet(key);
  if (cached !== undefined) return cached;
  const val = await fn();
  memSet(key, val, ttlMs);
  return val;
}

export function setPrivateCache(res, seconds = 60) {
  // Avoid caching sensitive patient data in shared caches.
  const s = Math.max(0, Number(seconds) || 0);
  res.setHeader("Cache-Control", `private, max-age=${s}, stale-while-revalidate=${Math.max(0, s * 5)}`);
}

