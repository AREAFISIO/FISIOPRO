import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";

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

async function resolveFieldNameByProbe(tableEnc, candidates) {
  for (const c of (candidates || []).filter(Boolean)) {
    if (await probeField(tableEnc, c)) return String(c).trim();
  }
  return "";
}

async function discoverFieldNames(tableEnc) {
  const found = new Set();
  let offset = null;
  let pages = 0;
  while (pages < 2) {
    pages += 1;
    const qs = new URLSearchParams({ pageSize: "100" });
    if (offset) qs.set("offset", offset);
    const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
    for (const r of data.records || []) {
      const f = r.fields || {};
      for (const k of Object.keys(f)) found.add(k);
    }
    offset = data.offset || null;
    if (!offset) break;
  }
  return Array.from(found);
}

function scoreField(name, keywords) {
  const n = String(name || "").toLowerCase();
  let score = 0;
  for (const k of keywords) {
    const kk = String(k || "").toLowerCase();
    if (!kk) continue;
    if (n === kk) score += 100;
    else if (n.includes(kk)) score += 10;
  }
  return score;
}

function resolveFieldNameHeuristic(fieldNames, keywords) {
  let best = "";
  let bestScore = -1;
  for (const name of fieldNames || []) {
    const s = scoreField(name, keywords);
    if (s > bestScore) {
      bestScore = s;
      best = name;
    }
  }
  return bestScore >= 10 ? best : "";
}

let patientSchemaCache = null; // { tableEnc, resolved, atMs }
async function resolvePatientsSchema(tableEnc) {
  if (patientSchemaCache?.tableEnc === tableEnc && Date.now() - patientSchemaCache.atMs < 5 * 60_000) {
    return patientSchemaCache.resolved;
  }

  const discovered = await discoverFieldNames(tableEnc);

  const FIELD_NOME =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_FIRSTNAME_FIELD, "Nome", "First name", "First Name"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["nome", "first"]) ||
    "";
  const FIELD_COGNOME =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_LASTNAME_FIELD, "Cognome", "Last name", "Last Name"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["cognome", "last"]) ||
    "";
  const FIELD_NAME_COMBINED =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_NAME_FIELD, "Cognome e Nome", "Nome completo", "Full Name", "Name"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["cognome e nome", "nome completo", "full name"]) ||
    "";

  const FIELD_CF =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_FISCAL_CODE_FIELD, "Codice fiscale", "Codice Fiscale", "CF"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["codice fiscale", "cf"]) ||
    "";

  const FIELD_EMAIL =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_EMAIL_FIELD, "Email", "E-mail", "E-Mail"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["email", "e-mail"]) ||
    "";

  const FIELD_CELL =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_MOBILE_FIELD, "Cellulare", "Telefono", "Numero di telefono", "Mobile"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["cellulare", "telefono", "numero"]) ||
    "";

  const FIELD_DOB =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_DOB_FIELD, "Data di nascita", "Data nascita", "Nascita", "DOB", "Birthdate"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["data di nascita", "nascita", "dob"]) ||
    "";

  const FIELD_NEXT_NOTIFY =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_NEXT_NOTIFY_FIELD, "Prossima notifica", "Prossima Notifica", "Next notification"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["prossima notifica", "next notification", "notifica"]) ||
    "";

  // Notification channel flags (best-effort)
  const FIELD_NOTIFY_SMS =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_NOTIFY_SMS_FIELD, "Notifica SMS", "SMS"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["sms"]) ||
    "";
  const FIELD_NOTIFY_EMAIL =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_NOTIFY_EMAIL_FIELD, "Notifica Email", "Notifica E-mail"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["notifica email"]) ||
    "";
  const FIELD_NOTIFY_WA =
    (await resolveFieldNameByProbe(tableEnc, [process.env.AIRTABLE_PATIENTS_NOTIFY_WA_FIELD, "Notifica WhatsApp", "Whatsapp", "WhatsApp"].filter(Boolean))) ||
    resolveFieldNameHeuristic(discovered, ["whatsapp"]) ||
    "";

  const resolved = {
    FIELD_NOME,
    FIELD_COGNOME,
    FIELD_NAME_COMBINED,
    FIELD_CF,
    FIELD_EMAIL,
    FIELD_CELL,
    FIELD_DOB,
    FIELD_NEXT_NOTIFY,
    FIELD_NOTIFY_SMS,
    FIELD_NOTIFY_EMAIL,
    FIELD_NOTIFY_WA,
    discovered,
  };

  patientSchemaCache = { tableEnc, resolved, atMs: Date.now() };
  return resolved;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const op = String(req.query?.op || "").trim();

    // === CONFIG (default) ===
    const TABLE_PATIENTS = process.env.AIRTABLE_PATIENTS_TABLE || "ANAGRAFICA";
    const FIELD_NAME = process.env.AIRTABLE_PATIENTS_NAME_FIELD || "Cognome e Nome";
    const FIELD_PHONE = process.env.AIRTABLE_PATIENTS_PHONE_FIELD || "Numero di telefono";
    const FIELD_EMAIL = process.env.AIRTABLE_PATIENTS_EMAIL_FIELD || "E-mail";

    const table = encodeURIComponent(TABLE_PATIENTS);

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
      const data = await airtableFetch(`${table}?pageSize=10`);
      const items = (data.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] ?? "",
        phone: r.fields?.[FIELD_PHONE] ?? "",
        email: r.fields?.[FIELD_EMAIL] ?? "",
      }));
      return res.status(200).json({ ok: true, items });
    }

    // OsteoEasy-like patient list (rich fields + pagination)
    if (op === "listPatientsRich" || op === "searchPatientsRich") {
      const pageSize = Math.max(5, Math.min(50, Number(req.query?.pageSize || 10) || 10));
      const offset = String(req.query?.offset || "").trim();
      const qRaw = String(req.query?.q || "").trim();

      const schema = await resolvePatientsSchema(table);

      // Airtable request
      const qs = new URLSearchParams({ pageSize: String(pageSize) });
      if (offset) qs.set("offset", offset);

      // Select only fields that exist (to avoid Unknown field errors)
      const pick = (...names) => names.filter((x) => x && typeof x === "string");
      const fields = [
        schema.FIELD_NOME,
        schema.FIELD_COGNOME,
        schema.FIELD_NAME_COMBINED,
        schema.FIELD_CF,
        schema.FIELD_EMAIL,
        schema.FIELD_CELL,
        schema.FIELD_DOB,
        schema.FIELD_NEXT_NOTIFY,
        schema.FIELD_NOTIFY_SMS,
        schema.FIELD_NOTIFY_EMAIL,
        schema.FIELD_NOTIFY_WA,
      ].filter(Boolean);
      for (const f of fields) qs.append("fields[]", f);

      // Sorting: prefer Cognome then Nome (if present), else combined name.
      const sortField = schema.FIELD_COGNOME || schema.FIELD_NAME_COMBINED || schema.FIELD_NOME || "";
      if (sortField) {
        qs.append("sort[0][field]", sortField);
        qs.append("sort[0][direction]", "asc");
      }

      // Search formula (if needed)
      if (op === "searchPatientsRich" && qRaw) {
        const q = escAirtableString(qRaw.toLowerCase());
        const parts = [];
        const addFind = (f) => {
          if (!f) return;
          parts.push(`FIND("${q}", LOWER({${f}}))`);
        };
        addFind(schema.FIELD_NOME);
        addFind(schema.FIELD_COGNOME);
        addFind(schema.FIELD_NAME_COMBINED);
        addFind(schema.FIELD_CF);
        addFind(schema.FIELD_EMAIL);
        addFind(schema.FIELD_CELL);
        if (parts.length) qs.set("filterByFormula", `OR(${parts.join(",")})`);
      }

      const data = await airtableFetch(`${table}?${qs.toString()}`);
      const items = (data.records || []).map((r) => {
        const f = r.fields || {};
        const nome = schema.FIELD_NOME ? (f[schema.FIELD_NOME] ?? "") : "";
        const cognome = schema.FIELD_COGNOME ? (f[schema.FIELD_COGNOME] ?? "") : "";
        const full = schema.FIELD_NAME_COMBINED ? (f[schema.FIELD_NAME_COMBINED] ?? "") : "";
        const name = String([nome, cognome].filter(Boolean).join(" ").trim() || full || "").trim();
        return {
          id: r.id,
          nome: String(nome ?? "").trim(),
          cognome: String(cognome ?? "").trim(),
          name,
          codice_fiscale: String((schema.FIELD_CF ? f[schema.FIELD_CF] : "") ?? "").trim(),
          email: String((schema.FIELD_EMAIL ? f[schema.FIELD_EMAIL] : "") ?? "").trim(),
          cellulare: String((schema.FIELD_CELL ? f[schema.FIELD_CELL] : "") ?? "").trim(),
          data_nascita: String((schema.FIELD_DOB ? f[schema.FIELD_DOB] : "") ?? "").trim(),
          prossima_notifica: String((schema.FIELD_NEXT_NOTIFY ? f[schema.FIELD_NEXT_NOTIFY] : "") ?? "").trim(),
          notify: {
            sms: Boolean(schema.FIELD_NOTIFY_SMS ? f[schema.FIELD_NOTIFY_SMS] : false),
            email: Boolean(schema.FIELD_NOTIFY_EMAIL ? f[schema.FIELD_NOTIFY_EMAIL] : false),
            whatsapp: Boolean(schema.FIELD_NOTIFY_WA ? f[schema.FIELD_NOTIFY_WA] : false),
          },
        };
      });

      return res.status(200).json({ ok: true, items, offset: data.offset || null, pageSize });
    }

    if (op === "searchPatients") {
      const qRaw = String(req.query?.q || "").trim();
      if (!qRaw) {
        const data = await airtableFetch(`${table}?pageSize=10`);
        const items = (data.records || []).map((r) => ({
          id: r.id,
          name: r.fields?.[FIELD_NAME] ?? "",
          phone: r.fields?.[FIELD_PHONE] ?? "",
          email: r.fields?.[FIELD_EMAIL] ?? "",
        }));
        return res.status(200).json({ ok: true, items });
      }

      const q = escAirtableString(qRaw.toLowerCase());
      const formula = `OR(
        FIND("${q}", LOWER({${FIELD_NAME}})),
        FIND("${q}", LOWER({${FIELD_PHONE}})),
        FIND("${q}", LOWER({${FIELD_EMAIL}}))
      )`;

      const qs = new URLSearchParams({
        filterByFormula: formula,
        maxRecords: "20",
        pageSize: "20",
      });

      const data = await airtableFetch(`${table}?${qs.toString()}`);
      const items = (data.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] ?? "",
        phone: r.fields?.[FIELD_PHONE] ?? "",
        email: r.fields?.[FIELD_EMAIL] ?? "",
      }));

      return res.status(200).json({ ok: true, items });
    }

    return res.status(400).json({ ok: false, error: "unknown_op" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

