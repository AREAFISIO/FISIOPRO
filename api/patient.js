import { airtableFetch, ensureRes, requireSession } from "./_auth.js";
import { memGet, memSet } from "./_common.js";

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

    const TABLE_PATIENTS = process.env.AIRTABLE_PATIENTS_TABLE || "ANAGRAFICA";
    const table = enc(TABLE_PATIENTS);

    const record = await airtableFetch(`${table}/${enc(patientId)}`);
    const f = record.fields || {};

    const FIELD_FIRSTNAME = process.env.AIRTABLE_PATIENTS_FIRSTNAME_FIELD || "Nome";
    const FIELD_LASTNAME = process.env.AIRTABLE_PATIENTS_LASTNAME_FIELD || "Cognome";
    const FIELD_PHONE = process.env.AIRTABLE_PATIENTS_PHONE_FIELD || "Telefono";
    const FIELD_EMAIL = process.env.AIRTABLE_PATIENTS_EMAIL_FIELD || "Email";
    const FIELD_DOB = process.env.AIRTABLE_PATIENTS_DOB_FIELD || "Data di nascita";
    const FIELD_NOTES = process.env.AIRTABLE_PATIENTS_NOTES_FIELD || "Note";

    return res.status(200).json({
      id: record.id,
      Nome: f[FIELD_FIRSTNAME] || f["Nome"] || "",
      Cognome: f[FIELD_LASTNAME] || f["Cognome"] || "",
      Telefono: f[FIELD_PHONE] || f["Telefono"] || "",
      Email: f[FIELD_EMAIL] || f["Email"] || "",
      "Data di nascita": f[FIELD_DOB] || f["Data di nascita"] || "",
      Note: f[FIELD_NOTES] || f["Note"] || "",
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || "Server error" });
  }
}

