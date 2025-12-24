import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";
import { memGet, memSet } from "./_common.js";

function enc(x) {
  return encodeURIComponent(String(x));
}

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

async function resolveCollaboratorRecordIdByEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email) return "";

  const cacheKey = `collabIdByEmail:${email}`;
  const cached = memGet(cacheKey);
  if (cached) return cached;

  const collabTable = enc(process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI");
  const formula = `LOWER({Email}) = LOWER("${email.replace(/"/g, '\\"')}")`;
  const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", pageSize: "1" });
  const data = await airtableFetch(`${collabTable}?${qs.toString()}`);
  const recId = data.records?.[0]?.id || "";
  if (recId) memSet(cacheKey, recId, 10 * 60_000);
  return recId;
}

async function physioCanAccessPatientViaLinkedOperator({ patientId, collabRecId }) {
  const pid = String(patientId).replace(/"/g, '\\"');
  const cid = String(collabRecId).replace(/"/g, '\\"');
  if (!pid || !cid) return false;

  const table = enc(process.env.AGENDA_TABLE || "APPUNTAMENTI");
  const patientField = process.env.AGENDA_PATIENT_FIELD || "Paziente";

  const operatorCandidates = [
    process.env.AGENDA_OPERATOR_FIELD,
    "Collaboratore",
    "Collaboratori",
    "Operatore",
    "Operator",
    "Fisioterapista",
  ].filter(Boolean);

  for (const opField of operatorCandidates) {
    const formula = `AND(FIND("${pid}", ARRAYJOIN({${patientField}})), FIND("${cid}", ARRAYJOIN({${opField}})))`;
    const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", pageSize: "1" });
    try {
      const data = await airtableFetch(`${table}?${qs.toString()}`);
      return Boolean(data?.records?.length);
    } catch (e) {
      if (isUnknownFieldError(e?.message)) continue;
      throw e;
    }
  }
  return false;
}

async function physioCanAccessPatient({ patientId, email }) {
  // Must have at least one appointment linked to that patient AND assigned to that physio.
  // Some Airtable bases store operator assignment via a linked-record field (Collaboratore/Operatore),
  // others keep a plain Email field on APPUNTAMENTI. We support both.

  const pid = String(patientId).replace(/"/g, '\\"');
  const em = String(email).replace(/"/g, '\\"');
  const table = enc(process.env.AGENDA_TABLE || "APPUNTAMENTI");
  const patientField = process.env.AGENDA_PATIENT_FIELD || "Paziente";

  // 1) Try Email-based assignment (fast if the field exists)
  try {
    const formulaEmail = `AND(FIND("${pid}", ARRAYJOIN({${patientField}})), LOWER({Email}) = LOWER("${em}"))`;
    const qs = new URLSearchParams({ filterByFormula: formulaEmail, maxRecords: "1", pageSize: "1" });
    const data = await airtableFetch(`${table}?${qs.toString()}`);
    return Boolean(data?.records?.length);
  } catch (e) {
    if (!isUnknownFieldError(e?.message)) throw e;
    // fallthrough to linked-operator approach
  }

  // 2) Linked operator field (preferred in this repo's agenda implementation)
  const collabRecId = await resolveCollaboratorRecordIdByEmail(email);
  if (!collabRecId) return false;
  return await physioCanAccessPatientViaLinkedOperator({ patientId, collabRecId });
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const patientId = req.query?.id;
    if (!patientId) return res.status(400).json({ error: "Missing id" });

    const role = normalizeRole(session.role);
    if (role === "physio") {
      const ok = await physioCanAccessPatient({ patientId, email: session.email });
      if (!ok) return res.status(403).json({ error: "Forbidden" });
    }

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

