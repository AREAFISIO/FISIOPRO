// api/appointments.js
// - GET  /api/appointments?start=<iso>&end=<iso>  (agenda week range)
// - PATCH /api/appointments?id=<recId>            (update appointment fields)
//
// This endpoint powers the "scheda appuntamento" and is Airtable-backed.

import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";
import { asLinkArray, enc, escAirtableString, memGet, memGetOrSet, memSet, norm, readJsonBody, setPrivateCache } from "./_common.js";

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

async function probeField(tableEnc, candidate) {
  const name = String(candidate || "").trim();
  if (!name) return false;
  const qs = new URLSearchParams({ pageSize: "1" });
  qs.append("fields[]", name);
  try {
    await airtableFetch(`${tableEnc}?${qs.toString()}`);
    return true;
  } catch (e) {
    if (isUnknownFieldError(e?.message)) return false;
    throw e;
  }
}

async function resolveFieldName(tableEnc, cacheKey, candidates) {
  return await memGetOrSet(cacheKey, 60 * 60_000, async () => {
    for (const c of (candidates || []).filter(Boolean)) {
      if (await probeField(tableEnc, c)) return String(c).trim();
    }
    return "";
  });
}

function parseIsoOrEmpty(v) {
  const s = norm(v);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function parseIsoOrThrow(v, label = "datetime") {
  const s = norm(v);
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

function ymdToRange(dateYMD) {
  const [y, m, d] = String(dateYMD).split("-").map((x) => parseInt(x, 10));
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

function toMultiText(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  const s = norm(v);
  if (!s) return [];
  // Support comma-separated input
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toLinkArrayMaybe(v) {
  if (Array.isArray(v)) {
    const ids = v.filter((x) => typeof x === "string" && x.startsWith("rec"));
    return ids.length ? ids : null;
  }
  const id = norm(v);
  if (!id) return null;
  return [id];
}

function pickPatientName(fields) {
  const f = fields || {};
  const nome = String(f.Nome || "").trim();
  const cognome = String(f.Cognome || "").trim();
  const full = [nome, cognome].filter(Boolean).join(" ").trim();
  return (
    full ||
    String(f["Cognome e Nome"] || "").trim() ||
    String(f["Nome completo"] || "").trim() ||
    String(f.Name || "").trim() ||
    ""
  );
}

function pickCollaboratorName(fields) {
  const f = fields || {};
  const nome = String(f.Nome || "").trim();
  const cognome = String(f.Cognome || "").trim();
  const full = [nome, cognome].filter(Boolean).join(" ").trim();
  return (
    full ||
    String(f["Cognome e Nome"] || "").trim() ||
    String(f["Nome completo"] || "").trim() ||
    String(f.Name || "").trim() ||
    String(f["Full Name"] || "").trim() ||
    ""
  );
}

function pickServiceName(fields) {
  const f = fields || {};
  return String(f.Prestazione ?? f["Nome prestazione"] ?? f.Nome ?? f.Name ?? f["Servizio"] ?? "").trim();
}

function pickLocationName(fields) {
  const f = fields || {};
  return String(f.Nome ?? f["Nome sede"] ?? f.Sede ?? f.Name ?? "").trim();
}

async function fetchRecordNamesByIds({ tableName, ids, pickName, fields = [] }) {
  const tableEnc = enc(tableName);
  const all = (ids || []).filter((x) => typeof x === "string" && x.startsWith("rec"));
  if (!all.length) return {};
  const out = {};

  // Airtable formula length limits: chunk OR() reasonably.
  for (let i = 0; i < all.length; i += 30) {
    const chunk = all.slice(i, i + 30);
    const orParts = chunk.map((id) => `RECORD_ID()="${escAirtableString(id)}"`);
    const formula = `OR(${orParts.join(",")})`;
    const qs = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
    for (const f of fields) qs.append("fields[]", f);
    const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
    for (const r of data.records || []) {
      const name = String(pickName(r.fields) || "").trim();
      if (name) out[r.id] = name;
    }
  }

  return out;
}

async function resolveCollaboratorRecordIdByEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email) return "";

  const cacheKey = `collabIdByEmail:${email}`;
  const cached = memGet(cacheKey);
  if (cached) return cached;

  const collabTable = enc(process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI");
  const formula = `LOWER({Email}) = LOWER("${escAirtableString(email)}")`;
  const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", pageSize: "1" });
  const data = await airtableFetch(`${collabTable}?${qs.toString()}`);
  const recId = data.records?.[0]?.id || "";
  if (recId) memSet(cacheKey, recId, 10 * 60_000);
  return recId;
}

async function resolveSchema(tableEnc, tableName) {
  // Keep everything overrideable via env (bases differ).
  const FIELD_START = await resolveFieldName(
    tableEnc,
    `appts:field:start:${tableName}`,
    [
      process.env.AGENDA_START_FIELD,
      // Keep in sync with /api/agenda candidates (bases differ; Airtable is case-sensitive)
      "Data e Ora",
      "Data e ora",
      "Data e ora INIZIO",
      "Data e Ora INIZIO",
      "Data e ora Inizio",
      "Data e Ora Inizio",
      "Inizio",
      "Start",
      "Start at",
      "Inizio appuntamento",
      "DataOra Inizio",
      "DataOra INIZIO",
      "Data e ora INIZIO (manuale)",
      "Data e Ora INIZIO (manuale)",
      "Data e ora Inizio (manuale)",
      "Data e Ora Inizio (manuale)",
    ].filter(Boolean),
  );
  const FIELD_END = await resolveFieldName(
    tableEnc,
    `appts:field:end:${tableName}`,
    [
      process.env.AGENDA_END_FIELD,
      "Data e ora FINE",
      "Data e Ora FINE",
      "Data e ora Fine",
      "Data e Ora Fine",
      "Data e ora fine",
      "Fine",
      "End",
      "End at",
    ].filter(Boolean),
  );
  const FIELD_PATIENT = await resolveFieldName(
    tableEnc,
    `appts:field:patient:${tableName}`,
    [process.env.AGENDA_PATIENT_FIELD, "Paziente", "Pazienti", "Patient", "Patients"].filter(Boolean),
  );
  const FIELD_OPERATOR = await resolveFieldName(
    tableEnc,
    `appts:field:operator:${tableName}`,
    [process.env.AGENDA_OPERATOR_FIELD, "Collaboratore", "Operatore", "Fisioterapista"].filter(Boolean),
  );
  const FIELD_EMAIL = await resolveFieldName(
    tableEnc,
    `appts:field:email:${tableName}`,
    [process.env.AGENDA_EMAIL_FIELD, "Email", "E-mail", "email"].filter(Boolean),
  );

  const FIELD_STATUS = await resolveFieldName(
    tableEnc,
    `appts:field:status:${tableName}`,
    [process.env.AGENDA_STATUS_FIELD, "Stato appuntamento", "Stato", "Status"].filter(Boolean),
  );
  const FIELD_TYPE = await resolveFieldName(
    tableEnc,
    `appts:field:type:${tableName}`,
    [process.env.AGENDA_TYPE_FIELD, "Tipo appuntamento", "Tipologia", "Tipo", "Type"].filter(Boolean),
  );
  const FIELD_SERVICE = await resolveFieldName(
    tableEnc,
    `appts:field:service:${tableName}`,
    [process.env.AGENDA_SERVICE_FIELD, "Prestazione", "Servizio", "Service"].filter(Boolean),
  );
  const FIELD_LOCATION = await resolveFieldName(
    tableEnc,
    `appts:field:location:${tableName}`,
    [process.env.AGENDA_LOCATION_FIELD, "Posizione", "Posizione appuntamento", "Sede", "Sedi", "Location", "Luogo"].filter(Boolean),
  );
  const FIELD_DURATION = await resolveFieldName(
    tableEnc,
    `appts:field:duration:${tableName}`,
    [process.env.AGENDA_DURATION_FIELD, "Durata", "Durata (min)", "Minuti"].filter(Boolean),
  );

  const FIELD_QUICK_NOTE = await resolveFieldName(
    tableEnc,
    `appts:field:quick:${tableName}`,
    [process.env.AGENDA_QUICK_NOTE_FIELD, "Nota rapida", "Nota rapida (interna)", "Note interne", "Nota interna"].filter(Boolean),
  );
  const FIELD_NOTES = await resolveFieldName(
    tableEnc,
    `appts:field:notes:${tableName}`,
    [process.env.AGENDA_NOTES_FIELD, "Note", "Note paziente"].filter(Boolean),
  );

  const FIELD_TIPI_EROGATI = await resolveFieldName(
    tableEnc,
    `appts:field:tipiErogati:${tableName}`,
    [process.env.AGENDA_TIPI_EROGATI_FIELD, "Tipi Erogati", "Tipi erogati"].filter(Boolean),
  );
  const FIELD_VALUTAZIONI = await resolveFieldName(
    tableEnc,
    `appts:field:valutazioni:${tableName}`,
    [process.env.AGENDA_VALUTAZIONI_FIELD, "VALUTAZIONI", "Valutazioni"].filter(Boolean),
  );
  const FIELD_TRATTAMENTI = await resolveFieldName(
    tableEnc,
    `appts:field:trattamenti:${tableName}`,
    [process.env.AGENDA_TRATTAMENTI_FIELD, "TRATTAMENTI", "Trattamenti"].filter(Boolean),
  );
  const FIELD_EROGATO_COLLEGATO = await resolveFieldName(
    tableEnc,
    `appts:field:erogato:${tableName}`,
    [process.env.AGENDA_EROGATO_FIELD, "Erogato collegato", "Erogato", "Appuntamento collegato"].filter(Boolean),
  );
  const FIELD_CASO_CLINICO = await resolveFieldName(
    tableEnc,
    `appts:field:case:${tableName}`,
    [process.env.AGENDA_CASE_FIELD, "Caso clinico", "Caso", "Caso Clinico"].filter(Boolean),
  );
  const FIELD_VENDITA_COLLEGATA = await resolveFieldName(
    tableEnc,
    `appts:field:sale:${tableName}`,
    [process.env.AGENDA_SALE_FIELD, "Vendita collegata", "Vendita", "Sale"].filter(Boolean),
  );

  return {
    FIELD_START,
    FIELD_END,
    FIELD_PATIENT,
    FIELD_OPERATOR,
    FIELD_EMAIL,
    FIELD_STATUS,
    FIELD_TYPE,
    FIELD_SERVICE,
    FIELD_LOCATION,
    FIELD_DURATION,
    FIELD_QUICK_NOTE,
    FIELD_NOTES,
    FIELD_TIPI_EROGATI,
    FIELD_VALUTAZIONI,
    FIELD_TRATTAMENTI,
    FIELD_EROGATO_COLLEGATO,
    FIELD_CASO_CLINICO,
    FIELD_VENDITA_COLLEGATA,
  };
}

function mapAppointmentFromRecord({
  record,
  schema,
  patientNamesById = {},
  collaboratorNamesById = {},
  serviceNamesById = {},
  locationNamesById = {},
}) {
  const r = record || {};
  const f = r.fields || {};

  const getLinkId = (fieldName) => {
    const v = fieldName ? f[fieldName] : undefined;
    if (Array.isArray(v) && v.length) return String(v[0] || "");
    if (typeof v === "string") return v;
    return "";
  };
  const getLinkIds = (fieldName) => {
    const v = fieldName ? f[fieldName] : undefined;
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x)).filter(Boolean);
  };

  const patient_id = getLinkId(schema.FIELD_PATIENT);
  const patient_name =
    String(patientNamesById[patient_id] || "").trim() ||
    (Array.isArray(f[schema.FIELD_PATIENT]) && f[schema.FIELD_PATIENT].length && !String(f[schema.FIELD_PATIENT][0] || "").startsWith("rec")
      ? String(f[schema.FIELD_PATIENT][0] || "")
      : "") ||
    "";

  const therapist_id = getLinkId(schema.FIELD_OPERATOR);
  const therapist_name =
    String(collaboratorNamesById[therapist_id] || "").trim() ||
    (Array.isArray(f[schema.FIELD_OPERATOR]) && f[schema.FIELD_OPERATOR].length && !String(f[schema.FIELD_OPERATOR][0] || "").startsWith("rec")
      ? String(f[schema.FIELD_OPERATOR][0] || "")
      : "") ||
    (typeof f[schema.FIELD_OPERATOR] === "string" ? String(f[schema.FIELD_OPERATOR]) : "") ||
    "";

  const start_at = schema.FIELD_START ? String(f[schema.FIELD_START] || "") : "";
  const end_at = schema.FIELD_END ? String(f[schema.FIELD_END] || "") : "";

  const durationRaw = schema.FIELD_DURATION ? f[schema.FIELD_DURATION] : undefined;
  const duration_label =
    durationRaw === undefined || durationRaw === null || String(durationRaw).trim() === ""
      ? ""
      : typeof durationRaw === "number"
        ? `${durationRaw} min`
        : String(durationRaw);

  const tips = schema.FIELD_TIPI_EROGATI ? f[schema.FIELD_TIPI_EROGATI] : undefined;
  const tipi_erogati = Array.isArray(tips) ? tips.map((x) => String(x)).filter(Boolean) : toMultiText(tips);

  return {
    id: r.id,
    patient_id: patient_id || "",
    patient_name: patient_name || "",
    start_at,
    end_at,

    // Airtable-backed fields (scheda appuntamento)
    status: schema.FIELD_STATUS ? String(f[schema.FIELD_STATUS] ?? "") : "",
    appointment_type: schema.FIELD_TYPE ? String(f[schema.FIELD_TYPE] ?? "") : "",

    service_id: getLinkId(schema.FIELD_SERVICE),
    service_name: String(serviceNamesById[getLinkId(schema.FIELD_SERVICE)] || "").trim(),
    location_id: getLinkId(schema.FIELD_LOCATION),
    location_name: String(locationNamesById[getLinkId(schema.FIELD_LOCATION)] || "").trim(),

    therapist_id: therapist_id || "",
    therapist_name: therapist_name || "",

    duration: durationRaw ?? "",
    duration_label,

    // Keep backwards-compatible names used by the existing UI
    quick_note: schema.FIELD_QUICK_NOTE ? String(f[schema.FIELD_QUICK_NOTE] ?? "") : "",
    notes: schema.FIELD_NOTES ? String(f[schema.FIELD_NOTES] ?? "") : "",
    internal_note: schema.FIELD_QUICK_NOTE ? String(f[schema.FIELD_QUICK_NOTE] ?? "") : "",
    patient_note: schema.FIELD_NOTES ? String(f[schema.FIELD_NOTES] ?? "") : "",

    tipi_erogati,
    valutazioni_ids: getLinkIds(schema.FIELD_VALUTAZIONI),
    trattamenti_ids: getLinkIds(schema.FIELD_TRATTAMENTI),
    erogato_id: getLinkId(schema.FIELD_EROGATO_COLLEGATO),
    caso_clinico_id: getLinkId(schema.FIELD_CASO_CLINICO),
    vendita_id: getLinkId(schema.FIELD_VENDITA_COLLEGATA),
  };
}

async function listAppointments({ tableEnc, tableName, schema, startISO, endISO, session }) {
  if (!schema.FIELD_START) {
    const err = new Error("agenda_schema_mismatch: missing start field");
    err.status = 500;
    throw err;
  }

  const rangeFilter = `AND(
    OR(IS_AFTER({${schema.FIELD_START}}, "${startISO}"), IS_SAME({${schema.FIELD_START}}, "${startISO}")),
    IS_BEFORE({${schema.FIELD_START}}, "${endISO}")
  )`;

  const role = normalizeRole(session.role || "");
  const email = String(session.email || "").toLowerCase();

  let roleFilter = "TRUE()";
  if (role === "physio") {
    // Prefer linked Collaboratore filter; fallback to Email field if present.
    const collabRecId = schema.FIELD_OPERATOR ? await resolveCollaboratorRecordIdByEmail(email) : "";
    if (collabRecId && schema.FIELD_OPERATOR) {
      roleFilter = `FIND("${escAirtableString(collabRecId)}", ARRAYJOIN({${schema.FIELD_OPERATOR}}))`;
    } else if (schema.FIELD_EMAIL) {
      roleFilter = `LOWER({${schema.FIELD_EMAIL}}) = LOWER("${escAirtableString(email)}")`;
    } else {
      roleFilter = "FALSE()";
    }
  }

  const qs = new URLSearchParams({
    filterByFormula: `AND(${rangeFilter}, ${roleFilter})`,
    pageSize: "100",
  });
  qs.append("sort[0][field]", schema.FIELD_START);
  qs.append("sort[0][direction]", "asc");

  // Request only fields we render in the UI.
  const wantedFields = [
    schema.FIELD_START,
    schema.FIELD_END,
    schema.FIELD_PATIENT,
    schema.FIELD_OPERATOR,
    schema.FIELD_STATUS,
    schema.FIELD_TYPE,
    schema.FIELD_SERVICE,
    schema.FIELD_LOCATION,
    schema.FIELD_DURATION,
    schema.FIELD_QUICK_NOTE,
    schema.FIELD_NOTES,
    schema.FIELD_TIPI_EROGATI,
    schema.FIELD_VALUTAZIONI,
    schema.FIELD_TRATTAMENTI,
    schema.FIELD_EROGATO_COLLEGATO,
    schema.FIELD_CASO_CLINICO,
    schema.FIELD_VENDITA_COLLEGATA,
  ].filter(Boolean);
  for (const f of wantedFields) qs.append("fields[]", f);

  const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);

  // Resolve linked names for patient + collaborator (for a nice agenda render).
  const patientIds = new Set();
  const collaboratorIds = new Set();
  const serviceIds = new Set();
  const locationIds = new Set();
  for (const r of data.records || []) {
    const p = schema.FIELD_PATIENT ? r.fields?.[schema.FIELD_PATIENT] : undefined;
    if (Array.isArray(p)) for (const x of p) if (typeof x === "string" && x.startsWith("rec")) patientIds.add(x);
    const o = schema.FIELD_OPERATOR ? r.fields?.[schema.FIELD_OPERATOR] : undefined;
    if (Array.isArray(o)) for (const x of o) if (typeof x === "string" && x.startsWith("rec")) collaboratorIds.add(x);
    const s = schema.FIELD_SERVICE ? r.fields?.[schema.FIELD_SERVICE] : undefined;
    if (Array.isArray(s)) for (const x of s) if (typeof x === "string" && x.startsWith("rec")) serviceIds.add(x);
    const l = schema.FIELD_LOCATION ? r.fields?.[schema.FIELD_LOCATION] : undefined;
    if (Array.isArray(l)) for (const x of l) if (typeof x === "string" && x.startsWith("rec")) locationIds.add(x);
  }

  const patientsTable = process.env.AIRTABLE_PATIENTS_TABLE || "ANAGRAFICA";
  const collaboratorsTable = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";
  const servicesTable = process.env.AIRTABLE_SERVICES_TABLE || process.env.AIRTABLE_PRESTAZIONI_TABLE || "PRESTAZIONI";
  const locationsTable = process.env.AIRTABLE_LOCATIONS_TABLE || "SEDI";
  const aziendaTable = process.env.AIRTABLE_COMPANY_TABLE || process.env.AIRTABLE_AZIENDA_TABLE || "AZIENDA";

  const [patientNamesById, collaboratorNamesById, serviceNamesById, locationNamesByIdInitial] = await Promise.all([
    fetchRecordNamesByIds({
      tableName: patientsTable,
      ids: Array.from(patientIds),
      pickName: pickPatientName,
      fields: ["Nome", "Cognome", "Cognome e Nome", "Nome completo", "Name"],
    }),
    fetchRecordNamesByIds({
      tableName: collaboratorsTable,
      ids: Array.from(collaboratorIds),
      pickName: pickCollaboratorName,
      fields: ["Nome", "Cognome", "Cognome e Nome", "Nome completo", "Name", "Full Name"],
    }),
    fetchRecordNamesByIds({
      tableName: servicesTable,
      ids: Array.from(serviceIds),
      pickName: pickServiceName,
      fields: ["Prestazione", "Nome prestazione", "Nome", "Name", "Servizio"],
    }),
    fetchRecordNamesByIds({
      tableName: locationsTable,
      ids: Array.from(locationIds),
      pickName: pickLocationName,
      fields: ["Nome", "Nome sede", "Sede", "Name", "Ragione Sociale", "Azienda"],
    }),
  ]);

  // If location IDs don't belong to the default locations table (e.g. linked to AZIENDA),
  // fall back to AZIENDA to resolve display names (so UI doesn't show rec...).
  let locationNamesById = locationNamesByIdInitial || {};
  if (locationIds.size && Object.keys(locationNamesById).length === 0) {
    try {
      const fromAzienda = await fetchRecordNamesByIds({
        tableName: aziendaTable,
        ids: Array.from(locationIds),
        pickName: pickLocationName,
        fields: ["Nome", "Nome sede", "Sede", "Name", "Ragione Sociale", "Azienda"],
      });
      locationNamesById = { ...locationNamesById, ...(fromAzienda || {}) };
    } catch {
      // ignore: keep empty mapping
    }
  }

  const appointments = (data.records || []).map((r) =>
    mapAppointmentFromRecord({
      record: r,
      schema,
      patientNamesById,
      collaboratorNamesById,
      serviceNamesById,
      locationNamesById,
    }),
  );

  return { appointments };
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

    const tableName = process.env.AGENDA_TABLE || "APPUNTAMENTI";
    const tableEnc = enc(tableName);
    const schema = await resolveSchema(tableEnc, tableName);

    if (req.method === "GET") {
      setPrivateCache(res, 30);

      // Back-compat: allow ?date=YYYY-MM-DD
      const date = norm(req.query?.date);
      const startRaw = norm(req.query?.start);
      const endRaw = norm(req.query?.end);

      let startISO = "";
      let endISO = "";
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "date must be YYYY-MM-DD" });
        const r = ymdToRange(date);
        startISO = r.startISO;
        endISO = r.endISO;
      } else {
        startISO = parseIsoOrEmpty(startRaw);
        endISO = parseIsoOrEmpty(endRaw);
      }

      if (!startISO || !endISO) {
        return res.status(400).json({ ok: false, error: "missing_start_end" });
      }

      const { appointments } = await listAppointments({ tableEnc, tableName, schema, startISO, endISO, session });
      return res.status(200).json({ ok: true, appointments });
    }

    if (req.method === "PATCH") {
      const id = norm(req.query?.id);
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });

      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const fields = {};

      // Text fields: if present, allow clearing by sending "".
      if (schema.FIELD_STATUS && ("status" in body || "stato" in body || "statoAppuntamento" in body)) {
        fields[schema.FIELD_STATUS] = norm(body.status ?? body.stato ?? body.statoAppuntamento);
      }
      if (schema.FIELD_TYPE && ("appointment_type" in body || "tipoAppuntamento" in body || "type" in body)) {
        fields[schema.FIELD_TYPE] = norm(body.appointment_type ?? body.tipoAppuntamento ?? body.type);
      }
      if (schema.FIELD_QUICK_NOTE && ("quick_note" in body || "notaRapida" in body || "internal_note" in body)) {
        fields[schema.FIELD_QUICK_NOTE] = norm(body.quick_note ?? body.notaRapida ?? body.internal_note);
      }
      if (schema.FIELD_NOTES && ("notes" in body || "note" in body || "patient_note" in body)) {
        fields[schema.FIELD_NOTES] = norm(body.notes ?? body.note ?? body.patient_note);
      }

      // Date/time fields (drag & drop support)
      const startRaw = body.start_at ?? body.startAt ?? body.startISO ?? body.start;
      // If the caller is trying to move/change the datetime, we must have a start field mapped.
      if (startRaw !== undefined && !schema.FIELD_START) {
        const err = new Error("agenda_schema_mismatch: missing start field");
        err.status = 500;
        throw err;
      }
      if (schema.FIELD_START && startRaw !== undefined) {
        const iso = startRaw === null || String(startRaw).trim() === "" ? "" : parseIsoOrThrow(startRaw, "start_at");
        // Allow clearing only if caller explicitly passes empty; otherwise require a valid datetime.
        fields[schema.FIELD_START] = iso || null;
      }
      const endRaw = body.end_at ?? body.endAt ?? body.endISO ?? body.end;
      if (schema.FIELD_END && endRaw !== undefined) {
        const iso = endRaw === null || String(endRaw).trim() === "" ? "" : parseIsoOrThrow(endRaw, "end_at");
        fields[schema.FIELD_END] = iso || null;
      }

      // Linked fields
      const serviceRaw = body.service_id ?? body.serviceId ?? body.prestazioneId;
      if (schema.FIELD_SERVICE && serviceRaw !== undefined) {
        const serviceId = norm(serviceRaw);
        fields[schema.FIELD_SERVICE] = serviceId ? [serviceId] : [];
      }

      const operatorRaw = body.therapist_id ?? body.operatorId ?? body.collaboratoreId;
      if (schema.FIELD_OPERATOR && operatorRaw !== undefined) {
        const operatorId = norm(operatorRaw);
        fields[schema.FIELD_OPERATOR] = operatorId ? [operatorId] : [];
      }

      const locationRaw = body.location_id ?? body.locationId ?? body.sedeId;
      if (schema.FIELD_LOCATION && locationRaw !== undefined) {
        const locationId = norm(locationRaw);
        fields[schema.FIELD_LOCATION] = locationId ? [locationId] : [];
      }

      const erogatoRaw = body.erogato_id ?? body.erogatoId;
      if (schema.FIELD_EROGATO_COLLEGATO && erogatoRaw !== undefined) {
        const erogatoId = norm(erogatoRaw);
        fields[schema.FIELD_EROGATO_COLLEGATO] = erogatoId ? [erogatoId] : [];
      }

      const casoRaw = body.caso_clinico_id ?? body.casoClinicoId ?? body.caseId;
      if (schema.FIELD_CASO_CLINICO && casoRaw !== undefined) {
        const casoId = norm(casoRaw);
        fields[schema.FIELD_CASO_CLINICO] = casoId ? [casoId] : [];
      }

      const venditaRaw = body.vendita_id ?? body.venditaId ?? body.saleId;
      if (schema.FIELD_VENDITA_COLLEGATA && venditaRaw !== undefined) {
        const venditaId = norm(venditaRaw);
        fields[schema.FIELD_VENDITA_COLLEGATA] = venditaId ? [venditaId] : [];
      }

      // Multi-link
      const valutazioniRaw = body.valutazioni_ids ?? body.valutazioniIds;
      if (schema.FIELD_VALUTAZIONI && valutazioniRaw !== undefined) {
        const valutazioniIds = toLinkArrayMaybe(valutazioniRaw);
        fields[schema.FIELD_VALUTAZIONI] = valutazioniIds || [];
      }

      const trattamentiRaw = body.trattamenti_ids ?? body.trattamentiIds;
      if (schema.FIELD_TRATTAMENTI && trattamentiRaw !== undefined) {
        const trattamentiIds = toLinkArrayMaybe(trattamentiRaw);
        fields[schema.FIELD_TRATTAMENTI] = trattamentiIds || [];
      }

      // Multi-select / text list
      const tipiErogati = body.tipi_erogati ?? body.tipiErogati;
      if (schema.FIELD_TIPI_EROGATI && tipiErogati !== undefined) {
        const arr = toMultiText(tipiErogati);
        // If empty, clear field; else set list.
        fields[schema.FIELD_TIPI_EROGATI] = arr.length ? arr : [];
      }

      const durata = body.duration ?? body.durata ?? body.durationMin;
      if (schema.FIELD_DURATION && durata !== undefined) {
        if (durata === null || String(durata).trim() === "") {
          fields[schema.FIELD_DURATION] = null;
        } else {
          const n = Number(durata);
          fields[schema.FIELD_DURATION] = Number.isFinite(n) ? n : durata;
        }
      }

      if (!Object.keys(fields).length) {
        // Nothing to update; still return current record representation
        const record = await airtableFetch(`${tableEnc}/${enc(id)}`);
        const appt = mapAppointmentFromRecord({ record, schema });
        return res.status(200).json({ ok: true, appointment: appt });
      }

      const updated = await airtableFetch(`${tableEnc}/${enc(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });

      // Best-effort: include resolved patient/operator names in response.
      const rec = { id: updated.id, fields: updated.fields || {} };
      const pat = schema.FIELD_PATIENT ? rec.fields?.[schema.FIELD_PATIENT] : undefined;
      const op = schema.FIELD_OPERATOR ? rec.fields?.[schema.FIELD_OPERATOR] : undefined;
      const patId = Array.isArray(pat) && pat.length ? String(pat[0] || "") : "";
      const opId = Array.isArray(op) && op.length ? String(op[0] || "") : "";

      const patientsTable = process.env.AIRTABLE_PATIENTS_TABLE || "ANAGRAFICA";
      const collaboratorsTable = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";
      const servicesTable = process.env.AIRTABLE_SERVICES_TABLE || process.env.AIRTABLE_PRESTAZIONI_TABLE || "PRESTAZIONI";
      const locationsTable = process.env.AIRTABLE_LOCATIONS_TABLE || "SEDI";

      const serv = schema.FIELD_SERVICE ? rec.fields?.[schema.FIELD_SERVICE] : undefined;
      const loc = schema.FIELD_LOCATION ? rec.fields?.[schema.FIELD_LOCATION] : undefined;
      const servId = Array.isArray(serv) && serv.length ? String(serv[0] || "") : "";
      const locId = Array.isArray(loc) && loc.length ? String(loc[0] || "") : "";

      const [patientNamesById, collaboratorNamesById, serviceNamesById, locationNamesById] = await Promise.all([
        patId
          ? fetchRecordNamesByIds({
              tableName: patientsTable,
              ids: [patId],
              pickName: pickPatientName,
              fields: ["Nome", "Cognome", "Cognome e Nome", "Nome completo", "Name"],
            })
          : Promise.resolve({}),
        opId
          ? fetchRecordNamesByIds({
              tableName: collaboratorsTable,
              ids: [opId],
              pickName: pickCollaboratorName,
              fields: ["Nome", "Cognome", "Cognome e Nome", "Nome completo", "Name", "Full Name"],
            })
          : Promise.resolve({}),
        servId
          ? fetchRecordNamesByIds({
              tableName: servicesTable,
              ids: [servId],
              pickName: pickServiceName,
              fields: ["Prestazione", "Nome prestazione", "Nome", "Name", "Servizio"],
            })
          : Promise.resolve({}),
        locId
          ? fetchRecordNamesByIds({
              tableName: locationsTable,
              ids: [locId],
              pickName: pickLocationName,
              fields: ["Nome", "Nome sede", "Sede", "Name"],
            })
          : Promise.resolve({}),
      ]);

      const appointment = mapAppointmentFromRecord({
        record: rec,
        schema,
        patientNamesById,
        collaboratorNamesById,
        serviceNamesById,
        locationNamesById,
      });

      return res.status(200).json({ ok: true, appointment });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}
