import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc, memGetOrSet, setPrivateCache } from "./_common.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

async function getFieldsFromMeta(tableName) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return [];
  const url = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(AIRTABLE_BASE_ID)}/tables`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    if (!res.ok) return [];
    const tables = json.tables || [];
    const wanted = String(tableName || "").trim();
    const t =
      tables.find((x) => String(x?.name || "") === wanted) ||
      tables.find((x) => String(x?.name || "").toLowerCase() === wanted.toLowerCase()) ||
      null;
    return (t?.fields || []).filter(Boolean);
  } catch {
    return [];
  }
}

async function sampleDistinctValues({ tableEnc, fieldName, maxPages = 6 }) {
  const out = new Set();
  let offset = null;
  let pages = 0;
  while (pages < maxPages) {
    pages += 1;
    const qs = new URLSearchParams({ pageSize: "100" });
    if (offset) qs.set("offset", offset);
    // Ask only the field if possible (faster). If field is unknown, Airtable errors.
    qs.append("fields[]", fieldName);
    let data;
    try {
      data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
    } catch {
      // fallback: no fields[] (field might be missing or empty on sampled records)
      const qs2 = new URLSearchParams({ pageSize: "100" });
      if (offset) qs2.set("offset", offset);
      data = await airtableFetch(`${tableEnc}?${qs2.toString()}`);
    }
    for (const r of data.records || []) {
      const f = r.fields || {};
      const v = f[fieldName];
      if (typeof v === "string") {
        const s = v.trim();
        if (s) out.add(s);
      } else if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x !== "string") continue;
          const s = x.trim();
          if (s) out.add(s);
        }
      }
    }
    offset = data.offset || null;
    if (!offset) break;
    if (out.size >= 150) break;
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b, "it"));
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    setPrivateCache(res, 60);

    const tableName = norm(req.query?.table || process.env.AGENDA_TABLE || "APPUNTAMENTI");
    const field = norm(req.query?.field);
    if (!field) return res.status(400).json({ ok: false, error: "missing_field" });

    const cacheKey = `fieldOptions:${tableName}:${field}`;
    const items = await memGetOrSet(cacheKey, 10 * 60_000, async () => {
      // 1) Try Meta API for true single-select choices.
      const metaFields = await getFieldsFromMeta(tableName);
      const meta =
        metaFields.find((f) => String(f?.name || "") === field) ||
        metaFields.find((f) => String(f?.name || "").toLowerCase() === field.toLowerCase()) ||
        null;
      const choices = meta?.options?.choices || meta?.typeOptions?.choices || [];
      if (Array.isArray(choices) && choices.length) {
        const vals = choices.map((c) => norm(c?.name)).filter(Boolean);
        if (vals.length) return vals;
      }

      // 2) Fallback: sample record values.
      const tableEnc = enc(tableName);
      return await sampleDistinctValues({ tableEnc, fieldName: field });
    });

    return res.status(200).json({ ok: true, items: (items || []).map((name) => ({ id: name, name })) });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

