import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { memGetOrSet, setPrivateCache } from "./_common.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeKeyLoose(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function resolveFieldKeyFromRecord(fieldsObj, candidates) {
  const f = fieldsObj || {};
  const keys = Object.keys(f);
  if (!keys.length) return "";

  const byLower = new Map(keys.map((k) => [k.toLowerCase(), k]));
  for (const c of candidates || []) {
    const want = norm(c);
    if (!want) continue;
    const hit = byLower.get(want.toLowerCase());
    if (hit) return hit;
  }

  const keysLoose = new Map(keys.map((k) => [normalizeKeyLoose(k), k]));
  for (const c of candidates || []) {
    const wantLoose = normalizeKeyLoose(c);
    if (!wantLoose) continue;
    const hit = keysLoose.get(wantLoose);
    if (hit) return hit;
  }

  return "";
}

async function airtableListAll({ tableEnc, qs, max = 500 }) {
  let out = [];
  let offset = null;
  while (out.length < max) {
    const q = new URLSearchParams(qs);
    if (offset) q.set("offset", offset);
    const data = await airtableFetch(`${tableEnc}?${q.toString()}`);
    out = out.concat(data.records || []);
    offset = data.offset || null;
    if (!offset) break;
  }
  return out;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    setPrivateCache(res, 60);

    // Allow overriding via querystring to support different bases (e.g. positions stored in AZIENDA).
    const tableName = norm(req.query?.table) || process.env.AIRTABLE_LOCATIONS_TABLE || "SEDI";
    const nameField = norm(req.query?.nameField) || process.env.AIRTABLE_LOCATIONS_NAME_FIELD || "Nome";
    const table = encodeURIComponent(tableName);

    const debug = String(req.query?.debug || "").trim() === "1";

    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();
      // No normalized table for locations: derive options from airtable_raw_records (JSONB).
      const cacheKey = `locations:sb:${tableName}:${nameField}`;
      const items = await memGetOrSet(cacheKey, 10 * 60_000, async () => {
        const { data: rows, error } = await sb
          .from("airtable_raw_records")
          .select("airtable_id,fields")
          .eq("table_name", tableName)
          .limit(2000);
        if (error) throw new Error(`supabase_locations_raw_failed: ${error.message}`);

        const uniq = new Map(); // name -> name
        for (const r of rows || []) {
          const f = (r.fields && typeof r.fields === "object") ? r.fields : {};
          const v = f[nameField] ?? f.Nome ?? f.Name ?? f.Sede ?? f["Nome sede"] ?? "";
          if (typeof v === "string") {
            const s = v.trim();
            if (s) uniq.set(s, s);
          } else if (Array.isArray(v)) {
            for (const x of v) {
              if (typeof x !== "string") continue;
              const s = x.trim();
              if (s) uniq.set(s, s);
            }
          }
        }
        return Array.from(uniq.values())
          .map((name) => ({ id: name, name }))
          .sort((a, b) => a.name.localeCompare(b.name, "it"));
      });

      if (debug) return res.status(200).json({ ok: true, items, debug: { tableName, nameField, count: items.length, source: "supabase_raw" } });
      return res.status(200).json({ ok: true, items });
    }

    const cacheKey = `locations:${tableName}:${nameField}`;
    const items = await memGetOrSet(cacheKey, 10 * 60_000, async () => {
      // 1) Prefer requesting only nameField for speed.
      // 2) If nameField doesn't exist, retry without fields[] and pick a fallback field.
      const qs = new URLSearchParams({ pageSize: "100" });
      if (nameField) qs.append("fields[]", nameField);

      let records = [];
      try {
        records = await airtableListAll({ tableEnc: table, qs, max: 500 });
      } catch (e) {
        if (isUnknownFieldError(e?.message)) {
          const qs2 = new URLSearchParams({ pageSize: "100" }); // no fields[] -> get whatever Airtable returns
          records = await airtableListAll({ tableEnc: table, qs: qs2, max: 500 });
        } else {
          // Fallback: many bases don't have a "SEDI" table (Sede is a single-select/text on APPUNTAMENTI).
          // In that case, derive location options by sampling the appointment table.
          try {
            const apptTableName = process.env.AGENDA_TABLE || "APPUNTAMENTI";
            const apptField = process.env.AGENDA_LOCATION_FIELD || "Sede";
            const apptTable = encodeURIComponent(apptTableName);
            const qs3 = new URLSearchParams({ pageSize: "100" }); // no fields[] to maximize chance to get the field
            const apptRecords = await airtableListAll({ tableEnc: apptTable, qs: qs3, max: 500 });

            const uniq = new Map(); // id -> name
            let resolvedKey = "";
            const candidates = [
              apptField,
              "Sede",
              "Sedi",
              "Sede appuntamento",
              "Nome sede",
              "Nome sede appuntamento",
              "Location",
              "Luogo",
            ].filter(Boolean);
            for (const r of apptRecords || []) {
              const f = r.fields || {};
              if (!resolvedKey) resolvedKey = resolveFieldKeyFromRecord(f, candidates);
              const v = f[resolvedKey || apptField];
              if (!v) continue;
              if (typeof v === "string") {
                const s = v.trim();
                if (s) uniq.set(s, s);
              } else if (Array.isArray(v)) {
                // could be linked record ids or text arrays; keep whatever we can.
                for (const x of v) {
                  if (typeof x !== "string") continue;
                  const s = x.trim();
                  if (!s) continue;
                  uniq.set(s, s);
                }
              }
            }

            return Array.from(uniq.entries())
              .map(([id, name]) => ({ id, name }))
              .sort((a, b) => a.name.localeCompare(b.name, "it"));
          } catch {
            throw e;
          }
        }
      }

      return (records || [])
        .map((r) => {
          const f = r.fields || {};
          const name = String(f[nameField] ?? f.Nome ?? f.Name ?? f.Sede ?? f["Nome sede"] ?? "").trim();
          if (!name) return null;
          return { id: r.id, name };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));
    });

    if (debug) {
      // Add lightweight diagnostics without leaking data values.
      let sampleFields = [];
      try {
        const data = await airtableFetch(`${table}?pageSize=1`);
        const first = data.records?.[0]?.fields || {};
        sampleFields = Object.keys(first);
      } catch {}
      return res.status(200).json({
        ok: true,
        items,
        debug: { tableName, nameField, count: items.length, sampleFields },
      });
    }

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

