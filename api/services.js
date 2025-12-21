import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const tableName = process.env.AIRTABLE_SERVICES_TABLE || process.env.AIRTABLE_PRESTAZIONI_TABLE || "PRESTAZIONI";
    const nameField = process.env.AIRTABLE_SERVICES_NAME_FIELD || "Prestazione";
    const table = encodeURIComponent(tableName);

    const qs = new URLSearchParams({ pageSize: "100" });
    qs.append("fields[]", nameField);

    const data = await airtableFetch(`${table}?${qs.toString()}`);
    const items = (data.records || [])
      .map((r) => {
        const f = r.fields || {};
        const name = String(f[nameField] ?? f.Prestazione ?? f.Nome ?? f.Name ?? "").trim();
        if (!name) return null;
        return { id: r.id, name };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "it"));

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

