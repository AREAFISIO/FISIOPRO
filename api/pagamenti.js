import { ensureRes, requireRoles } from "./_auth.js";
import { norm, readJsonBody } from "./_common.js";
import {
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

      const formula = `AND({Data pagamento} >= DATETIME_PARSE("${esc(fromISO)}"), {Data pagamento} <= DATETIME_PARSE("${esc(toISO)}"))`;
      const { records } = await airtableList("PAGAMENTI FIC", {
        filterByFormula: formula,
        sort: [{ field: "Data pagamento", direction: "desc" }],
        maxRecords: 2000,
        fields: ["ID Pagamento", "ID Fattura", "Data pagamento", "Importo", "Metodo", "Movimento banca"],
      });

      return res.status(200).json({
        ok: true,
        records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const payload = body.pagamento || body;
      const recordId = norm(payload.recordId || payload.id);

      const idPagamento = norm(payload["ID Pagamento"] || payload.idPagamento || payload.paymentId);
      if (!recordId && !idPagamento) return res.status(400).json({ ok: false, error: "missing_id_pagamento" });

      const fields = {};
      if (idPagamento) fields["ID Pagamento"] = idPagamento;

      const idFatturaVal = payload["ID Fattura"] ?? payload.idFattura ?? payload.fatturaId ?? payload.invoiceId;
      if (idFatturaVal !== undefined && idFatturaVal !== null && String(idFatturaVal).trim() !== "") {
        const [fatturaRecId] = await resolveLinkedIds({ table: "FATTURE FIC", values: idFatturaVal });
        fields["ID Fattura"] = [fatturaRecId];
      }

      const dataPagamento = norm(payload["Data pagamento"] || payload.dataPagamento || payload.data);
      if (dataPagamento) fields["Data pagamento"] = dataPagamento;

      const importo = payload.Importo ?? payload.importo;
      if (importo !== undefined && importo !== null && String(importo).trim() !== "") fields["Importo"] = importo;

      const metodo = norm(payload.Metodo || payload.metodo);
      if (metodo) fields["Metodo"] = metodo;

      const movimentoVal = payload.movimentoId ?? payload.movementId ?? payload["Movimento banca"] ?? payload.movimentoBanca;
      if (movimentoVal !== undefined) {
        if (movimentoVal === null || String(movimentoVal).trim() === "") {
          fields["Movimento banca"] = [];
        } else {
          const [movRecId] = await resolveLinkedIds({ table: "MOVIMENTI CONTO", values: movimentoVal });
          fields["Movimento banca"] = [movRecId];
        }
      }

      // Upsert strategy:
      // - if recordId provided -> update by recordId
      // - else -> upsert by primary (ID Pagamento)
      let out;
      if (recordId) out = await airtableUpdate("PAGAMENTI FIC", recordId, fields);
      else out = (await airtableUpsertByPrimary("PAGAMENTI FIC", "ID Pagamento", idPagamento, fields)).record;

      return res.status(200).json({ ok: true, record: { id: out.id, fields: out.fields || {}, createdTime: out.createdTime || "" } });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

