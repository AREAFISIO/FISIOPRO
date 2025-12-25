import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";
import { escAirtableString, memGet, memSet } from "./_common.js";

function enc(x) {
  return encodeURIComponent(String(x));
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
  // Pull some records and union field keys (Airtable omits null fields per-record).
  const found = new Set();
  let offset = null;
  let pages = 0;
  while (pages < 3) {
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
  // prefer longer, more specific names when tied
  score += Math.min(5, Math.floor(n.length / 10));
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

async function resolveCollaboratorByEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email) return { id: "", name: "" };

  const cacheKey = `collabByEmail:${email}`;
  const cached = memGet(cacheKey);
  if (cached) return cached;

  const collabTable = enc(process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI");
  const formula = `LOWER({Email}) = LOWER("${escAirtableString(email)}")`;
  const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", pageSize: "1" });
  const data = await airtableFetch(`${collabTable}?${qs.toString()}`);
  const rec = data.records?.[0] || null;
  const out = {
    id: rec?.id || "",
    name: String(rec?.fields?.["Nome completo"] || rec?.fields?.["Cognome e Nome"] || rec?.fields?.Name || "").trim(),
  };
  memSet(cacheKey, out, 10 * 60_000);
  return out;
}

async function physioCanAccessPatient({ patientId, email }) {
  // Must have at least one appointment linked to that patient AND assigned to that physio.
  // Preferred assignment is via linked-record operator field (Collaboratore/Operatore).
  // Some bases store assignment via a plain Email field instead. We support both,
  // resolving field names dynamically to avoid "Unknown field name" failures.

  const pid = escAirtableString(patientId);
  const emailNorm = String(email || "").trim().toLowerCase();
  const em = escAirtableString(emailNorm);
  if (!pid || !em) return false;

  const APPTS_TABLE = process.env.AGENDA_TABLE || "APPUNTAMENTI";
  const apptsEnc = enc(APPTS_TABLE);

  const patientCandidates = [
    process.env.AGENDA_PATIENT_FIELD,
    "Paziente",
    "Pazienti",
    "Patient",
    "Patients",
  ].filter(Boolean);

  const operatorCandidates = [
    process.env.AGENDA_OPERATOR_FIELD,
    "Collaboratore",
    "Collaboratori",
    "Collaborator",
    "Operatore",
    "Operator",
    "Fisioterapista",
  ].filter(Boolean);

  const emailCandidates = [
    process.env.AGENDA_EMAIL_FIELD,
    "Email",
    "E-mail",
    "E mail",
    "email",
  ].filter(Boolean);

  const schemaKey = `patientRBAC:schema:${APPTS_TABLE}:${patientCandidates.join("|")}:${operatorCandidates.join("|")}:${emailCandidates.join("|")}`;
  const cachedSchema = memGet(schemaKey) || null;

  let FIELD_PATIENT = cachedSchema?.FIELD_PATIENT || "";
  let FIELD_OPERATOR = cachedSchema?.FIELD_OPERATOR || "";
  let FIELD_EMAIL = cachedSchema?.FIELD_EMAIL || "";

  if (!FIELD_PATIENT || (!FIELD_OPERATOR && !FIELD_EMAIL)) {
    FIELD_PATIENT = FIELD_PATIENT || (await resolveFieldNameByProbe(apptsEnc, patientCandidates));
    FIELD_OPERATOR = FIELD_OPERATOR || (await resolveFieldNameByProbe(apptsEnc, operatorCandidates));
    FIELD_EMAIL = FIELD_EMAIL || (await resolveFieldNameByProbe(apptsEnc, emailCandidates));
  }

  if (!FIELD_PATIENT || (!FIELD_OPERATOR && !FIELD_EMAIL)) {
    const discoveredKey = `patientRBAC:fields:${APPTS_TABLE}`;
    let discovered = memGet(discoveredKey) || [];
    if (!discovered.length) {
      discovered = await discoverFieldNames(apptsEnc);
      memSet(discoveredKey, discovered, 10 * 60_000);
    }
    if (!FIELD_PATIENT) {
      FIELD_PATIENT =
        resolveFieldNameHeuristic(discovered, ["paziente", "pazienti", "patient", "patients"]) || "";
    }
    if (!FIELD_OPERATOR) {
      FIELD_OPERATOR =
        resolveFieldNameHeuristic(discovered, ["collaboratore", "collaboratori", "operatore", "operator", "fisioterapista"]) ||
        "";
    }
    if (!FIELD_EMAIL) FIELD_EMAIL = resolveFieldNameHeuristic(discovered, ["email", "e-mail"]) || "";
  }

  // Cache schema resolution for warm instances
  memSet(schemaKey, { FIELD_PATIENT, FIELD_OPERATOR, FIELD_EMAIL }, 60 * 60_000);

  if (!FIELD_PATIENT) return false;

  // Robust: support both linked-record arrays and plain text fields.
  const patientExpr = `IFERROR(ARRAYJOIN({${FIELD_PATIENT}}), {${FIELD_PATIENT}} & "")`;
  const baseFilter = `FIND("${pid}", ${patientExpr})`;

  // Prefer linked-record RBAC if we can resolve collaborator record id
  const collab = await resolveCollaboratorByEmail(emailNorm);
  const roleFilters = [];

  if (FIELD_OPERATOR) {
    const operatorExpr = `IFERROR(ARRAYJOIN({${FIELD_OPERATOR}}), {${FIELD_OPERATOR}} & "")`;
    if (collab?.id) roleFilters.push(`FIND("${escAirtableString(collab.id)}", ${operatorExpr})`);
    if (collab?.name) roleFilters.push(`FIND("${escAirtableString(collab.name)}", ${operatorExpr})`);
  }
  if (FIELD_EMAIL) {
    const emailExpr = `LOWER(IFERROR(ARRAYJOIN({${FIELD_EMAIL}}), {${FIELD_EMAIL}} & ""))`;
    roleFilters.push(`${emailExpr} = LOWER("${em}")`);
  }

  const roleFilter = roleFilters.length ? `OR(${roleFilters.join(",")})` : "FALSE()";

  const formula = `AND(${baseFilter}, ${roleFilter})`;
  const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", pageSize: "1" });
  const data = await airtableFetch(`${apptsEnc}?${qs.toString()}`);
  return Boolean(data?.records?.length);
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const patientId = req.query?.id;
    if (!patientId) return res.status(400).json({ error: "Missing id" });

    // NOTE: requirement: the patient card must be viewable even if the patient has no appointments yet.
    // So we do not gate access on appointment history.
    // (Authentication is still required above.)

    const table = enc("ANAGRAFICA");
    const record = await airtableFetch(`${table}/${enc(patientId)}`);

    const f = record.fields || {};
    return res.status(200).json({
      id: record.id,
      Nome: f["Nome"] || "",
      Cognome: f["Cognome"] || "",
      Telefono: f["Telefono"] || "",
      Email: f["Email"] || "",
      "Data di nascita": f["Data di nascita"] || "",
      Note: f["Note"] || "",
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || "Server error" });
  }
}

