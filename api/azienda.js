import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { memGetOrSet, setPrivateCache } from "./_common.js";

function normalizeKeyLoose(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

async function discoverTableMeta(tableName) {
  // Lists all fields (even if empty) via Airtable Meta API.
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return { fieldNames: [], primaryFieldName: "" };

  const url = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(AIRTABLE_BASE_ID)}/tables`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    if (!res.ok) return { fieldNames: [], primaryFieldName: "" };

    const wanted = String(tableName || "").trim();
    const tables = Array.isArray(json.tables) ? json.tables : [];
    const t =
      tables.find((x) => String(x?.name || "").trim().toLowerCase() === wanted.toLowerCase()) ||
      tables.find((x) => normalizeKeyLoose(x?.name) === normalizeKeyLoose(wanted)) ||
      null;
    const fields = Array.isArray(t?.fields) ? t.fields : [];
    const byId = new Map(fields.map((f) => [String(f?.id || ""), String(f?.name || "")]));
    const primaryFieldId = String(t?.primaryFieldId || "");
    const primaryFieldName = primaryFieldId ? (byId.get(primaryFieldId) || "") : "";
    return {
      fieldNames: fields.map((f) => String(f?.name || "")).filter(Boolean),
      primaryFieldName: String(primaryFieldName || "").trim(),
    };
  } catch {
    return { fieldNames: [], primaryFieldName: "" };
  }
}

function resolveFieldKeyFromKeys(keys, candidates) {
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

function pickAttachmentUrl(val) {
  // Airtable attachment field: [{ url, thumbnails: { small/large/full }, filename, ... }]
  if (Array.isArray(val) && val.length) {
    const a = val[0] || {};
    const t = a.thumbnails || {};
    return (
      t.small?.url ||
      t.large?.url ||
      t.full?.url ||
      a.url ||
      ""
    );
  }
  // If it's already a string URL
  if (typeof val === "string") return val.trim();
  return "";
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    // Not sensitive, but keep it private (session-based app).
    setPrivateCache(res, 60 * 5);

    const TABLE = process.env.AIRTABLE_COMPANY_TABLE || process.env.AIRTABLE_AZIENDA_TABLE || "AZIENDA";
    const tableEnc = encodeURIComponent(TABLE);

    const sedeRaw = String(req.query?.sede || process.env.AIRTABLE_AZIENDA_SEDE || "BOLOGNA").trim();
    const sede = sedeRaw || "BOLOGNA";
    const cacheKey = `azienda:${TABLE}:${sede.toLowerCase()}`;
    const out = await memGetOrSet(cacheKey, 60_000, async () => {
      // Prefer Meta API so we can see fields even when empty in records.
      const meta = await discoverTableMeta(TABLE);
      const keys = meta.fieldNames.length ? meta.fieldNames : [];
      const PRIMARY = meta.primaryFieldName || "";

      const FIELD_LOGO = resolveFieldKeyFromKeys(keys, [
        process.env.AIRTABLE_AZIENDA_LOGO_FIELD,
        "Logo",
        "logo",
        "LOGO",
      ].filter(Boolean));

      const FIELD_NAME = resolveFieldKeyFromKeys(keys, [
        process.env.AIRTABLE_AZIENDA_NAME_FIELD,
        "Nome",
        "Azienda",
        "Ragione Sociale",
        "Name",
      ].filter(Boolean));

      // Identify the "row" (BOLOGNA): try primary field first, then common candidates.
      const FIELD_SEDE = resolveFieldKeyFromKeys(keys, [
        process.env.AIRTABLE_AZIENDA_SEDE_FIELD,
        PRIMARY,
        "Sede",
        "Città",
        "Citta",
        "Città sede",
        "Nome",
        "Name",
      ].filter(Boolean));

      // Fetch records (if Meta API isn't available or table has no meta access, we still try records).
      const qs = new URLSearchParams({ pageSize: "50" });
      if (FIELD_LOGO) qs.append("fields[]", FIELD_LOGO);
      if (FIELD_NAME) qs.append("fields[]", FIELD_NAME);
      if (FIELD_SEDE) qs.append("fields[]", FIELD_SEDE);

      // If we can, filter to the requested sede to avoid scanning unrelated rows.
      if (FIELD_SEDE) {
        const q = escAirtableString(String(sede).toLowerCase());
        // Exact match on LOWER({field})
        qs.set("filterByFormula", `LOWER({${FIELD_SEDE}})="${q}"`);
      }
      const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
      const records = Array.isArray(data?.records) ? data.records : [];

      let chosen = null;
      // Prefer the requested sede row (BOLOGNA) that has a logo.
      for (const r of records) {
        const f = r?.fields || {};
        const sedeVal = FIELD_SEDE ? String(f[FIELD_SEDE] ?? "").trim() : "";
        const isMatch = sedeVal && sedeVal.toLowerCase() === sede.toLowerCase();
        if (!isMatch) continue;
        const logoUrl = FIELD_LOGO ? pickAttachmentUrl(f[FIELD_LOGO]) : "";
        if (logoUrl) { chosen = { record: r, logoUrl }; break; }
      }
      // Otherwise: first record with a logo (from filtered list, or unfiltered if filter not applied).
      if (!chosen) {
        for (const r of records) {
          const f = r?.fields || {};
          const logoUrl = FIELD_LOGO ? pickAttachmentUrl(f[FIELD_LOGO]) : "";
          if (logoUrl) { chosen = { record: r, logoUrl }; break; }
        }
      }
      // fallback: just take first record if any (even without logo)
      if (!chosen && records[0]) chosen = { record: records[0], logoUrl: "" };

      const fields = chosen?.record?.fields || {};
      return {
        sede,
        name: FIELD_NAME ? (fields[FIELD_NAME] ?? "") : "",
        logoUrl: chosen?.logoUrl || "",
      };
    });

    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

