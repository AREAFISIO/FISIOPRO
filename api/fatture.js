import { ensureRes, requireRoles } from "./_auth.js";
import { norm, readJsonBody } from "./_common.js";
import {
  airtableCreate,
  airtableList,
  airtableUpdate,
  airtableUpsertByPrimary,
  escAirtableString as esc,
  resolveLinkedIds,
} from "../lib/airtableClient.js";

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
    if (req.method === "GET") {
      const fromISO = parseIsoOrThrow(req.query?.from, "from");
      const toISO = parseIsoOrThrow(req.query?.to, "to");

      const parts = [];
      parts.push(`{Data} >= DATETIME_PARSE("${esc(fromISO)}")`);
      parts.push(`{Data} <= DATETIME_PARSE("${esc(toISO)}")`);

      const stato = norm(req.query?.stato);
      if (stato) parts.push(`{Stato}="${esc(stato)}"`);

      const formula = `AND(${parts.join(",")})`;
      const { records } = await airtableList("FATTURE FIC", {
        filterByFormula: formula,
        sort: [{ field: "Data", direction: "desc" }],
        maxRecords: 2000,
        fields: ["ID Fattura", "Data", "Cliente", "Totale", "Stato", "Metodo pagamento", "Scadenza", "Clinica", "Movimenti collegati"],
      });

      return res.status(200).json({
        ok: true,
        records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const payload = body.fattura || body;
      const recordId = norm(payload.recordId || payload.id);

      const idFattura = norm(payload["ID Fattura"] || payload.idFattura || payload.invoiceId);
      if (!recordId && !idFattura) return res.status(400).json({ ok: false, error: "missing_id_fattura" });

      const fields = {};
      if (idFattura) fields["ID Fattura"] = idFattura;

      const data = norm(payload.Data || payload.data);
      if (data) fields["Data"] = data;

      const cliente = norm(payload.Cliente || payload.cliente);
      if (cliente) fields["Cliente"] = [cliente];

      const totale = payload.Totale ?? payload.totale;
      if (totale !== undefined && totale !== null && String(totale).trim() !== "") fields["Totale"] = totale;

      const stato = norm(payload.Stato || payload.stato);
      if (stato) fields["Stato"] = stato;

      const metodo = norm(payload["Metodo pagamento"] || payload.metodoPagamento || payload.metodo);
      if (metodo) fields["Metodo pagamento"] = metodo;

      const scadenza = norm(payload.Scadenza || payload.scadenza);
      if (scadenza) fields["Scadenza"] = scadenza;

      const clinica = norm(payload.Clinica || payload.clinica);
      if (clinica) fields["Clinica"] = clinica;

      const movimenti = payload["Movimenti collegati"] ?? payload.movimentiCollegati ?? payload.movimenti;
      if (movimenti !== undefined) {
        const movIds = await resolveLinkedIds({ table: "MOVIMENTI CONTO", values: movimenti, allowMissing: true });
        fields["Movimenti collegati"] = movIds;
      }

      // Upsert strategy:
      // - if recordId provided -> update by recordId
      // - else -> upsert by primary (ID Fattura)
      let out;
      if (recordId) out = await airtableUpdate("FATTURE FIC", recordId, fields);
      else out = (await airtableUpsertByPrimary("FATTURE FIC", "ID Fattura", idFattura, fields)).record;

      return res.status(200).json({ ok: true, record: { id: out.id, fields: out.fields || {}, createdTime: out.createdTime || "" } });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

