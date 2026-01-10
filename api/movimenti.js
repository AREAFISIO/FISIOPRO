import { ensureRes, requireRoles } from "./_auth.js";
import { readJsonBody, norm } from "./_common.js";
import { airtableList, escAirtableString as esc } from "../lib/airtableClient.js";

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "si" || s === "sì" || s === "ok";
}

function parseIsoOrThrow(v, label) {
  const s = String(v ?? "").trim();
  if (!s) {
    const err = new Error(`missing_${label}`);
    err.status = 400;
    throw err;
  }
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
  const user = requireRoles(req, res, ["back", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const fromISO = parseIsoOrThrow(req.query?.from, "from");
    const toISO = parseIsoOrThrow(req.query?.to, "to");

    const parts = [];
    parts.push(`{Data} >= DATETIME_PARSE("${esc(fromISO)}")`);
    parts.push(`{Data} <= DATETIME_PARSE("${esc(toISO)}")`);

    const stato = norm(req.query?.stato);
    if (stato) parts.push(`{Stato}="${esc(stato)}"`);

    if (req.query?.daRivedere !== undefined) {
      const v = toBool(req.query?.daRivedere);
      parts.push(v ? `{Da rivedere}=TRUE()` : `OR({Da rivedere}=FALSE(), {Da rivedere}=BLANK())`);
    }
    if (req.query?.riconciliato !== undefined) {
      const v = toBool(req.query?.riconciliato);
      parts.push(v ? `{Riconciliato}=TRUE()` : `OR({Riconciliato}=FALSE(), {Riconciliato}=BLANK())`);
    }

    const formula = `AND(${parts.join(",")})`;

    const { records } = await airtableList("MOVIMENTI CONTO", {
      filterByFormula: formula,
      sort: [{ field: "Data", direction: "desc" }],
      maxRecords: 2000,
      fields: [
        "ID Movimento",
        "Data",
        "Descrizione",
        "Merchant",
        "Importo",
        "Valuta",
        "Direzione",
        "Qonto Category",
        "Controparte / IBAN",
        "Metodo",
        "Categoria",
        "Sotto-macro",
        "Macro",
        "Tipo",
        "Natura Costo",
        "Clinica/Centro di costo",
        "Regola applicata",
        "Match confidenza",
        "Stato",
        "Motivo verifica",
        "Fattura collegata",
        "Pagamento collegato",
        "Riconciliato",
        "Note",
        "Auto-classificato",
        "Da rivedere",
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

