import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { memGetOrSet, setPrivateCache } from "./_common.js";

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
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

    const tableName = process.env.AIRTABLE_LOCATIONS_TABLE || "SEDI";
    const nameField = process.env.AIRTABLE_LOCATIONS_NAME_FIELD || "Nome";
    const table = encodeURIComponent(tableName);

    const debug = String(req.query?.debug || "").trim() === "1";

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
          throw e;
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

