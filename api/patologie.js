import { ensureRes, requireSession } from "./_auth.js";
import { escAirtableString, norm } from "./_common.js";
import { airtableList, escAirtableString as esc, resolveLinkedIds } from "../lib/airtableClient.js";

export default async function handler(req, res) {
  ensureRes(res);
  const session = requireSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const q = norm(req.query?.q);
    if (!q) return res.status(200).json({ ok: true, q: "", records: [] });

    const qq = esc(q.toLowerCase());
    const parts = [];
    parts.push(`FIND(LOWER("${qq}"), LOWER({Nome Patologia}&""))`);
    parts.push(`FIND(LOWER("${qq}"), LOWER({Sigla}&""))`);
    parts.push(`FIND(LOWER("${qq}"), LOWER({Tipo}&""))`);

    // "Macro Area" is a linked-record field; to search by name, resolve name->recordId first.
    const macroIds = await resolveLinkedIds({ table: "MACRO AREE", values: q, allowMissing: true });
    if (macroIds.length) parts.push(`FIND("${esc(macroIds[0])}", ARRAYJOIN({Macro Area}))`);

    const formula = `OR(${parts.join(",")})`;

    const { records } = await airtableList("PATOLOGIE ORTOPEDICHE", {
      filterByFormula: formula,
      maxRecords: 200,
      sort: [{ field: "Nome Patologia", direction: "asc" }],
      fields: [
        "Nome Patologia",
        "Sigla",
        "Tipo",
        "Macro Area",
        "Sotto-Area",
        "Struttura Anatomica",
        "Nervo Coinvolto",
        "Lateralità",
        "Rischio Complicanze",
        "FOLLOW UP CONSIGLIATO",
        "WIKIPEDIA",
      ],
    });

    return res.status(200).json({
      ok: true,
      q,
      records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

