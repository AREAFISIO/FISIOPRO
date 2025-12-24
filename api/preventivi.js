import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { asLinkArray, enc, norm, readJsonBody, filterByLinkedRecordId } from "./_common.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "manager"]);
  if (!user) return;

  try {
    const tableName = process.env.AIRTABLE_PREVENTIVI_TABLE || "PREVENTIVO E REGOLAMENTO";
    const fieldPatient = process.env.AIRTABLE_PREVENTIVI_PATIENT_FIELD || "Paziente";
    const fieldNumber = process.env.AIRTABLE_PREVENTIVI_NUMBER_FIELD || "Numero preventivo";
    const fieldDate = process.env.AIRTABLE_PREVENTIVI_DATE_FIELD || "Data preventivo";
    const fieldType = process.env.AIRTABLE_PREVENTIVI_TYPE_FIELD || "Tipo preventivo";
    const fieldDesc = process.env.AIRTABLE_PREVENTIVI_DESC_FIELD || "Descrizione";
    const fieldTotal = process.env.AIRTABLE_PREVENTIVI_TOTAL_FIELD || "Importo totale";
    const fieldPayment = process.env.AIRTABLE_PREVENTIVI_PAYMENT_FIELD || "Modalità pagamento";
    const fieldAccepted = process.env.AIRTABLE_PREVENTIVI_ACCEPTED_FIELD || "Accettato";
    const fieldAcceptedDate = process.env.AIRTABLE_PREVENTIVI_ACCEPTED_DATE_FIELD || "Data accettazione";
    const fieldRules = process.env.AIRTABLE_PREVENTIVI_RULES_FIELD || "Regolamento accettato";
    const fieldNote = process.env.AIRTABLE_PREVENTIVI_NOTE_FIELD || "Note";

    const tableEnc = enc(tableName);

    if (req.method === "GET") {
      const patientId = norm(req.query?.patientId);
      const maxRecords = Math.min(Number(req.query?.maxRecords || 50) || 50, 200);

      const qs = new URLSearchParams({ pageSize: "100", maxRecords: String(maxRecords) });
      if (patientId) {
        const formula = filterByLinkedRecordId({ linkField: fieldPatient, recordId: patientId });
        if (formula) qs.set("filterByFormula", formula);
      }

      const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
      const items = (data.records || []).map((r) => {
        const f = r.fields || {};
        const pat = f[fieldPatient];
        return {
          id: r.id,
          patientId: Array.isArray(pat) && pat.length ? pat[0] : "",
          numero: f[fieldNumber] ?? "",
          data: f[fieldDate] ?? "",
          tipo: f[fieldType] ?? "",
          descrizione: f[fieldDesc] ?? "",
          totale: f[fieldTotal] ?? "",
          pagamento: f[fieldPayment] ?? "",
          accettato: Boolean(f[fieldAccepted]),
          dataAccettazione: f[fieldAcceptedDate] ?? "",
          regolamentoAccettato: Boolean(f[fieldRules]),
          note: f[fieldNote] ?? "",
          _fields: f,
        };
      });

      // newest first (best-effort)
      items.sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
      return res.status(200).json({ ok: true, items, offset: data.offset || null });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const patientId = norm(body.patientId || body.pazienteId || body.Paziente);
      if (!patientId) return res.status(400).json({ ok: false, error: "missing_patient" });

      const fields = {};
      fields[fieldPatient] = asLinkArray(patientId);

      const numero = norm(body.numeroPreventivo || body.numero || body[fieldNumber]);
      if (numero) fields[fieldNumber] = numero;

      const dataPrev = norm(body.dataPreventivo || body.data || body[fieldDate]);
      if (dataPrev) fields[fieldDate] = dataPrev;

      const tipo = norm(body.tipoPreventivo || body.tipo || body[fieldType]);
      if (tipo) fields[fieldType] = tipo;

      const descrizione = norm(body.descrizione || body[fieldDesc]);
      if (descrizione) fields[fieldDesc] = descrizione;

      if (body.totale !== undefined && body.totale !== null && String(body.totale).trim() !== "")
        fields[fieldTotal] = body.totale;

      const pagamento = norm(body.modalitaPagamento || body.pagamento || body[fieldPayment]);
      if (pagamento) fields[fieldPayment] = pagamento;

      if (body.accettato !== undefined) fields[fieldAccepted] = Boolean(body.accettato);
      const dataAcc = norm(body.dataAccettazione || body[fieldAcceptedDate]);
      if (dataAcc) fields[fieldAcceptedDate] = dataAcc;

      if (body.regolamentoAccettato !== undefined) fields[fieldRules] = Boolean(body.regolamentoAccettato);

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

