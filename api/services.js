import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { memGetOrSet, setPrivateCache } from "./_common.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

async function airtableListAll({ tableEnc, qs, max = 800 }) {
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

    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb.from("services").select("airtable_id,name").order("name", { ascending: true }).limit(1000);
      if (error) return res.status(500).json({ ok: false, error: `supabase_services_failed: ${error.message}` });
      const items = (data || [])
        .map((r) => ({ id: String(r.airtable_id || ""), name: String(r.name || "").trim() }))
        .filter((x) => x.id && x.name);
      return res.status(200).json({ ok: true, items });
    }

    const tableName = process.env.AIRTABLE_SERVICES_TABLE || process.env.AIRTABLE_PRESTAZIONI_TABLE || "PRESTAZIONI";
    const nameField = process.env.AIRTABLE_SERVICES_NAME_FIELD || "Prestazione";
    const table = encodeURIComponent(tableName);

    const debug = String(req.query?.debug || "").trim() === "1";

    const cacheKey = `services:${tableName}:${nameField}`;
    const items = await memGetOrSet(cacheKey, 10 * 60_000, async () => {
      const qs = new URLSearchParams({ pageSize: "100" });
      if (nameField) qs.append("fields[]", nameField);

      let records = [];
      try {
        records = await airtableListAll({ tableEnc: table, qs, max: 800 });
      } catch (e) {
        if (isUnknownFieldError(e?.message)) {
          const qs2 = new URLSearchParams({ pageSize: "100" }); // no fields[]
          records = await airtableListAll({ tableEnc: table, qs: qs2, max: 800 });
        } else {
          throw e;
        }
      }

      return (records || [])
        .map((r) => {
          const f = r.fields || {};
          const name = String(f[nameField] ?? f.Prestazione ?? f.Nome ?? f.Name ?? f["Servizio"] ?? "").trim();
          if (!name) return null;
          return { id: r.id, name };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));
    });

    if (debug) {
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

