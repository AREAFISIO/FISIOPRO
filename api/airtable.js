import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { memGetOrSet, setPrivateCache } from "./_common.js";
import { airtableListAll } from "./_airtableClient.js";
import { airtableSchema } from "../lib/airtableClient.js";

function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

function normalizeKeyLoose(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function resolveFieldKeyFromKeys(keys, candidates) {
  const list = Array.isArray(keys) ? keys : [];
  if (!list.length) return "";

  const byLower = new Map(list.map((k) => [String(k).toLowerCase(), String(k)]));
  for (const c of candidates || []) {
    const want = String(c || "").trim();
    if (!want) continue;
    const hit = byLower.get(want.toLowerCase());
    if (hit) return hit;
  }

  const byLoose = new Map(list.map((k) => [normalizeKeyLoose(k), String(k)]));
  for (const c of candidates || []) {
    const wantLoose = normalizeKeyLoose(c);
    if (!wantLoose) continue;
    const hit = byLoose.get(wantLoose);
    if (hit) return hit;
  }

  return "";
}

async function inferTableFieldKeys(tableEnc, cacheKey) {
  // Fast-path: if we have a local schema snapshot, avoid the extra Airtable call.
  // This removes a common cold-start penalty for endpoints that would otherwise probe fields.
  try {
    const tableName = decodeURIComponent(String(tableEnc || ""));
    const schema = airtableSchema?.[tableName] || null;
    const keys = Array.isArray(schema?.all_fields)
      ? schema.all_fields
      : (Array.isArray(schema?.key_fields) ? schema.key_fields : []);
    const list = (keys || []).map((k) => String(k || "").trim()).filter(Boolean);
    if (list.length) return list;
  } catch {
    // ignore schema decoding issues, fallback to probing Airtable
  }
  return await memGetOrSet(cacheKey, 60 * 60_000, async () => {
    // Single call: fetch one record without fields[] so we can see real keys.
    const data = await airtableFetch(`${tableEnc}?pageSize=1`);
    const first = data?.records?.[0]?.fields || {};
    return Object.keys(first || {});
  });
}

// ------------------------------------------------------------
// Reusable Airtable helper (requested for finance dashboards)
// ------------------------------------------------------------
// NOTE: `isUnknownFieldError` is already defined above; keep a single definition
// to avoid duplicate identifier errors in ESM/strict mode.

function escAirtableStringLiteral(v) {
  return String(v ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r|\n/g, " ")
    .trim();
}

export function airtableRecordToJson(record) {
  const r = record || {};
  const fields = r.fields && typeof r.fields === "object" ? r.fields : {};
  // "JSON pulito": id + fields flat (comodo per frontend/dashboard)
  return { id: r.id, createdTime: r.createdTime, ...fields };
}

// fetchAirtable(tableName, options)
// - gestione errori
// - parsing record Airtable → JSON pulito
// - predisposizione multi-clinica (?clinica=ID): tenta filtro su campo "Clinica" e fallback se non esiste
export async function fetchAirtable(tableName, options = {}) {
  const t = String(tableName || "").trim();
  if (!t) throw new Error("missing_tableName");

  const {
    view,
    fields,
    filterByFormula,
    sort,
    pageSize = 100,
    maxRecords = 5000,
    clinicaId,
    clinicField = process.env.AIRTABLE_CLINICA_FIELD || "Clinica",
  } = options || {};

  const clinicFormula = clinicaId ? `{${String(clinicField).trim() || "Clinica"}}="${escAirtableStringLiteral(clinicaId)}"` : "";
  const mergedFormula =
    [filterByFormula, clinicFormula].filter((x) => String(x || "").trim()).length > 0
      ? `AND(${[filterByFormula, clinicFormula].filter((x) => String(x || "").trim()).join(",")})`
      : "";

  let records;
  try {
    records = await airtableListAll({
      tableName: t,
      view: view || undefined,
      fields: Array.isArray(fields) ? fields : undefined,
      filterByFormula: mergedFormula || undefined,
      sort: Array.isArray(sort) ? sort : undefined,
      pageSize,
      maxRecords,
    });
  } catch (e) {
    // Safe fallback: if base doesn't have clinic field yet, return aggregated.
    if (clinicaId && isUnknownFieldError(e?.message)) {
      records = await airtableListAll({
        tableName: t,
        view: view || undefined,
        fields: Array.isArray(fields) ? fields : undefined,
        filterByFormula: filterByFormula || undefined,
        sort: Array.isArray(sort) ? sort : undefined,
        pageSize,
        maxRecords,
      });
    } else {
      throw e;
    }
  }

  return (records || []).map(airtableRecordToJson);
}

export default async function handler(req, res) {
  ensureRes(res);
  // NOTE: "Anagrafica / Pazienti" is available from the unified sidebar also for Back Office,
  // so this endpoint must allow "back" to avoid 403 and an empty/broken patient list UI.
  const user = requireRoles(req, res, ["physio", "front", "back", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const op = String(req.query?.op || "").trim();
    const includeFields = String(req.query?.includeFields || "").trim() === "1";
    setPrivateCache(res, 30);

    // === CONFIG (default) ===
    const TABLE_PATIENTS = process.env.AIRTABLE_PATIENTS_TABLE || "ANAGRAFICA";
    const FIELD_NAME_ENV = process.env.AIRTABLE_PATIENTS_NAME_FIELD;
    const FIELD_PHONE_ENV = process.env.AIRTABLE_PATIENTS_PHONE_FIELD;
    const FIELD_EMAIL_ENV = process.env.AIRTABLE_PATIENTS_EMAIL_FIELD;
    const FIELD_FIRSTNAME_ENV = process.env.AIRTABLE_PATIENTS_FIRSTNAME_FIELD;
    const FIELD_LASTNAME_ENV = process.env.AIRTABLE_PATIENTS_LASTNAME_FIELD;
    const FIELD_FISCAL_ENV = process.env.AIRTABLE_PATIENTS_FISCAL_FIELD;
    const FIELD_DOB_ENV = process.env.AIRTABLE_PATIENTS_DOB_FIELD;
    const FIELD_CHANNELS_ENV = process.env.AIRTABLE_PATIENTS_CHANNELS_FIELD;

    const table = encodeURIComponent(TABLE_PATIENTS);

    // Resolve real field names (to avoid "Unknown field name" errors) WITHOUT probing many times.
    // We infer keys from a single sample record and match candidates (case-insensitive / loose).
    const tableKeys = await inferTableFieldKeys(table, `patients:keys:${TABLE_PATIENTS}`);

    const FIELD_NAME = resolveFieldKeyFromKeys(
      tableKeys,
      [FIELD_NAME_ENV, "Cognome e Nome", "Nome completo", "Full Name", "Name"].filter(Boolean),
    );
    const FIELD_PHONE = resolveFieldKeyFromKeys(
      tableKeys,
      [FIELD_PHONE_ENV, "Telefono", "Numero di telefono", "Cellulare", "Mobile"].filter(Boolean),
    );
    const FIELD_EMAIL = resolveFieldKeyFromKeys(
      tableKeys,
      [FIELD_EMAIL_ENV, "Email", "E-mail", "E mail"].filter(Boolean),
    );
    const FIELD_FIRSTNAME = resolveFieldKeyFromKeys(
      tableKeys,
      [FIELD_FIRSTNAME_ENV, "Nome", "First name", "Firstname"].filter(Boolean),
    );
    const FIELD_LASTNAME = resolveFieldKeyFromKeys(
      tableKeys,
      [FIELD_LASTNAME_ENV, "Cognome", "Last name", "Lastname"].filter(Boolean),
    );
    const FIELD_FISCAL = resolveFieldKeyFromKeys(
      tableKeys,
      [FIELD_FISCAL_ENV, "Codice Fiscale", "Codice fiscale", "CF"].filter(Boolean),
    );
    const FIELD_DOB = resolveFieldKeyFromKeys(
      tableKeys,
      [FIELD_DOB_ENV, "Data di nascita", "Nascita", "DOB", "Birthdate"].filter(Boolean),
    );
    const FIELD_CHANNELS = resolveFieldKeyFromKeys(
      tableKeys,
      [FIELD_CHANNELS_ENV, "Canali di comunicazione preferiti", "Canali preferiti", "Canali"].filter(Boolean),
    );

    if (op === "health") {
      const data = await airtableFetch(`${table}?pageSize=1`);
      return res.status(200).json({ ok: true, recordsFound: data?.records?.length || 0 });
    }

    if (op === "samplePatients") {
      const data = await airtableFetch(`${table}?pageSize=1`);
      const first = data.records?.[0] || null;
      const fieldNames = first?.fields ? Object.keys(first.fields) : [];
      return res.status(200).json({
        ok: true,
        table: TABLE_PATIENTS,
        firstRecordId: first?.id || null,
        fieldNames,
        firstFieldsPreview: first?.fields || null,
      });
    }

    if (op === "listPatients") {
      const qs = new URLSearchParams({ pageSize: "10" });
      // limit fields for speed
      if (FIELD_NAME) qs.append("fields[]", FIELD_NAME);
      if (FIELD_PHONE) qs.append("fields[]", FIELD_PHONE);
      if (FIELD_EMAIL) qs.append("fields[]", FIELD_EMAIL);
      const data = await airtableFetch(`${table}?${qs.toString()}`);
      const items = (data.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] ?? "",
        phone: r.fields?.[FIELD_PHONE] ?? "",
        email: r.fields?.[FIELD_EMAIL] ?? "",
      }));
      return res.status(200).json({ ok: true, items });
    }

    if (op === "searchPatients") {
      const qRaw = String(req.query?.q || "").trim();
      if (!qRaw) {
        const qs0 = new URLSearchParams({ pageSize: "10" });
        if (FIELD_NAME) qs0.append("fields[]", FIELD_NAME);
        if (FIELD_PHONE) qs0.append("fields[]", FIELD_PHONE);
        if (FIELD_EMAIL) qs0.append("fields[]", FIELD_EMAIL);
        const data = await airtableFetch(`${table}?${qs0.toString()}`);
        const items = (data.records || []).map((r) => ({
          id: r.id,
          name: r.fields?.[FIELD_NAME] ?? "",
          phone: r.fields?.[FIELD_PHONE] ?? "",
          email: r.fields?.[FIELD_EMAIL] ?? "",
        }));
        return res.status(200).json({ ok: true, items });
      }

      const q = escAirtableString(qRaw.toLowerCase());
      const parts = [];
      if (FIELD_NAME) parts.push(`FIND("${q}", LOWER({${FIELD_NAME}}))`);
      if (FIELD_PHONE) parts.push(`FIND("${q}", LOWER({${FIELD_PHONE}}))`);
      if (FIELD_EMAIL) parts.push(`FIND("${q}", LOWER({${FIELD_EMAIL}}))`);
      if (!parts.length) return res.status(500).json({ ok: false, error: "patients_schema_mismatch" });
      const formula = `OR(${parts.join(",")})`;

      const qs = new URLSearchParams({
        filterByFormula: formula,
        maxRecords: "20",
        pageSize: "20",
      });
      if (FIELD_NAME) qs.append("fields[]", FIELD_NAME);
      if (FIELD_PHONE) qs.append("fields[]", FIELD_PHONE);
      if (FIELD_EMAIL) qs.append("fields[]", FIELD_EMAIL);

      const data = await airtableFetch(`${table}?${qs.toString()}`);
      const items = (data.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] ?? "",
        phone: r.fields?.[FIELD_PHONE] ?? "",
        email: r.fields?.[FIELD_EMAIL] ?? "",
      }));

      return res.status(200).json({ ok: true, items });
    }

    if (op === "listPatientsFull" || op === "searchPatientsFull") {
      // Nota: per evitare errori Airtable, la formula di ricerca usa solo campi “sicuri”
      // (quelli già utilizzati nel progetto / coerenti con il setup). Campi opzionali
      // (es. Codice Fiscale / Canali) vengono comunque restituiti se presenti.
      const qRaw = String(req.query?.q || "").trim();
      const q = escAirtableString(qRaw.toLowerCase());

      const maxRecords = Math.min(Number(req.query?.maxRecords || 200) || 200, 500);
      const pageSize = Math.min(Number(req.query?.pageSize || 50) || 50, 100);

      const qs = new URLSearchParams({
        maxRecords: String(maxRecords),
        pageSize: String(pageSize),
      });

      // request only the fields we actually render (big performance win)
      if (FIELD_FIRSTNAME) qs.append("fields[]", FIELD_FIRSTNAME);
      if (FIELD_LASTNAME) qs.append("fields[]", FIELD_LASTNAME);
      if (FIELD_NAME) qs.append("fields[]", FIELD_NAME);
      if (FIELD_FISCAL) qs.append("fields[]", FIELD_FISCAL);
      if (FIELD_EMAIL) qs.append("fields[]", FIELD_EMAIL);
      if (FIELD_PHONE) qs.append("fields[]", FIELD_PHONE);
      if (FIELD_DOB) qs.append("fields[]", FIELD_DOB);
      if (FIELD_CHANNELS) qs.append("fields[]", FIELD_CHANNELS);

      if (q) {
        const parts = [];
        if (FIELD_FIRSTNAME) parts.push(`FIND("${q}", LOWER({${FIELD_FIRSTNAME}}))`);
        if (FIELD_LASTNAME) parts.push(`FIND("${q}", LOWER({${FIELD_LASTNAME}}))`);
        if (FIELD_PHONE) parts.push(`FIND("${q}", LOWER({${FIELD_PHONE}}))`);
        if (FIELD_EMAIL) parts.push(`FIND("${q}", LOWER({${FIELD_EMAIL}}))`);
        if (FIELD_NAME) parts.push(`FIND("${q}", LOWER({${FIELD_NAME}}))`);
        if (!parts.length) return res.status(500).json({ ok: false, error: "patients_schema_mismatch" });
        const formula = `OR(${parts.join(",")})`;
        qs.set("filterByFormula", formula);
      }

      const cacheKey = `patientsFull:${TABLE_PATIENTS}:${q}:${maxRecords}:${pageSize}`;
      const items = await memGetOrSet(cacheKey, 30_000, async () => {
        const data = await airtableFetch(`${table}?${qs.toString()}`);
        return (data.records || []).map((r) => {
          const f = r.fields || {};
          const out = {
            id: r.id,
            Nome: (FIELD_FIRSTNAME ? f[FIELD_FIRSTNAME] : undefined) ?? f["Nome"] ?? "",
            Cognome: (FIELD_LASTNAME ? f[FIELD_LASTNAME] : undefined) ?? f["Cognome"] ?? "",
            "Codice Fiscale": (FIELD_FISCAL ? f[FIELD_FISCAL] : undefined) ?? f["Codice Fiscale"] ?? f["Codice fiscale"] ?? "",
            Email: (FIELD_EMAIL ? f[FIELD_EMAIL] : undefined) ?? f["Email"] ?? f["E-mail"] ?? "",
            Telefono: (FIELD_PHONE ? f[FIELD_PHONE] : undefined) ?? f["Telefono"] ?? f["Numero di telefono"] ?? "",
            "Data di nascita": (FIELD_DOB ? f[FIELD_DOB] : undefined) ?? f["Data di nascita"] ?? "",
            "Canali di comunicazione preferiti":
              (FIELD_CHANNELS ? f[FIELD_CHANNELS] : undefined) ?? f["Canali di comunicazione preferiti"] ?? f["Canali preferiti"] ?? "",
            // fallback utile se il base ha il campo unico
            "Cognome e Nome": (FIELD_NAME ? f[FIELD_NAME] : undefined) ?? f["Cognome e Nome"] ?? "",
          };
          if (includeFields) out._fields = f;
          return out;
        });
      });

      return res.status(200).json({ ok: true, items });
    }

    return res.status(400).json({ ok: false, error: "unknown_op" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

