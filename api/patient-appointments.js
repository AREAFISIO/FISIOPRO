// api/patient-appointments.js
import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";
import { enc, escAirtableString, memGetOrSet, setPrivateCache } from "./_common.js";
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

async function airtableListAll({ tableEnc, qs, max = 500 }) {
  let out = [];
  let offset = null;
  while (out.length < max) {
    const q = new URLSearchParams(qs);
    if (offset) q.set("offset", offset);
    const data = await airtableFetch(`${tableEnc}?${q.toString()}`);
    out = out.concat(data.records || []);
    offset = data.offset || null;
    if (!offset) break;
  }
  return out;
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    setPrivateCache(res, 30);

    const patientId = req.query.id;
    if (!patientId) return res.status(400).json({ error: "Missing id" });

    const tableName = process.env.AGENDA_TABLE || "APPUNTAMENTI";
    const tableEnc = enc(tableName);

    const FIELD_PATIENT = await resolveFieldName(
      tableEnc,
      `patientAppts:field:patient:${tableName}`,
      [process.env.AGENDA_PATIENT_FIELD, "Paziente", "Pazienti", "Patient", "Patients"].filter(Boolean),
      tableName,
    );
    const FIELD_EMAIL = await resolveFieldName(
      tableEnc,
      `patientAppts:field:email:${tableName}`,
      [process.env.AGENDA_EMAIL_FIELD, "Email", "E-mail", "E mail", "email"].filter(Boolean),
      tableName,
    );
    const FIELD_START = await resolveFieldName(
      tableEnc,
      `patientAppts:field:start:${tableName}`,
      [process.env.AGENDA_START_FIELD, "Data e ora INIZIO", "Data e ora Inizio", "Inizio", "Start", "Start at"].filter(Boolean),
      tableName,
    );
    const FIELD_END = await resolveFieldName(
      tableEnc,
      `patientAppts:field:end:${tableName}`,
      [process.env.AGENDA_END_FIELD, "Data e ora FINE", "Data e ora Fine", "Fine", "End", "End at"].filter(Boolean),
      tableName,
    );
    const FIELD_DUR = await resolveFieldName(
      tableEnc,
      `patientAppts:field:dur:${tableName}`,
      [process.env.AGENDA_DURATION_FIELD, "Durata", "Durata (min)", "Minuti"].filter(Boolean),
      tableName,
    );

    if (!FIELD_PATIENT || !FIELD_START) {
      return res.status(500).json({ error: "agenda_schema_mismatch" });
    }

    // Robust: support both linked-record and plain text fields for patient link.
    // Airtable does NOT support IFERROR() in formulas; string-concat coerces both types safely.
    const pid = escAirtableString(patientId);
    const patientExpr = `{${FIELD_PATIENT}} & ""`;
    const formula = `FIND("${pid}", ${patientExpr})`;

    const qs = new URLSearchParams({ pageSize: "100" });
    qs.set("filterByFormula", formula);
    // sort by start desc
    qs.append("sort[0][field]", FIELD_START);
    qs.append("sort[0][direction]", "desc");
    // limit fields for speed
    if (FIELD_EMAIL) qs.append("fields[]", FIELD_EMAIL);
    if (FIELD_START) qs.append("fields[]", FIELD_START);
    if (FIELD_END) qs.append("fields[]", FIELD_END);
    if (FIELD_DUR) qs.append("fields[]", FIELD_DUR);

    // Warm cache: improves repeated open/close of the patient page.
    const role = normalizeRole(session.role);
    const email = String(session.email || "").toLowerCase();
    const cacheKey = `patientAppts:${tableName}:${patientId}:${role}:${email}`;
    const records = await memGetOrSet(cacheKey, 15_000, async () => await airtableListAll({ tableEnc, qs, max: 500 }));

    // RBAC: se physio, filtro SOLO i suoi appuntamenti
    const filtered =
      role === "physio"
        ? records.filter(
            (r) =>
              (String(r.fields?.[FIELD_EMAIL] || r.fields?.Email || "")).toLowerCase() ===
              String(session.email || "").toLowerCase()
          )
        : records;

    const mapped = filtered.map((r) => ({
      id: r.id,
      Email: (r.fields?.[FIELD_EMAIL] ?? r.fields?.Email ?? "") || "",
      "Data e ora INIZIO": (r.fields?.[FIELD_START] ?? r.fields?.["Data e ora INIZIO"] ?? "") || "",
      "Data e ora FINE": (r.fields?.[FIELD_END] ?? r.fields?.["Data e ora FINE"] ?? "") || "",
      Durata: (r.fields?.[FIELD_DUR] ?? r.fields?.Durata) ?? "",
    }));

    return res.status(200).json({ records: mapped });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
