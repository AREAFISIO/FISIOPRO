// api/appointments.js
// - GET  /api/appointments?start=<iso>&end=<iso>  (agenda week range)
// - PATCH /api/appointments?id=<recId>            (update appointment fields)
//
// This endpoint powers the "scheda appuntamento" and is Airtable-backed.

import crypto from "node:crypto";
import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";
import { asLinkArray, enc, escAirtableString, memGet, memGetOrSet, memSet, norm, readJsonBody, setPrivateCache } from "./_common.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";
import {
  airtableCreate,
  airtableList,
  airtableUpdate,
  escAirtableString as escAirtableStringLib,
  resolveLinkedIds,
} from "../lib/airtableClient.js";
import { airtableSchema } from "../lib/airtableClient.js";

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

function normalizeKeyLoose(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function resolveFieldFromSchema(tableName, candidates) {
  const t = String(tableName || "").trim();
  const schema = airtableSchema?.[t] || null;
  const keys = Array.isArray(schema?.all_fields)
    ? schema.all_fields
    : (Array.isArray(schema?.key_fields) ? schema.key_fields : []);
  const list = (keys || []).map((k) => String(k || "")).filter(Boolean);
  if (!list.length) return "";

  const byLower = new Map(list.map((k) => [String(k).toLowerCase(), String(k)]));
  for (const c of (candidates || []).filter(Boolean)) {
    const want = String(c || "").trim();
    if (!want) continue;
    const hit = byLower.get(want.toLowerCase());
    if (hit) return hit;
  }

  const byLoose = new Map(list.map((k) => [normalizeKeyLoose(k), String(k)]));
  for (const c of (candidates || []).filter(Boolean)) {
    const wantLoose = normalizeKeyLoose(c);
    if (!wantLoose) continue;
    const hit = byLoose.get(wantLoose);
    if (hit) return hit;
  }

  return "";
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

async function resolveFieldName(tableEnc, cacheKey, candidates, tableNameForSchema = "") {
  return await memGetOrSet(cacheKey, 60 * 60_000, async () => {
    // Fast-path: resolve from local schema snapshot (zero network calls).
    const fromSchema = resolveFieldFromSchema(tableNameForSchema, candidates);
    if (fromSchema) {
      // Safety: schema snapshots can drift. Verify the field exists in the current base.
      // If it doesn't, fall back to probing candidates.
      try {
        if (await probeField(tableEnc, fromSchema)) return fromSchema;
      } catch {
        // ignore and continue with candidate probing
      }
    }
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

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = norm(v).toLowerCase();
  if (!s) return false;
  if (s === "1" || s === "true" || s === "yes" || s === "si" || s === "sì" || s === "ok") return true;
  if (s === "0" || s === "false" || s === "no") return false;
  // Airtable checkbox sometimes returns true/false, but if a base uses text, treat any non-empty as true.
  return true;
}

async function fetchRecordNamesByIds({ tableName, ids, pickName, fields = [] }) {
  const tableEnc = enc(tableName);
  const all = (ids || []).filter((x) => typeof x === "string" && x.startsWith("rec"));
  if (!all.length) return {};
  const out = {};

  // Warm-instance cache: avoid re-fetching names for the same record IDs.
  // This drastically reduces Airtable calls when navigating or refreshing views.
  const missing = [];
  for (const id of all) {
    const k = `name:${tableName}:${id}`;
    const cached = memGet(k);
    if (typeof cached === "string" && cached.trim()) out[id] = cached;
    else missing.push(id);
  }
  if (!missing.length) return out;

  // Airtable formula length limits: chunk OR() reasonably.
  for (let i = 0; i < missing.length; i += 30) {
    const chunk = missing.slice(i, i + 30);
    const orParts = chunk.map((id) => `RECORD_ID()="${escAirtableString(id)}"`);
    const formula = `OR(${orParts.join(",")})`;
    const qs = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
    for (const f of fields) qs.append("fields[]", f);

    let data;
    try {
      data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
    } catch (e) {
      // Some bases don't have optional fields like "Cognome e Nome".
      // If Airtable rejects any requested field, retry without fields[] (fetch all fields).
      if (isUnknownFieldError(e?.message)) {
        const qs2 = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
        data = await airtableFetch(`${tableEnc}?${qs2.toString()}`);
      } else {
        throw e;
      }
    }
    for (const r of data.records || []) {
      const name = String(pickName(r.fields) || "").trim();
      if (name) {
        out[r.id] = name;
        memSet(`name:${tableName}:${r.id}`, name, 6 * 60 * 60_000);
      }
    }
  }

  return out;
}

async function resolveCollaboratorRecordIdByEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email) return "";

  // Some Airtable bases use different collaborator email field names (Airtable is case-sensitive).
  // Resolve once per warm instance to avoid hard-coding {Email}.
  const collabTableName = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";
  const collabTableEnc = enc(collabTableName);
  const emailField = await resolveFieldName(
    collabTableEnc,
    `collab:field:email:${collabTableName}`,
    [process.env.COLLAB_EMAIL_FIELD, "Email", "E-mail", "email"].filter(Boolean),
    collabTableName,
  );
  if (!emailField) return "";

  const cacheKey = `collabIdByEmail:${email}`;
  const cached = memGet(cacheKey);
  if (cached) return cached;

  const formula = `LOWER({${emailField}}) = LOWER("${escAirtableString(email)}")`;
  const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", pageSize: "1" });
  const data = await airtableFetch(`${collabTableEnc}?${qs.toString()}`);
  const recId = data.records?.[0]?.id || "";
  if (recId) memSet(cacheKey, recId, 10 * 60_000);
  return recId;
}

async function resolveCollaboratorRecordIdForSession(session, schema) {
  // "Infallibile" mapping: try email first, then fallback to name/surname search.
  const email = String(session?.email || "").trim().toLowerCase();
  const nome = String(session?.nome || "").trim();
  const cognome = String(session?.cognome || "").trim();

  // 1) by email (best)
  const byEmail = await resolveCollaboratorRecordIdByEmail(email);
  if (byEmail) return byEmail;

  // 2) by name/surname (fallback when emails don't match between auth and Airtable)
  const full = [nome, cognome].filter(Boolean).join(" ").trim();
  if (!full) return "";

  const collabTableName = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";
  const collabTableEnc = enc(collabTableName);

  // Resolve likely name fields once.
  const FIELD_NOME = await resolveFieldName(
    collabTableEnc,
    `collab:field:nome:${collabTableName}`,
    ["Nome", "First name", "Firstname"].filter(Boolean),
    collabTableName,
  );
  const FIELD_COGNOME = await resolveFieldName(
    collabTableEnc,
    `collab:field:cognome:${collabTableName}`,
    ["Cognome", "Last name", "Lastname"].filter(Boolean),
    collabTableName,
  );
  // Primary-like label field (common in schema)
  const FIELD_COLLAB = await resolveFieldName(
    collabTableEnc,
    `collab:field:primary:${collabTableName}`,
    [process.env.COLLAB_PRIMARY_FIELD, "Collaboratore", "Nome completo", "Cognome e Nome", "Full Name", "Name"].filter(Boolean),
    collabTableName,
  );

  const parts = [];
  const nLow = escAirtableString(nome.toLowerCase());
  const cLow = escAirtableString(cognome.toLowerCase());
  const fullLow = escAirtableString(full.toLowerCase());
  if (FIELD_NOME && nome) parts.push(`LOWER({${FIELD_NOME}}&"") = "${nLow}"`);
  if (FIELD_COGNOME && cognome) parts.push(`LOWER({${FIELD_COGNOME}}&"") = "${cLow}"`);
  // Also match full label field (contains or equals)
  if (FIELD_COLLAB) parts.push(`FIND("${fullLow}", LOWER({${FIELD_COLLAB}}&""))`);
  if (!parts.length) return "";

  const formula = `OR(${parts.join(",")})`;
  const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", pageSize: "1" });
  const data = await airtableFetch(`${collabTableEnc}?${qs.toString()}`);
  return data.records?.[0]?.id || "";
}

async function resolveSchemaLite(tableEnc, tableName) {
  // Critical-path schema: only fields needed to render the agenda grid fast.
  // This avoids probing dozens of optional fields on cold starts (which can time out clients).
  const [
    FIELD_START,
    FIELD_END,
    FIELD_PATIENT,
    FIELD_OPERATOR,
    FIELD_EMAIL,
    FIELD_STATUS,
    FIELD_TYPE,
    FIELD_SERVICE,
    FIELD_DURATION,
    FIELD_CONFIRMED_BY_PATIENT,
    FIELD_CONFIRMED_IN_PLATFORM,
    FIELD_QUICK_NOTE,
    FIELD_NOTES,
  ] = await Promise.all([
    resolveFieldName(
      tableEnc,
      `appts:field:start:${tableName}`,
      [
        process.env.AGENDA_START_FIELD,
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
      tableName,
    ),
    resolveFieldName(
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
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:patient:${tableName}`,
      [process.env.AGENDA_PATIENT_FIELD, "Paziente", "Pazienti", "Patient", "Patients"].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:operator:${tableName}`,
      [process.env.AGENDA_OPERATOR_FIELD, "Collaboratore", "Operatore", "Fisioterapista"].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:email:${tableName}`,
      [process.env.AGENDA_EMAIL_FIELD, "Email", "E-mail", "email"].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:status:${tableName}`,
      [process.env.AGENDA_STATUS_FIELD, "Stato appuntamento", "Stato", "Status"].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:type:${tableName}`,
      // Some bases use "Voce agenda" or "Tipo lavoro" instead of a dedicated "Tipo appuntamento".
      [process.env.AGENDA_TYPE_FIELD, "Voce agenda", "Tipo lavoro", "Tipo appuntamento", "Tipologia", "Tipo", "Type"].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:service:${tableName}`,
      // In this project the common linked field is "Prestazione prevista" (see airtableSchema.json).
      [process.env.AGENDA_SERVICE_FIELD, "Prestazione prevista", "Prestazione", "Servizio", "Service"].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:duration:${tableName}`,
      [process.env.AGENDA_DURATION_FIELD, "Durata (minuti)", "Durata (min)", "Durata", "Minuti"].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:confirmedByPatient:${tableName}`,
      [
        process.env.AGENDA_CONFIRMED_BY_PATIENT_FIELD,
        "Confermato dal paziente",
        "Conferma del paziente",
        "Conferma paziente",
        "Paziente confermato",
        "Confermato paziente",
      ].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:confirmedInPlatform:${tableName}`,
      [
        process.env.AGENDA_CONFIRMED_IN_PLATFORM_FIELD,
        "Conferma in InBuoneMani",
        "Conferma in piattaforma",
        "Confermato in piattaforma",
        "Confermato in InBuoneMani",
        "InBuoneMani",
      ].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:quick:${tableName}`,
      [process.env.AGENDA_QUICK_NOTE_FIELD, "Nota rapida", "Nota rapida (interna)", "Note interne", "Nota interna"].filter(Boolean),
      tableName,
    ),
    resolveFieldName(
      tableEnc,
      `appts:field:notes:${tableName}`,
      [process.env.AGENDA_NOTES_FIELD, "Note", "Note paziente"].filter(Boolean),
      tableName,
    ),
  ]);

  return {
    FIELD_START,
    FIELD_END,
    FIELD_PATIENT,
    FIELD_OPERATOR,
    FIELD_EMAIL,
    FIELD_STATUS,
    FIELD_TYPE,
    FIELD_SERVICE,
    FIELD_LOCATION: "",
    FIELD_DURATION,
    FIELD_CONFIRMED_BY_PATIENT,
    FIELD_CONFIRMED_IN_PLATFORM,
    FIELD_QUICK_NOTE,
    FIELD_NOTES,
    FIELD_TIPI_EROGATI: "",
    FIELD_VALUTAZIONI: "",
    FIELD_TRATTAMENTI: "",
    FIELD_EROGATO_COLLEGATO: "",
    FIELD_CASO_CLINICO: "",
    FIELD_VENDITA_COLLEGATA: "",
  };
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
    tableName,
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
    tableName,
  );
  const FIELD_PATIENT = await resolveFieldName(
    tableEnc,
    `appts:field:patient:${tableName}`,
    [process.env.AGENDA_PATIENT_FIELD, "Paziente", "Pazienti", "Patient", "Patients"].filter(Boolean),
    tableName,
  );
  const FIELD_OPERATOR = await resolveFieldName(
    tableEnc,
    `appts:field:operator:${tableName}`,
    [process.env.AGENDA_OPERATOR_FIELD, "Collaboratore", "Operatore", "Fisioterapista"].filter(Boolean),
    tableName,
  );
  const FIELD_EMAIL = await resolveFieldName(
    tableEnc,
    `appts:field:email:${tableName}`,
    [process.env.AGENDA_EMAIL_FIELD, "Email", "E-mail", "email"].filter(Boolean),
    tableName,
  );

  const FIELD_STATUS = await resolveFieldName(
    tableEnc,
    `appts:field:status:${tableName}`,
    [process.env.AGENDA_STATUS_FIELD, "Stato appuntamento", "Stato", "Status"].filter(Boolean),
    tableName,
  );
  const FIELD_TYPE = await resolveFieldName(
    tableEnc,
    `appts:field:type:${tableName}`,
    [process.env.AGENDA_TYPE_FIELD, "Voce agenda", "Tipo lavoro", "Tipo appuntamento", "Tipologia", "Tipo", "Type"].filter(Boolean),
    tableName,
  );
  const FIELD_SERVICE = await resolveFieldName(
    tableEnc,
    `appts:field:service:${tableName}`,
    [process.env.AGENDA_SERVICE_FIELD, "Prestazione prevista", "Prestazione", "Servizio", "Service"].filter(Boolean),
    tableName,
  );
  const FIELD_LOCATION = await resolveFieldName(
    tableEnc,
    `appts:field:location:${tableName}`,
    [process.env.AGENDA_LOCATION_FIELD, "Posizione", "Posizione appuntamento", "Sede", "Sedi", "Location", "Luogo"].filter(Boolean),
    tableName,
  );
  const FIELD_DURATION = await resolveFieldName(
    tableEnc,
    `appts:field:duration:${tableName}`,
    [process.env.AGENDA_DURATION_FIELD, "Durata (minuti)", "Durata (min)", "Durata", "Minuti"].filter(Boolean),
    tableName,
  );

  const FIELD_CONFIRMED_BY_PATIENT = await resolveFieldName(
    tableEnc,
    `appts:field:confirmedByPatient:${tableName}`,
    [
      process.env.AGENDA_CONFIRMED_BY_PATIENT_FIELD,
      "Confermato dal paziente",
      "Conferma del paziente",
      "Conferma paziente",
      "Paziente confermato",
      "Confermato paziente",
    ].filter(Boolean),
    tableName,
  );
  const FIELD_CONFIRMED_IN_PLATFORM = await resolveFieldName(
    tableEnc,
    `appts:field:confirmedInPlatform:${tableName}`,
    [
      process.env.AGENDA_CONFIRMED_IN_PLATFORM_FIELD,
      "Conferma in InBuoneMani",
      "Conferma in piattaforma",
      "Confermato in piattaforma",
      "Confermato in InBuoneMani",
      "InBuoneMani",
    ].filter(Boolean),
    tableName,
  );

  const FIELD_QUICK_NOTE = await resolveFieldName(
    tableEnc,
    `appts:field:quick:${tableName}`,
    [process.env.AGENDA_QUICK_NOTE_FIELD, "Nota rapida", "Nota rapida (interna)", "Note interne", "Nota interna"].filter(Boolean),
    tableName,
  );
  const FIELD_NOTES = await resolveFieldName(
    tableEnc,
    `appts:field:notes:${tableName}`,
    [process.env.AGENDA_NOTES_FIELD, "Note", "Note paziente"].filter(Boolean),
    tableName,
  );

  const FIELD_TIPI_EROGATI = await resolveFieldName(
    tableEnc,
    `appts:field:tipiErogati:${tableName}`,
    [process.env.AGENDA_TIPI_EROGATI_FIELD, "Tipi Erogati", "Tipi erogati"].filter(Boolean),
    tableName,
  );
  const FIELD_VALUTAZIONI = await resolveFieldName(
    tableEnc,
    `appts:field:valutazioni:${tableName}`,
    [process.env.AGENDA_VALUTAZIONI_FIELD, "VALUTAZIONI", "Valutazioni"].filter(Boolean),
    tableName,
  );
  const FIELD_TRATTAMENTI = await resolveFieldName(
    tableEnc,
    `appts:field:trattamenti:${tableName}`,
    [process.env.AGENDA_TRATTAMENTI_FIELD, "TRATTAMENTI", "Trattamenti"].filter(Boolean),
    tableName,
  );
  const FIELD_EROGATO_COLLEGATO = await resolveFieldName(
    tableEnc,
    `appts:field:erogato:${tableName}`,
    [process.env.AGENDA_EROGATO_FIELD, "Erogato collegato", "Erogato", "Appuntamento collegato"].filter(Boolean),
    tableName,
  );
  const FIELD_CASO_CLINICO = await resolveFieldName(
    tableEnc,
    `appts:field:case:${tableName}`,
    [process.env.AGENDA_CASE_FIELD, "Caso clinico", "Caso", "Caso Clinico"].filter(Boolean),
    tableName,
  );
  const FIELD_VENDITA_COLLEGATA = await resolveFieldName(
    tableEnc,
    `appts:field:sale:${tableName}`,
    [process.env.AGENDA_SALE_FIELD, "Vendita collegata", "Vendita", "Sale"].filter(Boolean),
    tableName,
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
    FIELD_CONFIRMED_BY_PATIENT,
    FIELD_CONFIRMED_IN_PLATFORM,
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

  const patientField = schema.FIELD_PATIENT ? f[schema.FIELD_PATIENT] : undefined;
  const patient_id =
    Array.isArray(patientField) &&
    patientField.length &&
    typeof patientField[0] === "string" &&
    patientField[0].startsWith("rec")
      ? String(patientField[0] || "")
      : "";
  const patient_name =
    String(patientNamesById[patient_id] || "").trim() ||
    (Array.isArray(patientField) && patientField.length && !String(patientField[0] || "").startsWith("rec")
      ? String(patientField[0] || "")
      : "") ||
    (typeof patientField === "string" ? String(patientField).trim() : "") ||
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
    created_at: String(r.createdTime || ""),
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

    confirmed_by_patient: schema.FIELD_CONFIRMED_BY_PATIENT ? toBool(f[schema.FIELD_CONFIRMED_BY_PATIENT]) : false,
    confirmed_in_platform: schema.FIELD_CONFIRMED_IN_PLATFORM ? toBool(f[schema.FIELD_CONFIRMED_IN_PLATFORM]) : false,

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

function parseDateRangeDays(startISO, endISO) {
  try {
    const a = new Date(String(startISO || ""));
    const b = new Date(String(endISO || ""));
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    const ms = b.getTime() - a.getTime();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return ms / 86_400_000;
  } catch {
    return null;
  }
}

function normalizeApptType(v) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseDateSafe(v) {
  const d = new Date(String(v || ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

function overlapMinutesInRange(appt, rangeStart, rangeEnd) {
  const s = parseDateSafe(appt?.start_at);
  if (!s) return 0;

  let e = parseDateSafe(appt?.end_at);
  if (!e) {
    const raw = appt?.duration;
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (Number.isFinite(n) && n > 0) e = new Date(s.getTime() + n * 60_000);
  }
  if (!e) return 0;

  const start = s < rangeStart ? rangeStart : s;
  const end = e > rangeEnd ? rangeEnd : e;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0, Math.round(ms / 60_000));
}

function makeSyntheticId(prefix = "sb") {
  try {
    // Node 18+ supports crypto.randomUUID()
    return `${String(prefix || "sb")}_${crypto.randomUUID()}`;
  } catch {
    return `${String(prefix || "sb")}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function mergeAirtableFields(base, patch) {
  const a = base && typeof base === "object" ? { ...base } : {};
  const b = patch && typeof patch === "object" ? patch : {};
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    a[k] = v;
  }
  return a;
}

function boolish(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  if (["1", "true", "yes", "si", "sì", "ok"].includes(s)) return true;
  return false;
}

async function sbGetOne(sb, table, matchCol, matchVal, cols = "id,airtable_id,name,label") {
  const { data, error } = await sb.from(table).select(cols).eq(matchCol, matchVal).maybeSingle();
  if (error) {
    const err = new Error(`supabase_${table}_lookup_failed: ${error.message}`);
    err.status = 500;
    throw err;
  }
  return data || null;
}

async function ensureErogatoForAppointment({
  sb,
  apptRow, // full row including uuid id
  patient,
  collaborator,
}) {
  // 1 Erogato per 1 Appuntamento (A)
  if (!apptRow?.id) return { erogato: null, erogatoAirtableId: "" };
  const apptUuid = apptRow.id;

  const startAt = apptRow.start_at ? new Date(apptRow.start_at).toISOString() : "";
  const endAt = apptRow.end_at ? new Date(apptRow.end_at).toISOString() : "";
  const minutes =
    typeof apptRow.duration_minutes === "number" && isFinite(apptRow.duration_minutes)
      ? Math.max(0, Math.trunc(apptRow.duration_minutes))
      : (startAt && endAt)
        ? Math.max(0, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000))
        : null;

  // Find existing erogato by appointment_id
  const { data: existing, error: exErr } = await sb
    .from("erogato")
    .select("id,airtable_id,airtable_fields")
    .eq("appointment_id", apptUuid)
    .limit(1)
    .maybeSingle();
  if (exErr) {
    const err = new Error(`supabase_erogato_lookup_failed: ${exErr.message}`);
    err.status = 500;
    throw err;
  }

  const erogatoAirtableId = existing?.airtable_id || makeSyntheticId("erogato");
  const baseFields = existing?.airtable_fields && typeof existing.airtable_fields === "object" ? existing.airtable_fields : {};

  // Build minimal Airtable-like fields for the UI pages (erogato list).
  const erogatoFields = mergeAirtableFields(baseFields, {
    "Data e ora INIZIO": startAt || baseFields["Data e ora INIZIO"] || "",
    "Data e ora FINE": endAt || baseFields["Data e ora FINE"] || "",
    "Minuti lavoro": minutes ?? baseFields["Minuti lavoro"] ?? "",
    Paziente: patient?.airtable_id ? [patient.airtable_id] : (baseFields.Paziente ?? []),
    Collaboratore: collaborator?.airtable_id ? [collaborator.airtable_id] : (baseFields.Collaboratore ?? []),
    "Stato appuntamento": apptRow.status || baseFields["Stato appuntamento"] || "",
    "Tipo lavoro ": apptRow.work_type || baseFields["Tipo lavoro "] || "",
  });

  const payload = {
    airtable_id: erogatoAirtableId,
    patient_id: apptRow.patient_id || null,
    collaborator_id: apptRow.collaborator_id || null,
    appointment_id: apptUuid,
    case_id: apptRow.case_id || null,
    start_at: apptRow.start_at || null,
    end_at: apptRow.end_at || null,
    minutes: minutes ?? null,
    status: apptRow.status || null,
    work_type: apptRow.work_type || null,
    is_home: apptRow.is_home ?? null,
    airtable_fields: erogatoFields,
  };

  if (existing?.id) {
    const { data: upd, error } = await sb.from("erogato").update(payload).eq("id", existing.id).select("id,airtable_id").maybeSingle();
    if (error) {
      const err = new Error(`supabase_erogato_update_failed: ${error.message}`);
      err.status = 500;
      throw err;
    }
    return { erogato: upd || null, erogatoAirtableId };
  }

  const { data: ins, error } = await sb.from("erogato").insert(payload).select("id,airtable_id").maybeSingle();
  if (error) {
    const err = new Error(`supabase_erogato_insert_failed: ${error.message}`);
    err.status = 500;
    throw err;
  }
  return { erogato: ins || null, erogatoAirtableId };
}

async function appointmentsSummary({ tableEnc, tableName, schema, startISO, endISO, session }) {
  if (!schema.FIELD_START) {
    const err = new Error("agenda_schema_mismatch: missing start field");
    err.status = 500;
    throw err;
  }

  // Use DATETIME_PARSE for robust comparisons (Airtable can be picky with raw ISO strings).
  const rangeFilter = `AND(
    {${schema.FIELD_START}} >= DATETIME_PARSE("${escAirtableStringLib(startISO)}"),
    {${schema.FIELD_START}} < DATETIME_PARSE("${escAirtableStringLib(endISO)}")
  )`;

  const role = normalizeRole(session.role || "");
  const email = String(session.email || "").toLowerCase();

  let roleFilter = "TRUE()";
  if (role === "physio") {
    const collabRecId = schema.FIELD_OPERATOR ? await resolveCollaboratorRecordIdForSession(session, schema) : "";
    if (collabRecId && schema.FIELD_OPERATOR) {
      roleFilter = `FIND("${escAirtableString(collabRecId)}", ARRAYJOIN({${schema.FIELD_OPERATOR}}))`;
    } else if (schema.FIELD_EMAIL) {
      roleFilter = `LOWER({${schema.FIELD_EMAIL}}) = LOWER("${escAirtableString(email)}")`;
    } else {
      roleFilter = "FALSE()";
    }
  }
  if (role === "physio") {
    if (schema.FIELD_EMAIL) roleFilter = `LOWER({${schema.FIELD_EMAIL}}) = LOWER("${escAirtableString(email)}")`;
    else roleFilter = "FALSE()";
  }

  const qs = new URLSearchParams({
    filterByFormula: `AND(${rangeFilter}, ${roleFilter})`,
    pageSize: "100",
  });
  qs.append("sort[0][field]", schema.FIELD_START);
  qs.append("sort[0][direction]", "asc");

  // Only fetch what we need for counts.
  const wanted = [
    schema.FIELD_START,
    schema.FIELD_PATIENT,
    schema.FIELD_CONFIRMED_BY_PATIENT,
    schema.FIELD_CONFIRMED_IN_PLATFORM,
    schema.FIELD_EMAIL,
  ].filter(Boolean);
  for (const f of wanted) qs.append("fields[]", f);

  const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
  const records = data.records || [];

  let total = 0;
  let missingPatient = 0;
  let needConfirmPatient = 0;
  let needConfirmPlatform = 0;

  for (const r of records) {
    total += 1;
    const f = r?.fields || {};
    const patientField = schema.FIELD_PATIENT ? f[schema.FIELD_PATIENT] : undefined;
    const patient_id =
      Array.isArray(patientField) &&
      patientField.length &&
      typeof patientField[0] === "string" &&
      patientField[0].startsWith("rec")
        ? String(patientField[0] || "")
        : "";
    if (!patient_id) missingPatient += 1;

    if (schema.FIELD_CONFIRMED_BY_PATIENT && !toBool(f[schema.FIELD_CONFIRMED_BY_PATIENT])) needConfirmPatient += 1;
    if (schema.FIELD_CONFIRMED_IN_PLATFORM && !toBool(f[schema.FIELD_CONFIRMED_IN_PLATFORM])) needConfirmPlatform += 1;
  }

  return { total, missingPatient, needConfirmPatient, needConfirmPlatform };
}

async function appointmentsKpi({ tableEnc, tableName, schema, startISO, endISO, session, wantedTypeNorm = "" }) {
  if (!schema.FIELD_START) {
    const err = new Error("agenda_schema_mismatch: missing start field");
    err.status = 500;
    throw err;
  }

  // Use DATETIME_PARSE for robust comparisons (Airtable can be picky with raw ISO strings).
  const rangeFilter = `AND(
    {${schema.FIELD_START}} >= DATETIME_PARSE("${escAirtableStringLib(startISO)}"),
    {${schema.FIELD_START}} < DATETIME_PARSE("${escAirtableStringLib(endISO)}")
  )`;

  const role = normalizeRole(session.role || "");
  const email = String(session.email || "").toLowerCase();
  let roleFilter = "TRUE()";
  if (role === "physio") {
    const collabRecId = schema.FIELD_OPERATOR ? await resolveCollaboratorRecordIdForSession(session, schema) : "";
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

  // Only what we need for KPI (no linked resolution).
  const wanted = [
    schema.FIELD_START,
    schema.FIELD_END,
    schema.FIELD_DURATION,
    schema.FIELD_TYPE,
    schema.FIELD_EMAIL,
  ].filter(Boolean);
  for (const f of wanted) qs.append("fields[]", f);

  const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
  const records = data.records || [];

  const appts = records.map((r) =>
    mapAppointmentFromRecord({
      record: r,
      schema,
      patientNamesById: {},
      collaboratorNamesById: {},
      serviceNamesById: {},
      locationNamesById: {},
    }),
  );

  const rangeStart = new Date(startISO);
  const rangeEnd = new Date(endISO);
  const want = normalizeApptType(wantedTypeNorm);

  const filtered = want
    ? appts.filter((a) => normalizeApptType(a?.appointment_type) === want)
    : appts;

  let minutes = 0;
  for (const a of filtered) minutes += overlapMinutesInRange(a, rangeStart, rangeEnd);

  const slots = minutes <= 0 ? 0 : Math.ceil(minutes / 60);
  return {
    totalAppointments: appts.length,
    filteredAppointments: filtered.length,
    minutes,
    slots,
    type: want || "",
  };
}

async function listAppointments({ tableEnc, tableName, schema, startISO, endISO, session, lite = false, allowUnmapped = false }) {
  if (!schema.FIELD_START) {
    const err = new Error("agenda_schema_mismatch: missing start field");
    err.status = 500;
    throw err;
  }

  // Use DATETIME_PARSE for robust comparisons (Airtable can be picky with raw ISO strings).
  const rangeFilter = `AND(
    {${schema.FIELD_START}} >= DATETIME_PARSE("${escAirtableStringLib(startISO)}"),
    {${schema.FIELD_START}} < DATETIME_PARSE("${escAirtableStringLib(endISO)}")
  )`;

  const role = normalizeRole(session.role || "");
  const email = String(session.email || "").toLowerCase();

  let roleFilter = "TRUE()";
  if (role === "physio") {
    // Prefer linked Collaboratore filter (most reliable); fallback to Email field if present.
    const collabRecId = schema.FIELD_OPERATOR ? await resolveCollaboratorRecordIdForSession(session, schema) : "";
    if (collabRecId && schema.FIELD_OPERATOR) {
      roleFilter = `FIND("${escAirtableString(collabRecId)}", ARRAYJOIN({${schema.FIELD_OPERATOR}}))`;
    } else if (schema.FIELD_EMAIL) {
      roleFilter = `LOWER({${schema.FIELD_EMAIL}}) = LOWER("${escAirtableString(email)}")`;
    } else {
      // Don't return "empty" silently; surface a clear mapping error.
      const err = new Error("operator_mapping_missing");
      err.status = 409;
      err.details = { email, nome: String(session?.nome || ""), cognome: String(session?.cognome || "") };
      throw err;
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
    schema.FIELD_CONFIRMED_BY_PATIENT,
    schema.FIELD_CONFIRMED_IN_PLATFORM,
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

  // LITE mode: avoid extra Airtable calls to resolve linked record names.
  // This makes the first agenda load much faster and avoids client timeouts.
  if (lite) {
    const appointments = (data.records || []).map((r) =>
      mapAppointmentFromRecord({
        record: r,
        schema,
        patientNamesById: {},
        collaboratorNamesById: {},
        serviceNamesById: {},
        locationNamesById: {},
      }),
    );
    return { appointments, meta: {} };
  }

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

  return { appointments, meta: {} };
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

    const tableName = process.env.AGENDA_TABLE || "APPUNTAMENTI";
    const tableEnc = enc(tableName);

    if (req.method === "GET") {
      setPrivateCache(res, 30);

      // -----------------------------------------
      // Supabase fast-path (read-only GET)
      // - Keeps the SAME response shape as current UI expects
      // - Uses Airtable only to map physio email -> collaborator Airtable recordId
      // -----------------------------------------
      if (isSupabaseEnabled()) {
        const sb = getSupabaseAdmin();

        const date = norm(req.query?.date);
        const startRaw = norm(req.query?.start);
        const endRaw = norm(req.query?.end);
        const summary = String(req.query?.summary || "") === "1";
        const kpi = String(req.query?.kpi || "") === "1";
        const kpiType = norm(req.query?.type);

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
        if (!startISO || !endISO) return res.status(400).json({ ok: false, error: "missing_start_end" });

        const role = normalizeRole(session.role || "");
        const email = String(session.email || "").toLowerCase();

        // Map physio to a collaborator UUID in Supabase, based on Airtable collaborator record (by Email).
        let collabUuid = "";
        if (role === "physio") {
          const collabTable = encodeURIComponent(process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI");
          const fEmail = `LOWER({Email}) = LOWER("${String(email).replace(/"/g, '\\"')}")`;
          const emailKey = `collabIdByEmail:${String(email)}`;
          let userRecId = memGet(emailKey) || "";
          if (!userRecId) {
            const qsUser = new URLSearchParams({ filterByFormula: fEmail, maxRecords: "1", pageSize: "1" });
            const userData = await airtableFetch(`${collabTable}?${qsUser.toString()}`);
            const rec = userData.records?.[0] || null;
            userRecId = rec?.id || "";
            if (userRecId) memSet(emailKey, userRecId, 10 * 60_000);
          }
          if (!userRecId) {
            // No mapping => safest: empty list
            if (summary) return res.status(200).json({ ok: true, counts: { total: 0, missingPatient: 0, needConfirmPatient: 0, needConfirmPlatform: 0 } });
            if (kpi) return res.status(200).json({ ok: true, kpi: { totalAppointments: 0, filteredAppointments: 0, minutes: 0, slots: 0, type: String(kpiType || "") } });
            return res.status(200).json({ ok: true, appointments: [], meta: {} });
          }

          const { data: collabRow, error: collabErr } = await sb
            .from("collaborators")
            .select("id")
            .eq("airtable_id", userRecId)
            .maybeSingle();
          if (collabErr) throw new Error(`supabase_collaborator_lookup_failed: ${collabErr.message}`);
          collabUuid = collabRow?.id || "";
          if (!collabUuid) {
            if (summary) return res.status(200).json({ ok: true, counts: { total: 0, missingPatient: 0, needConfirmPatient: 0, needConfirmPlatform: 0 } });
            if (kpi) return res.status(200).json({ ok: true, kpi: { totalAppointments: 0, filteredAppointments: 0, minutes: 0, slots: 0, type: String(kpiType || "") } });
            return res.status(200).json({ ok: true, appointments: [], meta: {} });
          }
        }

        const wantTypeNorm = String(kpiType || "").trim().toLowerCase();

        // Load appointments (include linked names/airtable_ids needed by UI).
        let q = sb
          .from("appointments")
          .select(
            "airtable_id,start_at,end_at,duration_minutes,status,agenda_label,location,is_home,work_type,note,airtable_fields,collaborator_id,service_id,patients:patients(airtable_id,label,cognome,nome),collaborators:collaborators(airtable_id,name),services:services(airtable_id,name)"
          )
          .gte("start_at", startISO)
          .lt("start_at", endISO)
          .order("start_at", { ascending: true });
        if (role === "physio" && collabUuid) q = q.eq("collaborator_id", collabUuid);

        const { data: rows, error } = await q;
        if (error) throw new Error(`supabase_appointments_failed: ${error.message}`);

        const appts = (rows || []).map((r) => {
          const f = (r.airtable_fields && typeof r.airtable_fields === "object") ? r.airtable_fields : {};
          const patientName = String(f["Paziente"] || r.patients?.label || "").trim();
          const patientAirtableId = String(r.patients?.airtable_id || "").trim();
          const therapistAirtableId = String(r.collaborators?.airtable_id || "").trim();
          const therapistName = String(r.collaborators?.name || "").trim();
          const serviceAirtableId = String(r.services?.airtable_id || "").trim();
          const serviceName = String(r.services?.name || "").trim();
          const startAt = r.start_at ? new Date(r.start_at).toISOString() : "";
          const endAt = r.end_at ? new Date(r.end_at).toISOString() : "";
          const appointmentType = String(f["Voce agenda"] || r.agenda_label || r.work_type || "").trim();

          return {
            id: String(r.airtable_id || ""),
            created_at: "",
            patient_id: patientAirtableId,
            patient_name: patientName,
            start_at: startAt,
            end_at: endAt,
            status: String(r.status || f["Stato appuntamento"] || "").trim(),
            appointment_type: appointmentType,
            service_id: serviceAirtableId,
            service_name: serviceName,
            location_id: "",
            location_name: String(r.location || f.Sede || "").trim(),
            therapist_id: therapistAirtableId,
            therapist_name: therapistName,
            duration: r.duration_minutes ?? f["Durata (minuti)"] ?? "",
            duration_label: r.duration_minutes ? `${r.duration_minutes} min` : "",
            confirmed_by_patient: Boolean(f["Confermato dal paziente"] ?? f["Conferma del paziente"] ?? false),
            confirmed_in_platform: Boolean(f["Conferma in InBuoneMani"] ?? f["Conferma in piattaforma"] ?? false),
            quick_note: String(f["Nota rapida"] ?? f["Note interne"] ?? "").trim(),
            notes: String(f["Note"] ?? "").trim(),
            internal_note: String(f["Nota rapida"] ?? f["Note interne"] ?? "").trim(),
            patient_note: String(f["Note"] ?? "").trim(),
            tipi_erogati: Array.isArray(f["Tipi Erogati"]) ? f["Tipi Erogati"] : [],
            valutazioni_ids: Array.isArray(f["VALUTAZIONI"]) ? f["VALUTAZIONI"] : [],
            trattamenti_ids: Array.isArray(f["TRATTAMENTI"]) ? f["TRATTAMENTI"] : [],
            erogato_id: (Array.isArray(f["Erogato collegato"]) && f["Erogato collegato"][0]) ? String(f["Erogato collegato"][0]) : "",
            caso_clinico_id: (Array.isArray(f["Caso clinico"]) && f["Caso clinico"][0]) ? String(f["Caso clinico"][0]) : "",
            vendita_id: (Array.isArray(f["Vendita collegata"]) && f["Vendita collegata"][0]) ? String(f["Vendita collegata"][0]) : "",
          };
        });

        if (summary) {
          const total = appts.length;
          const missingPatient = appts.filter((a) => !String(a.patient_id || "")).length;
          const needConfirmPatient = appts.filter((a) => !a.confirmed_by_patient).length;
          const needConfirmPlatform = appts.filter((a) => !a.confirmed_in_platform).length;
          return res.status(200).json({ ok: true, counts: { total, missingPatient, needConfirmPatient, needConfirmPlatform } });
        }

        if (kpi) {
          const rangeStart = new Date(startISO);
          const rangeEnd = new Date(endISO);
          const want = String(wantTypeNorm || "").trim();
          const filtered = want ? appts.filter((a) => String(a.appointment_type || "").trim().toLowerCase() === want) : appts;
          let minutes = 0;
          for (const a of filtered) minutes += overlapMinutesInRange(a, rangeStart, rangeEnd);
          const slots = minutes <= 0 ? 0 : Math.ceil(minutes / 60);
          return res.status(200).json({
            ok: true,
            kpi: { totalAppointments: appts.length, filteredAppointments: filtered.length, minutes, slots, type: want || "" },
          });
        }

        return res.status(200).json({ ok: true, appointments: appts, meta: {} });
      }

      // -----------------------------
      // NEW CONTRACT (requested):
      // GET /api/appointments?from=ISO&to=ISO&collaboratore=...
      // - Uses fixed schema field names from Airtable CSV export (no heuristics)
      // - Returns raw Airtable records (id + fields) for robust UI mapping
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
        const { records } = await airtableList("APPUNTAMENTI", {
          filterByFormula: formula,
          sort: [{ field: "Data e ora INIZIO", direction: "asc" }],
          maxRecords: 1500,
          fields: [
            "Data e ora INIZIO",
            "Data e ora fine",
            "Durata (minuti)",
            "Paziente",
            "Collaboratore",
            "Caso clinico",
            "Tipo lavoro",
            "DOMICILIO",
            "Note",
            "Stato appuntamento",
            "Erogato collegato",
          ],
        });

        return res.status(200).json({
          ok: true,
          records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
        });
      }

      // Back-compat: allow ?date=YYYY-MM-DD
      const date = norm(req.query?.date);
      const startRaw = norm(req.query?.start);
      const endRaw = norm(req.query?.end);
      const noCache = String(req.query?.nocache || "") === "1";
      const lite = String(req.query?.lite || "") === "1";
      const summary = String(req.query?.summary || "") === "1";
      const kpi = String(req.query?.kpi || "") === "1";
      const kpiType = norm(req.query?.type);
      const allowUnmapped = String(req.query?.allowUnmapped || "") === "1";
      const schema = lite ? await resolveSchemaLite(tableEnc, tableName) : await resolveSchema(tableEnc, tableName);

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

      // Guardrail: prevent accidental huge ranges that would be slow (Airtable + JSON + linked resolution).
      const days = parseDateRangeDays(startISO, endISO);
      if (days && days > 45) {
        return res.status(400).json({ ok: false, error: "range_too_large", maxDays: 45 });
      }

      // Summary mode: used for badges/KPI; avoids linked name resolution and heavy payloads.
      if (summary) {
        const schemaLite = await resolveSchemaLite(tableEnc, tableName);
        const role = normalizeRole(session.role || "");
        const email = String(session.email || "").toLowerCase();
        const cacheKey = `appts:summary:${tableName}:${startISO}:${endISO}:${role}:${email}`;
        const run = () => appointmentsSummary({ tableEnc, tableName, schema: schemaLite, startISO, endISO, session });
        const counts = noCache ? await run() : await memGetOrSet(cacheKey, 15_000, run);
        return res.status(200).json({ ok: true, counts });
      }

      // KPI mode: compute lightweight metrics (e.g. Dashboard "Oggi") without returning full appointments list.
      if (kpi) {
        const schemaLite = await resolveSchemaLite(tableEnc, tableName);
        const role = normalizeRole(session.role || "");
        const email = String(session.email || "").toLowerCase();
        const cacheKey = `appts:kpi:${tableName}:${startISO}:${endISO}:${role}:${email}:${kpiType}`;
        const run = () => appointmentsKpi({ tableEnc, tableName, schema: schemaLite, startISO, endISO, session, wantedTypeNorm: kpiType });
        const out = noCache ? await run() : await memGetOrSet(cacheKey, 15_000, run);
        return res.status(200).json({ ok: true, kpi: out });
      }

      // Short warm-instance cache: speeds up repeated view switches/navigation.
      // Cache is session-aware (role+email) and range-aware.
      const role = normalizeRole(session.role || "");
      const email = String(session.email || "").toLowerCase();
      const cacheKey = `appts:list:${tableName}:${startISO}:${endISO}:${role}:${email}`;
      const run = () => listAppointments({ tableEnc, tableName, schema, startISO, endISO, session, lite, allowUnmapped });
      const { appointments, meta } = noCache ? await run() : await memGetOrSet(cacheKey, 15_000, run);
      return res.status(200).json({ ok: true, appointments, meta });
    }

    // -----------------------------------------
    // Supabase write paths (POST/PATCH/DELETE)
    // - Keeps existing UI contracts
    // - Also enforces automation: 1 erogato per 1 appointment (A)
    // -----------------------------------------
    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();
      const role = normalizeRole(session.role || "");

      // Helper: load appointment row by Airtable-like id (appointments.airtable_id)
      const loadApptByAirtableId = async (airtableId) => {
        const { data, error } = await sb
          .from("appointments")
          .select("id,airtable_id,patient_id,collaborator_id,service_id,case_id,start_at,end_at,duration_minutes,status,agenda_label,location,is_home,economic_outcome,work_type,note,airtable_fields")
          .eq("airtable_id", String(airtableId || ""))
          .maybeSingle();
        if (error) {
          const err = new Error(`supabase_appointment_lookup_failed: ${error.message}`);
          err.status = 500;
          throw err;
        }
        return data || null;
      };

      const resolveUuidByAirtable = async (table, airtableId) => {
        const s = norm(airtableId);
        if (!s) return "";
        const row = await sbGetOne(sb, table, "airtable_id", s, "id,airtable_id,name,label");
        return row?.id || "";
      };

      if (req.method === "DELETE") {
        if (role === "physio") return res.status(403).json({ ok: false, error: "forbidden" });
        const id = norm(req.query?.id);
        if (!id) return res.status(400).json({ ok: false, error: "missing_id" });

        const appt = await loadApptByAirtableId(id);
        if (!appt?.id) return res.status(200).json({ ok: true });

        // Best-effort: delete linked erogato first
        await sb.from("erogato").delete().eq("appointment_id", appt.id);
        await sb.from("appointments").delete().eq("id", appt.id);
        return res.status(200).json({ ok: true });
      }

      if (req.method === "PATCH") {
        const id = norm(req.query?.id);
        if (!id) return res.status(400).json({ ok: false, error: "missing_id" });

        const body = await readJsonBody(req);
        if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

        const appt = await loadApptByAirtableId(id);
        if (!appt?.id) return res.status(404).json({ ok: false, error: "not_found" });

        // Map UI payload -> DB columns
        const updates = {};
        const f0 = (appt.airtable_fields && typeof appt.airtable_fields === "object") ? appt.airtable_fields : {};
        let f = { ...f0 };

        if ("status" in body || "stato" in body || "statoAppuntamento" in body) {
          const s = norm(body.status ?? body.stato ?? body.statoAppuntamento);
          updates.status = s || null;
          f = mergeAirtableFields(f, { "Stato appuntamento": s });
        }
        if ("appointment_type" in body || "tipoAppuntamento" in body || "type" in body) {
          const t = norm(body.appointment_type ?? body.tipoAppuntamento ?? body.type);
          updates.agenda_label = t || null;
          f = mergeAirtableFields(f, { "Voce agenda": t });
        }
        if ("quick_note" in body || "notaRapida" in body || "internal_note" in body) {
          const txt = norm(body.quick_note ?? body.notaRapida ?? body.internal_note);
          // store in JSON fields for UI compatibility
          f = mergeAirtableFields(f, { "Nota rapida": txt, "Note interne": txt });
        }
        if ("notes" in body || "note" in body || "patient_note" in body) {
          const txt = norm(body.notes ?? body.note ?? body.patient_note);
          updates.note = txt || null;
          f = mergeAirtableFields(f, { Note: txt });
        }

        if ("confirmed_by_patient" in body || "confirmedByPatient" in body || "confermatoDalPaziente" in body) {
          const v = body.confirmed_by_patient ?? body.confirmedByPatient ?? body.confermatoDalPaziente;
          f = mergeAirtableFields(f, { "Confermato dal paziente": Boolean(v), "Conferma del paziente": Boolean(v) });
        }
        if ("confirmed_in_platform" in body || "confirmedInPlatform" in body || "confermaInPiattaforma" in body) {
          const v = body.confirmed_in_platform ?? body.confirmedInPlatform ?? body.confermaInPiattaforma;
          f = mergeAirtableFields(f, { "Conferma in InBuoneMani": Boolean(v), "Conferma in piattaforma": Boolean(v) });
        }

        // Datetime changes (drag/drop)
        const startRaw = body.start_at ?? body.startAt ?? body.startISO ?? body.start;
        if (startRaw !== undefined) {
          const iso = startRaw === null || String(startRaw).trim() === "" ? "" : parseIsoOrThrow(startRaw, "start_at");
          updates.start_at = iso ? iso : null;
          f = mergeAirtableFields(f, { "Data e ora INIZIO": iso || "" });
        }
        const endRaw = body.end_at ?? body.endAt ?? body.endISO ?? body.end;
        if (endRaw !== undefined) {
          const iso = endRaw === null || String(endRaw).trim() === "" ? "" : parseIsoOrThrow(endRaw, "end_at");
          updates.end_at = iso ? iso : null;
          f = mergeAirtableFields(f, { "Data e ora fine": iso || "", "Data e ora FINE": iso || "" });
        }

        // Linked fields (ids are Airtable record ids from UI)
        const serviceRaw = body.service_id ?? body.serviceId ?? body.prestazioneId;
        if (serviceRaw !== undefined) {
          const sid = norm(serviceRaw);
          const svcUuid = sid ? await resolveUuidByAirtable("services", sid) : "";
          updates.service_id = svcUuid || null;
          if (sid) f = mergeAirtableFields(f, { "Prestazione prevista": [sid] });
        }

        const operatorRaw = body.therapist_id ?? body.operatorId ?? body.collaboratoreId;
        if (operatorRaw !== undefined) {
          const oid = norm(operatorRaw);
          const opUuid = oid ? await resolveUuidByAirtable("collaborators", oid) : "";
          updates.collaborator_id = opUuid || null;
          // also keep a human label if present
          if (oid) f = mergeAirtableFields(f, { Collaboratore: [oid] });
        }

        const locationRaw = body.location_id ?? body.locationId ?? body.sedeId;
        if (locationRaw !== undefined) {
          const loc = norm(locationRaw);
          updates.location = loc || null;
          if (loc || loc === "") f = mergeAirtableFields(f, { Sede: loc });
        }

        const durata = body.duration ?? body.durata ?? body.durationMin;
        if (durata !== undefined) {
          if (durata === null || String(durata).trim() === "") {
            updates.duration_minutes = null;
            f = mergeAirtableFields(f, { "Durata (minuti)": "" });
          } else {
            const n = Number(durata);
            if (Number.isFinite(n)) {
              updates.duration_minutes = Math.max(0, Math.trunc(n));
              f = mergeAirtableFields(f, { "Durata (minuti)": Math.max(0, Math.trunc(n)) });
            }
          }
        }

        // persist updated airtable_fields
        updates.airtable_fields = f;

        // If end_at and start_at are set but duration is missing, compute it.
        const startFinal = updates.start_at ?? appt.start_at;
        const endFinal = updates.end_at ?? appt.end_at;
        const durFinal = updates.duration_minutes ?? appt.duration_minutes;
        if ((durFinal === null || durFinal === undefined) && startFinal && endFinal) {
          const ms = new Date(endFinal).getTime() - new Date(startFinal).getTime();
          if (Number.isFinite(ms)) {
            const minutes = Math.max(0, Math.round(ms / 60_000));
            updates.duration_minutes = minutes;
            updates.airtable_fields = mergeAirtableFields(updates.airtable_fields, { "Durata (minuti)": minutes });
          }
        }

        // Apply update
        const { data: updated, error } = await sb.from("appointments").update(updates).eq("id", appt.id).select("*").maybeSingle();
        if (error) return res.status(500).json({ ok: false, error: `supabase_appointment_update_failed: ${error.message}` });

        // Automation: ensure Erogato exists/updated and link it back to appointment fields.
        const patient = updated.patient_id ? await sbGetOne(sb, "patients", "id", updated.patient_id, "id,airtable_id,label,cognome,nome") : null;
        const collaborator = updated.collaborator_id ? await sbGetOne(sb, "collaborators", "id", updated.collaborator_id, "id,airtable_id,name") : null;
        const { erogatoAirtableId } = await ensureErogatoForAppointment({ sb, apptRow: updated, patient, collaborator });

        // Update appointment airtable_fields with the linked erogato id (so UI "billing" sees it).
        if (erogatoAirtableId) {
          const f2 = mergeAirtableFields(updated.airtable_fields, { "Erogato collegato": [erogatoAirtableId], EROGATO: [erogatoAirtableId] });
          await sb.from("appointments").update({ airtable_fields: f2 }).eq("id", updated.id);
        }

        return res.status(200).json({ ok: true, appointment: { id: updated.airtable_id } });
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

        const ap = body.appointment || body;
        const recordId = norm(body.recordId || body.id || ap.recordId || ap.id) || makeSyntheticId("appt");

        const startISO = parseIsoOrThrow(ap["Data e ora INIZIO"] ?? ap.start ?? ap.startISO ?? ap.start_at ?? ap.startAt, "start_at");
        const endISO = parseIsoOrThrow(ap["Data e ora fine"] ?? ap["Data e ora FINE"] ?? ap.end ?? ap.endISO ?? ap.end_at ?? ap.endAt, "end_at");

        let durata = ap["Durata (minuti)"] ?? ap.durataMinuti ?? ap.durationMinutes ?? ap.duration;
        if (durata === undefined || durata === null || String(durata).trim() === "") {
          const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
          durata = Math.max(0, Math.round(ms / 60000));
        }

        const pazienteVal = ap.pazienteRecordId ?? ap.patientRecordId ?? ap.PazienteRecordId ?? ap.Paziente ?? ap.paziente ?? ap.patient;
        const collaboratoreVal = ap.collaboratoreRecordId ?? ap.therapistRecordId ?? ap.operatorRecordId ?? ap.CollaboratoreRecordId ?? ap.Collaboratore ?? ap.collaboratore ?? ap.therapist ?? ap.operator;
        if (!pazienteVal) return res.status(400).json({ ok: false, error: "missing_paziente" });
        if (!collaboratoreVal) return res.status(400).json({ ok: false, error: "missing_collaboratore" });

        const patientUuid = await resolveUuidByAirtable("patients", String(pazienteVal));
        const collabUuid = await resolveUuidByAirtable("collaborators", String(collaboratoreVal));
        if (!patientUuid) return res.status(400).json({ ok: false, error: "unknown_paziente" });
        if (!collabUuid) return res.status(400).json({ ok: false, error: "unknown_collaboratore" });

        const airtable_fields = {
          "Data e ora INIZIO": startISO,
          "Data e ora fine": endISO,
          "Durata (minuti)": Number(durata),
          Paziente: [String(pazienteVal)],
          Collaboratore: [String(collaboratoreVal)],
          "Stato appuntamento": norm(ap["Stato appuntamento"] ?? ap.status ?? ""),
          "Voce agenda": norm(ap["Voce agenda"] ?? ap.appointment_type ?? ""),
          Note: norm(ap.Note ?? ap.note ?? ""),
          DOMICILIO: Boolean(ap.DOMICILIO ?? ap.domicilio ?? false),
        };

        const insertPayload = {
          airtable_id: recordId,
          patient_id: patientUuid,
          collaborator_id: collabUuid,
          start_at: startISO,
          end_at: endISO,
          duration_minutes: Number(durata),
          status: norm(ap["Stato appuntamento"] ?? ap.status ?? "") || null,
          agenda_label: norm(ap["Voce agenda"] ?? ap.appointment_type ?? "") || null,
          is_home: Boolean(ap.DOMICILIO ?? ap.domicilio ?? false),
          note: norm(ap.Note ?? ap.note ?? "") || null,
          airtable_fields,
        };

        const { data: created, error } = await sb.from("appointments").insert(insertPayload).select("*").maybeSingle();
        if (error) return res.status(500).json({ ok: false, error: `supabase_appointment_insert_failed: ${error.message}` });

        const patient = await sbGetOne(sb, "patients", "id", created.patient_id, "id,airtable_id,label,cognome,nome");
        const collaborator = await sbGetOne(sb, "collaborators", "id", created.collaborator_id, "id,airtable_id,name");
        const { erogatoAirtableId } = await ensureErogatoForAppointment({ sb, apptRow: created, patient, collaborator });
        if (erogatoAirtableId) {
          const f2 = mergeAirtableFields(created.airtable_fields, { "Erogato collegato": [erogatoAirtableId], EROGATO: [erogatoAirtableId] });
          await sb.from("appointments").update({ airtable_fields: f2 }).eq("id", created.id);
        }

        return res.status(200).json({ ok: true, record: { id: created.airtable_id, fields: created.airtable_fields || {}, createdTime: "" } });
      }
    }

    // -----------------------------
    // NEW CONTRACT (requested):
    // POST /api/appointments -> create/update appointment
    // - Supports linked records: Paziente/Collaboratore/Caso clinico via recordId OR via primary name
    // - Uses fixed schema field names from Airtable CSV export
    // -----------------------------
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const appt = body.appointment || body;
      const recordId = norm(body.recordId || body.id || appt.recordId || appt.id);

      const startRaw = appt["Data e ora INIZIO"] ?? appt.start ?? appt.startISO ?? appt.start_at ?? appt.startAt;
      const endRaw = appt["Data e ora fine"] ?? appt["Data e ora FINE"] ?? appt.end ?? appt.endISO ?? appt.end_at ?? appt.endAt;
      const startISO = parseIsoOrThrow(startRaw, "start_at");
      const endISO = parseIsoOrThrow(endRaw, "end_at");

      let durata = appt["Durata (minuti)"] ?? appt.durataMinuti ?? appt.durationMinutes ?? appt.duration;
      if (durata === undefined || durata === null || String(durata).trim() === "") {
        const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
        const minutes = Math.max(0, Math.round(ms / 60000));
        durata = minutes;
      }

      const pazienteVal =
        appt.pazienteRecordId ?? appt.patientRecordId ?? appt.PazienteRecordId ?? appt.Paziente ?? appt.paziente ?? appt.patient;
      const collaboratoreVal =
        appt.collaboratoreRecordId ??
        appt.therapistRecordId ??
        appt.operatorRecordId ??
        appt.CollaboratoreRecordId ??
        appt.Collaboratore ??
        appt.collaboratore ??
        appt.therapist ??
        appt.operator;
      const casoVal =
        appt.casoClinicoRecordId ?? appt.caseRecordId ?? appt["Caso clinico"] ?? appt.casoClinico ?? appt.case;
      const prestazioneVal =
        appt.prestazioneRecordId ??
        appt.serviceRecordId ??
        appt["Prestazione prevista"] ??
        appt.prestazione ??
        appt.prestazionePrevista ??
        appt.codicePrestazione;

      if (!pazienteVal) return res.status(400).json({ ok: false, error: "missing_paziente" });
      if (!collaboratoreVal) return res.status(400).json({ ok: false, error: "missing_collaboratore" });

      const [pazienteId] = await resolveLinkedIds({ table: "ANAGRAFICA", values: pazienteVal });
      const [collaboratoreId] = await resolveLinkedIds({ table: "COLLABORATORI", values: collaboratoreVal });
      const casoIds = casoVal ? await resolveLinkedIds({ table: "CASI CLINICI", values: casoVal, allowMissing: true }) : [];

      const fields = {
        "Data e ora INIZIO": startISO,
        "Data e ora fine": endISO,
        "Durata (minuti)": Number(durata),
        Paziente: [pazienteId],
        Collaboratore: [collaboratoreId],
        DOMICILIO: Boolean(appt.DOMICILIO ?? appt.domicilio ?? false),
      };

      const tipoLavoro = norm(appt["Tipo lavoro"] ?? appt.tipoLavoro ?? appt.tipo_lavoro);
      if (tipoLavoro) fields["Tipo lavoro"] = tipoLavoro;

      // Optional linked "Prestazione prevista" -> PRESTAZIONI (can be recordId OR name OR codice).
      if (prestazioneVal !== undefined && prestazioneVal !== null && String(prestazioneVal).trim() !== "") {
        let prestIds = [];
        if (String(prestazioneVal).startsWith("rec")) prestIds = [String(prestazioneVal)];
        else {
          prestIds = await resolveLinkedIds({ table: "PRESTAZIONI", values: prestazioneVal, allowMissing: true });
          if (!prestIds.length) {
            // fallback by Codice exact
            const formula = `LOWER({Codice}&"") = LOWER("${escAirtableStringLib(String(prestazioneVal).trim())}")`;
            const found = await airtableList("PRESTAZIONI", { filterByFormula: formula, maxRecords: 1, pageSize: 1, fields: ["Servizio", "Codice"] });
            const rid = found.records?.[0]?.id || "";
            if (rid) prestIds = [rid];
          }
        }
        if (prestIds.length) fields["Prestazione prevista"] = [prestIds[0]];
      }

      const note = norm(appt["Note"] ?? appt.note ?? appt.notes);
      if (note || note === "") fields["Note"] = note;

      if (casoIds.length) fields["Caso clinico"] = casoIds;
      else if (casoVal === null || casoVal === "") fields["Caso clinico"] = [];

      const out = recordId
        ? await airtableUpdate("APPUNTAMENTI", recordId, fields)
        : await airtableCreate("APPUNTAMENTI", fields);

      return res.status(200).json({ ok: true, record: { id: out.id, fields: out.fields || {}, createdTime: out.createdTime || "" } });
    }

    if (req.method === "DELETE") {
      const role = normalizeRole(session.role || "");
      if (role === "physio") return res.status(403).json({ ok: false, error: "forbidden" });

      const id = norm(req.query?.id);
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });

      await airtableFetch(`${tableEnc}/${enc(id)}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "PATCH") {
      const schema = await resolveSchema(tableEnc, tableName);
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

      if (schema.FIELD_CONFIRMED_BY_PATIENT && ("confirmed_by_patient" in body || "confirmedByPatient" in body || "confermatoDalPaziente" in body)) {
        const v = body.confirmed_by_patient ?? body.confirmedByPatient ?? body.confermatoDalPaziente;
        fields[schema.FIELD_CONFIRMED_BY_PATIENT] = Boolean(v);
      }
      if (schema.FIELD_CONFIRMED_IN_PLATFORM && ("confirmed_in_platform" in body || "confirmedInPlatform" in body || "confermaInPiattaforma" in body)) {
        const v = body.confirmed_in_platform ?? body.confirmedInPlatform ?? body.confermaInPiattaforma;
        fields[schema.FIELD_CONFIRMED_IN_PLATFORM] = Boolean(v);
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
    return res.status(status).json({
      ok: false,
      error: e.message || "server_error",
      // Forward Airtable/debug context to the frontend (shown in agenda popup).
      details: e.details || e.airtable || undefined,
    });
  }
}
