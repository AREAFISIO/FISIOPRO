import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc } from "./_common.js";

// TRATTAMENTI (catalogo)
export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const tableName = process.env.AIRTABLE_TRATTAMENTI_TABLE || process.env.TREATMENTS_TABLE || "TRATTAMENTI";
    const fieldName = process.env.AIRTABLE_TRATTAMENTI_NAME_FIELD || "Nome trattamento";
    const fieldActive = process.env.AIRTABLE_TRATTAMENTI_ACTIVE_FIELD || "Attivo";

    const activeOnly = String(req.query?.activeOnly ?? "1") !== "0";
    const q = String(req.query?.q || "").trim().toLowerCase();

    const qs = new URLSearchParams({ pageSize: "100" });

    // optional filter: active + search
    const filters = [];
    if (activeOnly) filters.push(`{${fieldActive}}=1`);
    if (q) {
      const qEsc = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      filters.push(`FIND("${qEsc}", LOWER({${fieldName}}))`);
    }
    if (filters.length) qs.set("filterByFormula", `AND(${filters.join(",")})`);

    const tableEnc = enc(tableName);
    const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);

    const items = (data.records || [])
      .map((r) => {
        const f = r.fields || {};
        const name = String(f[fieldName] ?? f["Nome trattamento"] ?? f.Nome ?? f.Name ?? "").trim();
        if (!name) return null;
        return { id: r.id, name, active: Boolean(f[fieldActive]), _fields: f };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "it"));

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}
