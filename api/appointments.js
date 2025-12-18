// api/appointments.js
import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    const err = new Error("Missing env vars: " + missing.join(", "));
    err.status = 500;
    throw err;
  }
}

function ymdToRange(dateYMD) {
  // range [start, end) in ISO, in UTC to keep it stable
  // Airtable datetime is ISO; we filter by IS_AFTER/IS_BEFORE on UTC midnights
  const [y, m, d] = dateYMD.split("-").map((x) => parseInt(x, 10));
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

async function airtableList({ baseId, token, table, filterByFormula, fields = [], sortField }) {
  const params = new URLSearchParams();
  if (filterByFormula) params.set("filterByFormula", filterByFormula);
  if (sortField) {
    params.append("sort[0][field]", sortField);
    params.append("sort[0][direction]", "asc");
  }
  for (const f of fields) params.append("fields[]", f);
  params.set("pageSize", "100");

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${params.toString()}`;

  let out = [];
  let offset = null;

  while (true) {
    const pageUrl = offset ? url + `&offset=${encodeURIComponent(offset)}` : url;
    const res = await fetch(pageUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch {}

    if (!res.ok) {
      const msg =
        json?.error?.message ||
        json?.error ||
        text ||
        `Airtable error ${res.status}`;
      const err = new Error(msg);
      err.status = 502;
      throw err;
    }

    out = out.concat(json.records || []);
    if (!json.offset) break;
    offset = json.offset;
  }

  return out;
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

async function createAirtableRecord({ tableName, fields }) {
  const tableEnc = encodeURIComponent(tableName);
  const body = JSON.stringify({ records: [{ fields }] });
  const data = await airtableFetch(tableEnc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const rec = data?.records?.[0] || null;
  return rec;
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    requireEnv("AIRTABLE_TOKEN", "AIRTABLE_BASE_ID");

    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
    const APPTS_TABLE = process.env.AGENDA_TABLE || "APPUNTAMENTI";

    // CREATE appointment (OsteoEasy-like agenda)
    if (req.method === "POST") {
      const role = normalizeRole(session.role || "");
      if (!["physio", "front", "manager"].includes(role)) return res.status(403).json({ error: "Forbidden" });

      const start_at = String(req.body?.start_at || "").trim();
      const duration_min = Number(req.body?.duration_min || 0);
      const patient_id = String(req.body?.patient_id || "").trim();
      const operator_id = String(req.body?.operator_id || "").trim(); // Airtable record id (COLLABORATORI)
      const operator_name = String(req.body?.operator_name || "").trim();
      const location_name = String(req.body?.location_name || "").trim();
      const type_label = String(req.body?.type || "").trim();
      const internal_note = String(req.body?.internal_note || "").trim();
      const patient_note = String(req.body?.patient_note || "").trim();

      if (!start_at) return res.status(400).json({ error: "Missing start_at" });
      if (!Number.isFinite(duration_min) || duration_min <= 0) return res.status(400).json({ error: "Invalid duration_min" });

      const startDT = new Date(start_at);
      if (isNaN(startDT.getTime())) return res.status(400).json({ error: "Invalid start_at" });
      const endDT = new Date(startDT.getTime() + duration_min * 60000);

      const tableEnc = encodeURIComponent(APPTS_TABLE);
      const discovered = await discoverFieldNames(tableEnc);

      const FIELD_START =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_START_FIELD, "Data e ora INIZIO", "Inizio", "Start", "Start at"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["data e ora inizio", "inizio", "start"]) ||
        "";

      const FIELD_END =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_END_FIELD, "Data e ora FINE", "Fine", "End", "End at"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["data e ora fine", "fine", "end"]) ||
        "";

      const FIELD_OPERATOR =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_OPERATOR_FIELD, "Collaboratore", "Operatore", "Fisioterapista"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["collaboratore", "operatore", "fisioterapista"]) ||
        "";

      const FIELD_PATIENT =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_PATIENT_FIELD, "Paziente", "Patient"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["paziente", "patient"]) ||
        "";

      const FIELD_EMAIL =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_EMAIL_FIELD, "Email", "E-mail"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["email", "e-mail"]) ||
        "";

      const FIELD_DUR =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_DURATION_FIELD, "Durata", "Durata (min)", "Minuti"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["durata", "min"]) ||
        "";

      const FIELD_LOCATION =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_LOCATION_FIELD, "Luogo appuntamento", "Luogo di lavoro", "Sede", "Location"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["luogo", "sede", "location"]) ||
        "";

      const FIELD_TYPE =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_TYPE_FIELD, "Tipologia", "Tipo"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["tipologia", "tipo"]) ||
        "";

      const FIELD_INTERNAL_NOTE =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_INTERNAL_NOTE_FIELD, "Nota interna", "Note interne", "internal_note"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["nota interna", "note interne", "internal"]) ||
        "";

      const FIELD_PATIENT_NOTE =
        (await resolveFieldNameByProbe(tableEnc, [process.env.AGENDA_PATIENT_NOTE_FIELD, "Note paziente", "Note visibili al paziente", "patient_note"].filter(Boolean))) ||
        resolveFieldNameHeuristic(discovered, ["note paziente", "visibili", "patient"]) ||
        "";

      if (!FIELD_START || !FIELD_END) {
        return res.status(500).json({
          error: "agenda_schema_mismatch",
          details: { table: APPTS_TABLE, resolved: { FIELD_START, FIELD_END } },
        });
      }

      const fields = {
        [FIELD_START]: startDT.toISOString(),
        [FIELD_END]: endDT.toISOString(),
      };

      if (FIELD_DUR) fields[FIELD_DUR] = duration_min;
      if (FIELD_EMAIL) fields[FIELD_EMAIL] = String(session.email || "").toLowerCase();
      if (FIELD_LOCATION && location_name) fields[FIELD_LOCATION] = location_name;
      if (FIELD_TYPE && type_label) fields[FIELD_TYPE] = type_label;
      if (FIELD_INTERNAL_NOTE && internal_note) fields[FIELD_INTERNAL_NOTE] = internal_note;
      if (FIELD_PATIENT_NOTE && patient_note) fields[FIELD_PATIENT_NOTE] = patient_note;

      if (FIELD_PATIENT && patient_id) fields[FIELD_PATIENT] = [patient_id];

      if (FIELD_OPERATOR) {
        if (operator_id) fields[FIELD_OPERATOR] = [operator_id];
        else if (operator_name) fields[FIELD_OPERATOR] = operator_name;
      }

      const rec = await createAirtableRecord({ tableName: APPTS_TABLE, fields });
      return res.status(201).json({ ok: true, id: rec?.id || null, fields: rec?.fields || null });
    }

    // existing behavior: GET by date (legacy)
    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    const date = (req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }

    const { startISO, endISO } = ymdToRange(date);

    // CAMPI esatti (i tuoi)
    const FIELD_EMAIL = "Email";
    const FIELD_START = "Data e ora INIZIO";
    const FIELD_END = "Data e ora FINE";
    const FIELD_DUR = "Durata";
    const FIELD_PAT = "Paziente";

    // filtro data: start >= startISO AND start < endISO
    // NB: Airtable formula: AND(IS_AFTER({Start}, "iso"), IS_BEFORE({Start},"iso"))
    // IS_AFTER è strict, quindi per includere esattamente la mezzanotte usiamo DATETIME_PARSE e >= via OR:
    // più semplice: AND({Start} >= startISO, {Start} < endISO) non esiste.
    // workaround robusto: AND(
    //   OR(IS_AFTER({Start}, startISO), IS_SAME({Start}, startISO)),
    //   IS_BEFORE({Start}, endISO)
    // )
    const dateFilter = `AND(
      OR(IS_AFTER({${FIELD_START}}, "${startISO}"), IS_SAME({${FIELD_START}}, "${startISO}")),
      IS_BEFORE({${FIELD_START}}, "${endISO}")
    )`;

    // RBAC: se physio -> aggiungo filtro Email = session.email
    const role = normalizeRole(session.role || "");
    const email = String(session.email || "").toLowerCase();

    const roleFilter =
      role === "physio"
        ? `{${FIELD_EMAIL}} = "${email}"`
        : "TRUE()";

    const filterByFormula = `AND(${dateFilter}, ${roleFilter})`;

    const records = await airtableList({
      baseId: AIRTABLE_BASE_ID,
      token: AIRTABLE_TOKEN,
      table: "APPUNTAMENTI",
      filterByFormula,
      fields: [FIELD_EMAIL, FIELD_START, FIELD_END, FIELD_DUR, FIELD_PAT],
      sortField: FIELD_START,
    });

    // normalizzo output per frontend
    const out = records.map((r) => {
      const f = r.fields || {};
      const patientLink = f[FIELD_PAT]; // array recordId
      return {
        id: r.id,
        email: (f[FIELD_EMAIL] || "").toLowerCase(),
        start: f[FIELD_START] || "",
        end: f[FIELD_END] || "",
        durata: f[FIELD_DUR] ?? "",
        patientId: Array.isArray(patientLink) && patientLink.length ? patientLink[0] : "",
      };
    });

    return res.status(200).json({ records: out });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || "Server error" });
  }
}
