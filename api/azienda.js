import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { fetchWithTimeout, memGetOrSet, setPrivateCache } from "./_common.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

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
    const timeoutMs = Number(process.env.AIRTABLE_META_TIMEOUT_MS || 12_000);
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }, timeoutMs);
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

function fieldValueMatchesSedeLoose(v, sedeLower) {
  if (!sedeLower) return false;
  if (typeof v === "string") return v.trim().toLowerCase() === sedeLower;
  if (typeof v === "number") return String(v).trim().toLowerCase() === sedeLower;
  return false;
}

function recordMatchesSedeLoose(fields, sede) {
  const sedeLower = String(sede || "").trim().toLowerCase();
  if (!sedeLower) return false;
  const f = fields && typeof fields === "object" ? fields : {};
  for (const k of Object.keys(f)) {
    const v = f[k];
    if (fieldValueMatchesSedeLoose(v, sedeLower)) return true;
    // Sometimes a single-select comes as string; other complex values are ignored.
  }
  return false;
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

    // Supabase fast-path: read from raw records (no Airtable).
    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();
      const out = await memGetOrSet(cacheKey, 60_000, async () => {
        const { data: rows, error } = await sb
          .from("airtable_raw_records")
          .select("airtable_id,fields")
          .eq("table_name", TABLE)
          .limit(500);
        if (error) throw new Error(`supabase_azienda_raw_failed: ${error.message}`);

        const pickAttachmentUrl = (val) => {
          if (Array.isArray(val) && val.length) {
            const a = val[0] || {};
            const t = a.thumbnails || {};
            return t.small?.url || t.large?.url || t.full?.url || a.url || "";
          }
          if (typeof val === "string") return val.trim();
          return "";
        };

        let chosen = null;
        for (const r of rows || []) {
          const f = (r.fields && typeof r.fields === "object") ? r.fields : {};
          const match =
            String(f.Sede || f.Nome || f.Name || f["Ragione Sociale"] || "").trim().toLowerCase() === sede.toLowerCase();
          if (!match) continue;
          const logoUrl = pickAttachmentUrl(f.Logo || f.logo || f.LOGO || "");
          if (logoUrl) { chosen = { f, logoUrl }; break; }
          if (!chosen) chosen = { f, logoUrl: "" };
        }
        if (!chosen && rows?.[0]) {
          const f = rows[0].fields || {};
          chosen = { f, logoUrl: pickAttachmentUrl(f.Logo || f.logo || f.LOGO || "") };
        }
        const fields = chosen?.f || {};
        return { sede, name: fields.Nome || fields.Name || fields["Ragione Sociale"] || "", logoUrl: chosen?.logoUrl || "" };
      });
      return res.status(200).json({ ok: true, ...out });
    }

    const out = await memGetOrSet(cacheKey, 60_000, async () => {
      // Prefer Meta API so we can see fields even when empty in records.
      const meta = await discoverTableMeta(TABLE);
      let keys = meta.fieldNames.length ? meta.fieldNames : [];
      const PRIMARY = meta.primaryFieldName || "";

      let FIELD_LOGO = resolveFieldKeyFromKeys(keys, [
        process.env.AIRTABLE_AZIENDA_LOGO_FIELD,
        "Logo",
        "logo",
        "LOGO",
      ].filter(Boolean));

      let FIELD_NAME = resolveFieldKeyFromKeys(keys, [
        process.env.AIRTABLE_AZIENDA_NAME_FIELD,
        "Nome",
        "Azienda",
        "Ragione Sociale",
        "Name",
      ].filter(Boolean));

      // Identify the "row" (BOLOGNA): try primary field first, then common candidates.
      let FIELD_SEDE = resolveFieldKeyFromKeys(keys, [
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
      const shouldFilterBySede = Boolean(FIELD_SEDE && String(sede || "").trim());
      if (FIELD_SEDE) {
        const q = escAirtableString(String(sede).toLowerCase());
        // Exact match on LOWER({field})
        qs.set("filterByFormula", `LOWER({${FIELD_SEDE}})="${q}"`);
      }
      let data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
      let records = Array.isArray(data?.records) ? data.records : [];

      // If Meta API was unavailable, we might not know the field names at all.
      // Derive keys from returned records (only non-empty fields are present in Airtable records).
      if (!keys.length && records.length) {
        const keySet = new Set();
        for (const r of records) {
          const f = r?.fields || {};
          Object.keys(f).forEach((k) => keySet.add(String(k)));
        }
        keys = Array.from(keySet);
        // Re-resolve using derived keys (now we can find "Logo" / "Sede" etc if present).
        if (!FIELD_LOGO) {
          FIELD_LOGO = resolveFieldKeyFromKeys(keys, [
            process.env.AIRTABLE_AZIENDA_LOGO_FIELD,
            "Logo",
            "logo",
            "LOGO",
          ].filter(Boolean));
        }
        if (!FIELD_NAME) {
          FIELD_NAME = resolveFieldKeyFromKeys(keys, [
            process.env.AIRTABLE_AZIENDA_NAME_FIELD,
            "Nome",
            "Azienda",
            "Ragione Sociale",
            "Name",
          ].filter(Boolean));
        }
        if (!FIELD_SEDE) {
          FIELD_SEDE = resolveFieldKeyFromKeys(keys, [
            process.env.AIRTABLE_AZIENDA_SEDE_FIELD,
            PRIMARY,
            "Sede",
            "Città",
            "Citta",
            "Città sede",
            "Nome",
            "Name",
          ].filter(Boolean));
        }
      }

      // If the requested sede yields no records (common when env/frontend uses a default like "BOLOGNA"),
      // fall back to an unfiltered fetch so we can still pick "first record with a logo".
      if (shouldFilterBySede && records.length === 0) {
        const qs2 = new URLSearchParams({ pageSize: "50" });
        if (FIELD_LOGO) qs2.append("fields[]", FIELD_LOGO);
        if (FIELD_NAME) qs2.append("fields[]", FIELD_NAME);
        if (FIELD_SEDE) qs2.append("fields[]", FIELD_SEDE);
        data = await airtableFetch(`${tableEnc}?${qs2.toString()}`);
        records = Array.isArray(data?.records) ? data.records : [];
      }

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
      // If we still don't know which field contains the primary value (Meta API off),
      // try matching "BOLOGNA" against any string/number field values.
      if (!chosen) {
        for (const r of records) {
          const f = r?.fields || {};
          if (!recordMatchesSedeLoose(f, sede)) continue;
          const logoUrl = FIELD_LOGO ? pickAttachmentUrl(f[FIELD_LOGO]) : pickAttachmentUrl(f["Logo"]);
          if (logoUrl) { chosen = { record: r, logoUrl }; break; }
        }
      }
      // Otherwise: first record with a logo (from filtered list, or unfiltered if filter not applied).
      if (!chosen) {
        for (const r of records) {
          const f = r?.fields || {};
          const logoUrl = FIELD_LOGO ? pickAttachmentUrl(f[FIELD_LOGO]) : pickAttachmentUrl(f["Logo"]);
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

