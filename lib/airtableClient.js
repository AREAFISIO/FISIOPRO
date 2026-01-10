import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const airtableSchema = require("./airtableSchema.json");

function enc(x) {
  return encodeURIComponent(String(x ?? ""));
}

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

function isRecordId(v) {
  return typeof v === "string" && v.startsWith("rec");
}

function asLinkArray(idsOrSingle) {
  if (Array.isArray(idsOrSingle)) return idsOrSingle.filter(isRecordId);
  if (isRecordId(idsOrSingle)) return [idsOrSingle];
  return [];
}

function getEnvOrThrow(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`Missing ${name}`);
    err.status = 500;
    throw err;
  }
  return v;
}

function airtableBaseUrl() {
  const baseId = getEnvOrThrow("AIRTABLE_BASE_ID");
  return `https://api.airtable.com/v0/${baseId}`;
}

function airtableHeaders(extra = {}) {
  const token = getEnvOrThrow("AIRTABLE_TOKEN");
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

export async function fetchJSON(url, options = {}) {
  const timeoutMs = Math.max(1_000, Number(process.env.AIRTABLE_FETCH_TIMEOUT_MS || 20_000));
  const retryOnceOnTimeout = String(process.env.AIRTABLE_FETCH_RETRY_ON_TIMEOUT || "1") !== "0";

  async function runOnce() {
    const controller = new AbortController();
    const t = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, timeoutMs);

    try {
      const res = await fetch(url, { ...(options || {}), signal: controller.signal });
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      if (!res.ok) {
        const msg = json?.error?.message || json?.error || text || `HTTP_${res.status}`;
        const err = new Error(msg);
        err.status = 502;
        err.airtable = json;
        throw err;
      }
      return json;
    } catch (e) {
      if (e?.name === "AbortError") {
        const err = new Error(`timeout_after_${timeoutMs}ms`);
        err.status = 504;
        err.cause = e;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  try {
    return await runOnce();
  } catch (e) {
    const isTimeout = e?.status === 504 || String(e?.message || "").startsWith("timeout_after_");
    if (retryOnceOnTimeout && isTimeout) return await runOnce();
    throw e;
  }
}

export async function airtableList(
  table,
  { filterByFormula, sort, maxRecords, fields, pageSize } = {},
) {
  const tableName = norm(table);
  if (!tableName) throw new Error("airtableList: missing table");

  const baseUrl = airtableBaseUrl();
  const qs = new URLSearchParams();
  const limit = Number(maxRecords || 0);
  const ps = Math.min(100, Math.max(1, Number(pageSize || 100)));
  qs.set("pageSize", String(ps));
  if (filterByFormula) qs.set("filterByFormula", String(filterByFormula));
  if (limit) qs.set("maxRecords", String(limit));
  if (Array.isArray(fields)) for (const f of fields.filter(Boolean)) qs.append("fields[]", String(f));
  if (Array.isArray(sort)) {
    sort.forEach((s, idx) => {
      if (!s?.field) return;
      qs.append(`sort[${idx}][field]`, String(s.field));
      if (s.direction) qs.append(`sort[${idx}][direction]`, String(s.direction));
    });
  }

  let offset = null;
  const out = [];

  while (true) {
    const pageQs = new URLSearchParams(qs);
    if (offset) pageQs.set("offset", offset);
    const url = `${baseUrl}/${enc(tableName)}?${pageQs.toString()}`;
    const data = await fetchJSON(url, { headers: airtableHeaders() });
    const recs = data.records || [];
    out.push(...recs);
    offset = data.offset || null;

    if (!offset) break;
    if (limit && out.length >= limit) break;
  }

  return { records: limit ? out.slice(0, limit) : out, offset };
}

export async function airtableGet(table, recordId) {
  const tableName = norm(table);
  const rid = norm(recordId);
  if (!tableName) throw new Error("airtableGet: missing table");
  if (!rid) throw new Error("airtableGet: missing recordId");
  const baseUrl = airtableBaseUrl();
  const url = `${baseUrl}/${enc(tableName)}/${enc(rid)}`;
  return await fetchJSON(url, { headers: airtableHeaders() });
}

export async function airtableCreate(table, fields) {
  const tableName = norm(table);
  if (!tableName) throw new Error("airtableCreate: missing table");
  const baseUrl = airtableBaseUrl();
  const url = `${baseUrl}/${enc(tableName)}`;
  return await fetchJSON(url, {
    method: "POST",
    headers: airtableHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fields: fields || {} }),
  });
}

export async function airtableUpdate(table, recordId, fields) {
  const tableName = norm(table);
  const rid = norm(recordId);
  if (!tableName) throw new Error("airtableUpdate: missing table");
  if (!rid) throw new Error("airtableUpdate: missing recordId");
  const baseUrl = airtableBaseUrl();
  const url = `${baseUrl}/${enc(tableName)}/${enc(rid)}`;
  return await fetchJSON(url, {
    method: "PATCH",
    headers: airtableHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fields: fields || {} }),
  });
}

export async function airtableUpsertByPrimary(table, primaryFieldName, primaryValue, fieldsToSet = {}) {
  const tableName = norm(table);
  const primaryField = norm(primaryFieldName);
  const pv = norm(primaryValue);
  if (!tableName) throw new Error("airtableUpsertByPrimary: missing table");
  if (!primaryField) throw new Error("airtableUpsertByPrimary: missing primaryFieldName");
  if (!pv) throw new Error("airtableUpsertByPrimary: missing primaryValue");

  const formula = `LOWER({${primaryField}}) = LOWER("${escAirtableString(pv)}")`;
  const { records } = await airtableList(tableName, { filterByFormula: formula, maxRecords: 1, pageSize: 1 });
  const existing = records?.[0] || null;
  if (existing?.id) {
    const updated = await airtableUpdate(tableName, existing.id, { ...(fieldsToSet || {}) });
    return { action: "updated", record: updated };
  }
  const created = await airtableCreate(tableName, { [primaryField]: pv, ...(fieldsToSet || {}) });
  return { action: "created", record: created };
}

// -------------------------
// Linked-record resolver w/ in-memory cache
// -------------------------

const _cache = new Map(); // key -> { exp:number, value:any }
const _cacheMax = 500;

function cacheGet(key) {
  const k = String(key || "");
  if (!k) return undefined;
  const hit = _cache.get(k);
  if (!hit) return undefined;
  if (Date.now() > hit.exp) {
    _cache.delete(k);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs = 10 * 60_000) {
  const k = String(key || "");
  if (!k) return;
  _cache.set(k, { value, exp: Date.now() + Math.max(1_000, Number(ttlMs) || 60_000) });
  if (_cache.size > _cacheMax) {
    const entries = Array.from(_cache.entries()).sort((a, b) => a[1].exp - b[1].exp);
    for (let i = 0; i < Math.ceil(_cacheMax * 0.15); i++) {
      const kk = entries[i]?.[0];
      if (kk) _cache.delete(kk);
    }
  }
}

export function getPrimaryField(tableName) {
  const t = String(tableName || "").trim();
  return airtableSchema?.[t]?.primary || "";
}

export async function getRecordIdByPrimary(tableName, primaryValue) {
  const table = norm(tableName);
  const value = norm(primaryValue);
  if (!table) throw new Error("getRecordIdByPrimary: missing tableName");
  if (!value) return "";

  if (isRecordId(value)) return value;

  const primaryField = getPrimaryField(table);
  if (!primaryField) throw new Error(`getRecordIdByPrimary: missing schema primary for table ${table}`);

  const cacheKey = `rid:${table}:${value.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const formula = `LOWER({${primaryField}}) = LOWER("${escAirtableString(value)}")`;
  const { records } = await airtableList(table, { filterByFormula: formula, maxRecords: 1, pageSize: 1 });
  const rid = records?.[0]?.id || "";
  if (rid) cacheSet(cacheKey, rid);
  return rid;
}

export async function resolveLinkedIds({ table, values, allowMissing = false } = {}) {
  const t = norm(table);
  if (!t) throw new Error("resolveLinkedIds: missing table");

  const arr = Array.isArray(values) ? values : values === undefined || values === null ? [] : [values];
  const out = [];
  for (const v of arr) {
    const s = norm(v);
    if (!s) continue;
    if (isRecordId(s)) {
      out.push(s);
      continue;
    }
    const rid = await getRecordIdByPrimary(t, s);
    if (!rid) {
      if (allowMissing) continue;
      const err = new Error(`resolveLinkedIds: record not found in ${t} for primary="${s}"`);
      err.status = 400;
      throw err;
    }
    out.push(rid);
  }
  return out;
}

export async function airtableGetMany(table, recordIds, { fields } = {}) {
  const tableName = norm(table);
  const ids = (recordIds || []).filter(isRecordId);
  if (!tableName) throw new Error("airtableGetMany: missing table");
  if (!ids.length) return { records: [] };

  const out = [];
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const orParts = chunk.map((id) => `RECORD_ID()="${escAirtableString(id)}"`);
    const formula = `OR(${orParts.join(",")})`;
    const { records } = await airtableList(tableName, { filterByFormula: formula, pageSize: 100, fields });
    out.push(...(records || []));
  }
  return { records: out };
}

export function toAirtableLinkFieldValue(valueOrValues, { table, allowMissing = false } = {}) {
  // Accept already-resolved record IDs OR primary values; returns array of record IDs (Airtable link format).
  // If you need strict behavior (fail if missing), keep allowMissing=false.
  return resolveLinkedIds({ table, values: valueOrValues, allowMissing }).then(asLinkArray);
}

