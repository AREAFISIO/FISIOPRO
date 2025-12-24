import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc, norm, readJsonBody } from "./_common.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  try {
    const tableName = process.env.AIRTABLE_GRUPPI_TABLE || "GRUPPI";
    const fieldName = process.env.AIRTABLE_GRUPPI_NAME_FIELD || "Nome gruppo";
    const fieldType = process.env.AIRTABLE_GRUPPI_TYPE_FIELD || "Tipo gruppo";
    const fieldMembers = process.env.AIRTABLE_GRUPPI_MEMBERS_FIELD || "Membri collegati";
    const fieldNote = process.env.AIRTABLE_GRUPPI_NOTE_FIELD || "Note";

    const tableEnc = enc(tableName);

    if (req.method === "GET") {
      const qs = new URLSearchParams({ pageSize: "100" });
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
            membri: f[fieldMembers] ?? [],
            note: f[fieldNote] ?? "",
            _fields: f,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));

      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const name = norm(body.name || body.nome || body[fieldName]);
      if (!name) return res.status(400).json({ ok: false, error: "missing_name" });

      const fields = {};
      fields[fieldName] = name;
      const tipo = norm(body.tipo || body[fieldType]);
      if (tipo) fields[fieldType] = tipo;
      const membri = body.membri ?? body.members ?? body[fieldMembers];
      if (Array.isArray(membri) && membri.length) fields[fieldMembers] = membri;
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

