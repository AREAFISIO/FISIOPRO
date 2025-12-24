import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { memGetOrSet, setPrivateCache } from "./_common.js";

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

    const qs = new URLSearchParams({ pageSize: "100" });
    // try to request only the name field (if it exists)
    qs.append("fields[]", nameField);

    const cacheKey = `locations:${tableName}:${nameField}`;
    const items = await memGetOrSet(cacheKey, 10 * 60_000, async () => {
      const data = await airtableFetch(`${table}?${qs.toString()}`);
      return (data.records || [])
        .map((r) => {
          const f = r.fields || {};
          const name = String(f[nameField] ?? f.Nome ?? f.Name ?? f.Sede ?? "").trim();
          if (!name) return null;
          return { id: r.id, name };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));
    });

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

