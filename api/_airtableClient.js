import { airtableFetch } from "./_auth.js";
import { memGetOrSet } from "./_common.js";

// -----------------------------
// Airtable fetch helpers (REST)
// -----------------------------

function normalizeKeyLoose(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function resolveFieldKeyFromKeys(keys, candidates) {
  const list = Array.isArray(keys) ? keys : [];
  if (!list.length) return "";

  const byLower = new Map(list.map((k) => [String(k).toLowerCase(), String(k)]));
  for (const c of candidates || []) {
    const want = String(c || "").trim();
    if (!want) continue;
    const hit = byLower.get(want.toLowerCase());
    if (hit) return hit;
  }

  const byLoose = new Map(list.map((k) => [normalizeKeyLoose(k), String(k)]));
  for (const c of candidates || []) {
    const wantLoose = normalizeKeyLoose(c);
    if (!wantLoose) continue;
    const hit = byLoose.get(wantLoose);
    if (hit) return hit;
  }

  return "";
}

export async function inferTableFieldKeys(tableEnc, cacheKey) {
  // Single call: fetch one record without fields[] so we can see real keys.
  return await memGetOrSet(cacheKey, 60 * 60_000, async () => {
    const data = await airtableFetch(`${tableEnc}?pageSize=1`);
    const first = data?.records?.[0]?.fields || {};
    return Object.keys(first || {});
  });
}

export function buildAirtableQuery({
  view,
  fields,
  filterByFormula,
  sort,
  pageSize,
  maxRecords,
  offset,
} = {}) {
  const qs = new URLSearchParams();
  if (view) qs.set("view", String(view));
  if (filterByFormula) qs.set("filterByFormula", String(filterByFormula));
  if (pageSize) qs.set("pageSize", String(pageSize));
  if (maxRecords) qs.set("maxRecords", String(maxRecords));
  if (offset) qs.set("offset", String(offset));

  // Airtable supports repeated "fields[]" keys.
  (fields || []).filter(Boolean).forEach((f) => qs.append("fields[]", String(f)));

  // sort = [{ field, direction }]
  (sort || []).forEach((s, i) => {
    if (!s?.field) return;
    qs.append(`sort[${i}][field]`, String(s.field));
    if (s.direction) qs.append(`sort[${i}][direction]`, String(s.direction));
  });

  return qs;
}

export async function airtableListAll({
  tableName,
  tableEnc = null,
  view,
  fields,
  filterByFormula,
  sort,
  pageSize = 100,
  maxRecords = 500,
} = {}) {
  const table = tableEnc || encodeURIComponent(String(tableName || "").trim());
  if (!table) throw new Error("missing_table");

  const cap = Math.max(1, Math.min(Number(maxRecords) || 500, 10_000));
  const size = Math.max(1, Math.min(Number(pageSize) || 100, 100));

  const baseQs = buildAirtableQuery({ view, fields, filterByFormula, sort, pageSize: size });
  const records = [];
  let offset = null;

  while (records.length < cap) {
    const qs = new URLSearchParams(baseQs);
    if (offset) qs.set("offset", offset);
    const data = await airtableFetch(`${table}?${qs.toString()}`);
    const batch = data?.records || [];
    for (const r of batch) {
      records.push(r);
      if (records.length >= cap) break;
    }
    offset = data?.offset || null;
    if (!offset) break;
  }

  return records;
}

// -----------------------------
// Normalizers for dashboard JSON
// -----------------------------

export function asNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim().replace(/\./g, "").replace(",", "."); // tolerate "1.234,56"
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asString(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export function asIsoDateOrEmpty(v) {
  const s = asString(v);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export function asLinkIds(v) {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  const s = asString(v);
  return s ? [s] : [];
}

