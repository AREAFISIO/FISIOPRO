import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";

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
  const found = new Set();
  const qs = new URLSearchParams({ pageSize: "100" });
  const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
  for (const r of data.records || []) {
    const f = r.fields || {};
    for (const k of Object.keys(f)) found.add(k);
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

async function physioCanAccessPatient({ patientId, email }) {
  // Robust RBAC:
  // Prefer linking via {Collaboratore} (linked to COLLABORATORI) by matching the current user's record id.
  // Fallback to an appointments email field only if it exists.
  const APPTS_TABLE = process.env.AGENDA_TABLE || "APPUNTAMENTI";
  const COLLAB_TABLE = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";

  const apptsEnc = enc(APPTS_TABLE);
  const collabEnc = enc(COLLAB_TABLE);

  // Resolve current user collaborator record id by email
  const fEmail = `LOWER({Email}) = LOWER("${String(email || "").replace(/"/g, '\\"')}")`;
  const qsUser = new URLSearchParams({ filterByFormula: fEmail, maxRecords: "1", pageSize: "1" });
  const userData = await airtableFetch(`${collabEnc}?${qsUser.toString()}`);
  const userRecId = userData.records?.[0]?.id || "";

  // Resolve operator field name in APPUNTAMENTI
  const operatorCandidates = [
    process.env.AGENDA_OPERATOR_FIELD,
    "Collaboratore",
    "Collaboratori",
    "Operatore",
    "Fisioterapista",
  ].filter(Boolean);
  const emailCandidates = [process.env.AGENDA_EMAIL_FIELD, "Email", "E-mail", "email"].filter(Boolean);

  let FIELD_OPERATOR = await resolveFieldNameByProbe(apptsEnc, operatorCandidates);
  let FIELD_EMAIL = await resolveFieldNameByProbe(apptsEnc, emailCandidates);

  if (!FIELD_OPERATOR && !FIELD_EMAIL) {
    const discovered = await discoverFieldNames(apptsEnc);
    FIELD_OPERATOR = resolveFieldNameHeuristic(discovered, ["collaboratore", "operatore", "fisioterapista"]) || "";
    FIELD_EMAIL = resolveFieldNameHeuristic(discovered, ["email", "e-mail"]) || "";
  }

  const patientIdEsc = String(patientId).replace(/"/g, '\\"');
  const baseFilter = `FIND("${patientIdEsc}", ARRAYJOIN({Paziente}))`;

  let roleFilter = "FALSE()";
  if (userRecId && FIELD_OPERATOR) {
    roleFilter = `FIND("${String(userRecId).replace(/"/g, '\\"')}", ARRAYJOIN({${FIELD_OPERATOR}}))`;
  } else if (FIELD_EMAIL) {
    roleFilter = `LOWER({${FIELD_EMAIL}}) = LOWER("${String(email || "").replace(/"/g, '\\"')}")`;
  }

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

