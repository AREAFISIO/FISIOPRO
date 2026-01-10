import { ensureRes, requireRoles } from "./_auth.js";
import { norm } from "./_common.js";
import { airtableList, escAirtableString as esc, resolveLinkedIds } from "../lib/airtableClient.js";

function parseIsoOrThrow(v, label) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`invalid_${label}`);
    err.status = 400;
    throw err;
  }
  return d.toISOString();
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "back", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const parts = [];

    const stato = norm(req.query?.stato);
    if (stato) parts.push(`{Stato Testuale}="${esc(stato)}"`);

    const ricevente = norm(req.query?.ricevente);
    if (ricevente) {
      const [riceventeRecId] = await resolveLinkedIds({ table: "COLLABORATORI", values: ricevente });
      parts.push(`FIND("${esc(riceventeRecId)}", ARRAYJOIN({Ricevente}))`);
    }

    // Date range: interpret from/to as "Ultima modifica della data"
    const fromISO = parseIsoOrThrow(req.query?.from, "from");
    const toISO = parseIsoOrThrow(req.query?.to, "to");
    if (fromISO) parts.push(`{Ultima modifica della data} >= DATETIME_PARSE("${esc(fromISO)}")`);
    if (toISO) parts.push(`{Ultima modifica della data} <= DATETIME_PARSE("${esc(toISO)}")`);

    const filterByFormula = parts.length ? `AND(${parts.join(",")})` : "";

    const { records } = await airtableList("INCARICHI", {
      filterByFormula,
      sort: [{ field: "Ultima modifica della data", direction: "desc" }],
      maxRecords: 1000,
      fields: [
        "Incarichi",
        "Ambito",
        "Tipologia",
        "Ricevente",
        "PRIORITÀ",
        "Mandante",
        "Stato Testuale",
        "Pagamento",
        "Fisioterapista",
        "_paziente_data richiamo",
        "Anagrafica",
        "Trattamento",
        "Settimane post",
        "Miglioramento",
        "Scadenza Settimana Corrente",
        "Riepilogo To do",
        "Scadenza Passata",
        "Accertato",
        "Ultima modifica della data",
        "Note del fisioterapista",
        "Consegne",
        "Formazione",
        "OGGETTO",
        "Paziente In Incarico",
        "ALLEGATO",
      ],
    });

    return res.status(200).json({
      ok: true,
      records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

