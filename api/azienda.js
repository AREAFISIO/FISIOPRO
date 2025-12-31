import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { memGetOrSet, setPrivateCache } from "./_common.js";

function normalizeKeyLoose(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

    const cacheKey = `azienda:${TABLE}`;
    const out = await memGetOrSet(cacheKey, 60_000, async () => {
      // Fetch a few records and merge keys so we can find "Logo" even if the first record is sparse.
      const data = await airtableFetch(`${tableEnc}?pageSize=10`);
      const records = Array.isArray(data?.records) ? data.records : [];

      const allKeys = new Set();
      for (const r of records) {
        const f = r?.fields || {};
        Object.keys(f).forEach((k) => allKeys.add(k));
      }
      const keys = Array.from(allKeys);

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

      let chosen = null;
      for (const r of records) {
        const f = r?.fields || {};
        const logoUrl = FIELD_LOGO ? pickAttachmentUrl(f[FIELD_LOGO]) : "";
        if (logoUrl) {
          chosen = { record: r, logoUrl };
          break;
        }
      }
      // fallback: just take first record if any
      if (!chosen && records[0]) chosen = { record: records[0], logoUrl: "" };

      const fields = chosen?.record?.fields || {};
      return {
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

