import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { asLinkArray, enc, norm, readJsonBody, filterByLinkedRecordId } from "./_common.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "back", "manager"]);
  if (!user) return;

  try {
    const tableName = process.env.AIRTABLE_EROGATO_TABLE || "EROGATO";
    const fieldPatient = process.env.AIRTABLE_EROGATO_PATIENT_FIELD || "Paziente";
    const fieldService = process.env.AIRTABLE_EROGATO_SERVICE_FIELD || "Prestazione";
    const fieldOperator = process.env.AIRTABLE_EROGATO_OPERATOR_FIELD || "Operatore";
    const fieldDate = process.env.AIRTABLE_EROGATO_DATE_FIELD || "Data erogazione";
    const fieldDuration = process.env.AIRTABLE_EROGATO_DURATION_FIELD || "Durata";
    const fieldValue = process.env.AIRTABLE_EROGATO_VALUE_FIELD || "Valore";
    const fieldStatus = process.env.AIRTABLE_EROGATO_STATUS_FIELD || "Stato";
    const fieldAppt = process.env.AIRTABLE_EROGATO_APPOINTMENT_FIELD || "Appuntamento collegato";
    const fieldNote = process.env.AIRTABLE_EROGATO_NOTE_FIELD || "Note";

    const tableEnc = enc(tableName);

    if (req.method === "GET") {
      const patientId = norm(req.query?.patientId);
      const maxRecords = Math.min(Number(req.query?.maxRecords || 100) || 100, 200);

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
          prestazione: f[fieldService] ?? f.Prestazione ?? f["Voce prezzario"] ?? "",
          operatore: f[fieldOperator] ?? f.Operatore ?? "",
          data: f[fieldDate] ?? f.Data ?? "",
          durata: f[fieldDuration] ?? "",
          valore: f[fieldValue] ?? "",
          stato: f[fieldStatus] ?? "",
          appuntamento: f[fieldAppt] ?? "",
          note: f[fieldNote] ?? "",
          _fields: f,
        };
      });

      // best-effort sort (newest first)
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

      const prestazioneId = norm(body.prestazioneId || body.serviceId || body.Prestazione);
      if (prestazioneId) fields[fieldService] = asLinkArray(prestazioneId);

      const operatoreId = norm(body.operatoreId || body.operatorId || body.Operatore);
      if (operatoreId) fields[fieldOperator] = asLinkArray(operatoreId);

      const dataErogazione = norm(body.dataErogazione || body.data || body[fieldDate]);
      if (dataErogazione) fields[fieldDate] = dataErogazione;

      const durata = body.durata ?? body[fieldDuration];
      if (durata !== undefined && durata !== null && String(durata).trim() !== "") fields[fieldDuration] = durata;

      const valore = body.valore ?? body[fieldValue];
      if (valore !== undefined && valore !== null && String(valore).trim() !== "") fields[fieldValue] = valore;

      const stato = norm(body.stato || body[fieldStatus]);
      if (stato) fields[fieldStatus] = stato;

      const apptId = norm(body.appuntamentoId || body.appointmentId || body[fieldAppt]);
      if (apptId) fields[fieldAppt] = asLinkArray(apptId);

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

