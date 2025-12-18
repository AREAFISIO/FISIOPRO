import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";

function enc(x) {
  return encodeURIComponent(String(x));
}

function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

function isUnknownFieldError(e) {
  const msg = String(e?.message || "").toLowerCase();
  return msg.includes("unknown field name") || msg.includes("unknown field names");
}

async function getCollaboratorRecordIdByEmail(email) {
  const collabTable = enc(process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI");
  const formula = `LOWER({Email}) = LOWER("${escAirtableString(email)}")`;
  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
    pageSize: "1",
  });
  const data = await airtableFetch(`${collabTable}?${qs.toString()}`);
  return data?.records?.[0]?.id || "";
}

async function hasAppointmentWithPatientByEmail({ patientId, email }) {
  // Schema A: APPUNTAMENTI has an {Email} field (physio email).
  const formula = `AND(
    FIND("${escAirtableString(patientId)}", ARRAYJOIN({Paziente})),
    LOWER({Email}) = LOWER("${escAirtableString(email)}")
  )`;
  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
    pageSize: "1",
  });

  const table = enc("APPUNTAMENTI");
  const data = await airtableFetch(`${table}?${qs.toString()}`);
  return Boolean(data?.records?.length);
}

async function hasAppointmentWithPatientByLinkedOperator({ patientId, collaboratorRecId }) {
  // Schema B: APPUNTAMENTI links to COLLABORATORI via a linked-record field (Collaboratore/Operatore/...).
  const candidateFields = [
    process.env.AGENDA_OPERATOR_FIELD,
    "Collaboratore",
    "Collaboratori",
    "Operatore",
    "Operator",
    "Fisioterapista",
  ].filter(Boolean);

  const table = enc("APPUNTAMENTI");
  for (const fieldName of candidateFields) {
    const f = String(fieldName).trim();
    if (!f) continue;
    const formula = `AND(
      FIND("${escAirtableString(patientId)}", ARRAYJOIN({Paziente})),
      FIND("${escAirtableString(collaboratorRecId)}", ARRAYJOIN({${f}}))
    )`;
    const qs = new URLSearchParams({
      filterByFormula: formula,
      maxRecords: "1",
      pageSize: "1",
    });

    try {
      const data = await airtableFetch(`${table}?${qs.toString()}`);
      if (data?.records?.length) return true;
    } catch (e) {
      if (isUnknownFieldError(e)) continue;
      throw e;
    }
  }
  return false;
}

async function physioCanAccessPatient({ patientId, email }) {
  // Try by {Email} first (fast), fallback to linked-operator schema.
  try {
    return await hasAppointmentWithPatientByEmail({ patientId, email });
  } catch (e) {
    if (!isUnknownFieldError(e)) throw e;
  }

  const collabRecId = await getCollaboratorRecordIdByEmail(email);
  if (!collabRecId) return false;
  return await hasAppointmentWithPatientByLinkedOperator({ patientId, collaboratorRecId: collabRecId });
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

