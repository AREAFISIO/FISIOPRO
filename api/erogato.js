import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { asLinkArray, enc, norm, readJsonBody, filterByLinkedRecordId } from "./_common.js";
import {
  airtableCreate,
  airtableList,
  airtableUpdate,
  escAirtableString as escAirtableStringLib,
  resolveLinkedIds,
} from "../lib/airtableClient.js";

function parseIsoOrThrow(v, label = "datetime") {
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
      // -----------------------------
      // NEW CONTRACT (requested):
      // GET /api/erogato?from=ISO&to=ISO&collaboratore=...
      // - Uses fixed schema field names from Airtable CSV export
      // -----------------------------
      const fromISOParam = norm(req.query?.from);
      const toISOParam = norm(req.query?.to);
      if (fromISOParam && toISOParam) {
        const fromISO = parseIsoOrThrow(fromISOParam, "from");
        const toISO = parseIsoOrThrow(toISOParam, "to");

        const rangeFilter = `AND({Data e ora INIZIO} >= DATETIME_PARSE("${escAirtableStringLib(fromISO)}"), {Data e ora INIZIO} <= DATETIME_PARSE("${escAirtableStringLib(toISO)}"))`;

        const collaboratoreParam = norm(req.query?.collaboratore);
        let collabFilter = "TRUE()";
        if (collaboratoreParam) {
          const collabId = collaboratoreParam.startsWith("rec")
            ? collaboratoreParam
            : (await resolveLinkedIds({ table: "COLLABORATORI", values: collaboratoreParam }))[0];
          collabFilter = `FIND("${escAirtableStringLib(collabId)}", ARRAYJOIN({Collaboratore}))`;
        }

        const formula = `AND(${rangeFilter}, ${collabFilter})`;
        const { records } = await airtableList("EROGATO", {
          filterByFormula: formula,
          sort: [{ field: "Data e ora INIZIO", direction: "asc" }],
          maxRecords: 2000,
          fields: [
            "Data e ora INIZIO",
            "Data e ora FINE",
            "Minuti lavoro",
            "Appuntamento",
            "Caso clinico",
            "CASI CLINICI",
            "Paziente",
            "Collaboratore",
            "Tipo lavoro ",
            "Tipo lavoro (da prestazioni)",
            "Esito economico",
          ],
        });

        return res.status(200).json({
          ok: true,
          records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
        });
      }

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

      // -----------------------------
      // NEW CONTRACT (requested):
      // POST /api/erogato -> create/update erogato linked to Appuntamento/Caso/Paziente/Collaboratore
      // If recordId is missing but appointmentRecordId is present, upsert by linked Appuntamento.
      // -----------------------------
      const maybeNew =
        body.start ||
        body.startISO ||
        body.start_at ||
        body["Data e ora INIZIO"] ||
        body["Data e ora FINE"] ||
        body.end ||
        body.endISO ||
        body.end_at ||
        body.appointmentRecordId ||
        body.appuntamentoRecordId;

      if (maybeNew) {
        const recordId = norm(body.recordId || body.id);

        const startISO = parseIsoOrThrow(body["Data e ora INIZIO"] ?? body.start ?? body.startISO ?? body.start_at ?? body.startAt, "start_at");
        const endISO = parseIsoOrThrow(body["Data e ora FINE"] ?? body.end ?? body.endISO ?? body.end_at ?? body.endAt, "end_at");

        let minuti = body["Minuti lavoro"] ?? body.minutiLavoro ?? body.minutes ?? body.minuti ?? body.durationMinutes;
        if (minuti === undefined || minuti === null || String(minuti).trim() === "") {
          const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
          minuti = Math.max(0, Math.round(ms / 60000));
        }

        const appointmentVal = body.appointmentRecordId ?? body.appuntamentoRecordId ?? body["Appuntamento"] ?? body.appuntamento;
        const pazienteVal = body.patientRecordId ?? body.pazienteRecordId ?? body["Paziente"] ?? body.paziente;
        const collaboratoreVal = body.collaboratoreRecordId ?? body.operatorRecordId ?? body["Collaboratore"] ?? body.collaboratore;
        const casoVal = body.caseRecordId ?? body.casoClinicoRecordId ?? body["Caso clinico"] ?? body["CASI CLINICI"] ?? body.casoClinico;

        if (!pazienteVal) return res.status(400).json({ ok: false, error: "missing_paziente" });
        if (!collaboratoreVal) return res.status(400).json({ ok: false, error: "missing_collaboratore" });

        const [pazienteId] = await resolveLinkedIds({ table: "ANAGRAFICA", values: pazienteVal });
        const [collaboratoreId] = await resolveLinkedIds({ table: "COLLABORATORI", values: collaboratoreVal });
        const appointmentIds = appointmentVal ? await resolveLinkedIds({ table: "APPUNTAMENTI", values: appointmentVal, allowMissing: true }) : [];
        const casoIds = casoVal ? await resolveLinkedIds({ table: "CASI CLINICI", values: casoVal, allowMissing: true }) : [];

        const fields = {
          "Data e ora INIZIO": startISO,
          "Data e ora FINE": endISO,
          "Minuti lavoro": Number(minuti),
          Paziente: [pazienteId],
          Collaboratore: [collaboratoreId],
        };

        if (appointmentIds.length) fields["Appuntamento"] = appointmentIds;
        if (casoIds.length) {
          // Some bases use both "Caso clinico" and "CASI CLINICI" – keep them aligned.
          fields["Caso clinico"] = casoIds;
          fields["CASI CLINICI"] = casoIds;
        }

        const tipoLavoro = norm(body["Tipo lavoro "] ?? body.tipoLavoro ?? body.tipo_lavoro);
        if (tipoLavoro) fields["Tipo lavoro "] = tipoLavoro;

        const esito = norm(body["Esito economico"] ?? body.esitoEconomico);
        if (esito) fields["Esito economico"] = esito;

        // Upsert strategy:
        // 1) if recordId provided -> update
        // 2) else if appointment link provided -> find existing by linked appointment and update
        // 3) else -> create
        let targetId = recordId;
        if (!targetId && appointmentIds.length) {
          const apptId = appointmentIds[0];
          const formula = `FIND("${escAirtableStringLib(apptId)}", ARRAYJOIN({Appuntamento}))`;
          const found = await airtableList("EROGATO", { filterByFormula: formula, maxRecords: 1, pageSize: 1, fields: ["Appuntamento"] });
          targetId = found.records?.[0]?.id || "";
        }

        const out = targetId ? await airtableUpdate("EROGATO", targetId, fields) : await airtableCreate("EROGATO", fields);

        // Best-effort: if this erogato is linked to an appointment, also link it back to
        // any VALUTAZIONI/TRATTAMENTI that reference the same appointment.
        try {
          const erogatoId = out?.id || "";
          const apptId = appointmentIds?.[0] || "";
          if (erogatoId && apptId) {
            const fAppt = `FIND("${escAirtableStringLib(apptId)}", ARRAYJOIN({Appuntamento}))`;

            const [vals, trts] = await Promise.all([
              airtableList("VALUTAZIONI", { filterByFormula: fAppt, maxRecords: 10, pageSize: 10, fields: ["Appuntamento", "Erogato"] }).catch(() => ({ records: [] })),
              airtableList("TRATTAMENTI", { filterByFormula: fAppt, maxRecords: 10, pageSize: 10, fields: ["Appuntamento", "Erogato"] }).catch(() => ({ records: [] })),
            ]);

            await Promise.all([
              ...((vals.records || []).map((r) => airtableUpdate("VALUTAZIONI", r.id, { Erogato: [erogatoId] }).catch(() => null))),
              ...((trts.records || []).map((r) => airtableUpdate("TRATTAMENTI", r.id, { Erogato: [erogatoId] }).catch(() => null))),
            ]);
          }
        } catch {
          // ignore (best-effort)
        }

        return res.status(200).json({ ok: true, record: { id: out.id, fields: out.fields || {}, createdTime: out.createdTime || "" } });
      }

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

