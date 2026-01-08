import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc, norm, readJsonBody } from "./_common.js";

// ASSICURAZIONI (catalogo compagnie)
export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "back", "manager"]);
  if (!user) return;

  try {
    const tableName = process.env.AIRTABLE_ASSICURAZIONI_TABLE || "ASSICURAZIONI";
    const fieldName = process.env.AIRTABLE_ASSICURAZIONI_NAME_FIELD || "Nome assicurazione";
    const fieldType = process.env.AIRTABLE_ASSICURAZIONI_TYPE_FIELD || "Tipo assicurazione";
    const fieldActive = process.env.AIRTABLE_ASSICURAZIONI_ACTIVE_FIELD || "Convenzione attiva";
    const fieldNote = process.env.AIRTABLE_ASSICURAZIONI_NOTE_FIELD || "Note";

    const tableEnc = enc(tableName);

    if (req.method === "GET") {
      const activeOnly = String(req.query?.activeOnly ?? "1") !== "0";
      const qs = new URLSearchParams({ pageSize: "100" });
      if (activeOnly) qs.set("filterByFormula", `{${fieldActive}}=1`);
      const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);

      const items = (data.records || [])
        .map((r) => {
          const f = r.fields || {};
          const name = String(f[fieldName] ?? f.Nome ?? f.Name ?? "").trim();
          if (!name) return null;
          return {
            id: r.id,
            name,
            tipo: f[fieldType] ?? "",
            attiva: Boolean(f[fieldActive]),
            note: f[fieldNote] ?? "",
            _fields: f,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));

      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "POST") {
      if (String(user.role) !== "manager") return res.status(403).json({ ok: false, error: "forbidden" });
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const name = norm(body.name || body.nome || body[fieldName]);
      if (!name) return res.status(400).json({ ok: false, error: "missing_name" });

      const fields = {};
      fields[fieldName] = name;
      const tipo = norm(body.tipo || body[fieldType]);
      if (tipo) fields[fieldType] = tipo;
      if (body.attiva !== undefined) fields[fieldActive] = Boolean(body.attiva);
      const note = norm(body.note || body[fieldNote]);
      if (note) fields[fieldNote] = note;

      const created = await airtableFetch(`${tableEnc}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });

      return res.status(200).json({ ok: true, id: created?.id, fields: created?.fields || {} });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

