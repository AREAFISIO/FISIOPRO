import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { memGet, memSet } from "./_common.js";

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function asLinkArray(id) {
  const s = norm(id);
  if (!s) return null;
  return [s];
}

function parseAirtableFieldNameFromError(msg) {
  const m = String(msg || "").match(/Field\s+"([^"]+)"/i);
  return m ? String(m[1] || "").trim() : "";
}

function isComputedFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("field is computed") || s.includes("computed field");
}

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

function ymdFromIso(iso) {
  const s = norm(iso);
  return s ? s.slice(0, 10) : "";
}
function hmFromIso(iso) {
  const s = norm(iso);
  return s ? s.slice(11, 16) : "";
}

async function tryCreate({ tableName, fields }) {
  const table = encodeURIComponent(tableName);
  const created = await airtableFetch(`${table}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  return created;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const body = await readJsonBody(req);
    if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

    const tableName = process.env.AGENDA_TABLE || "APPUNTAMENTI";

    // NOTE:
    // Many Airtable bases have "Data e ora INIZIO/FINE" as computed formula fields.
    // We must write to editable fields. We auto-fallback by trying common candidates and
    // caching the first working schema in warm instances.
    const startCandidates = [
      process.env.AGENDA_START_FIELD,
      "Data e ora INIZIO",
      "Data e ora Inizio",
      "Inizio",
      "Start",
      "Start at",
      "Inizio appuntamento",
      "DataOra Inizio",
      "Data e ora INIZIO (manuale)",
      "Data e ora Inizio (manuale)",
    ].filter(Boolean);
    const endCandidates = [
      process.env.AGENDA_END_FIELD,
      "Data e ora FINE",
      "Data e ora Fine",
      "Fine",
      "End",
      "End at",
      "Fine appuntamento",
      "DataOra Fine",
      "Data e ora FINE (manuale)",
      "Data e ora Fine (manuale)",
    ].filter(Boolean);

    // Split date/time fallback (common when datetime is computed)
    const startDateCandidates = [
      process.env.AGENDA_START_DATE_FIELD,
      "Data INIZIO",
      "Data Inizio",
      "Data",
      "Giorno",
      "Data appuntamento",
    ].filter(Boolean);
    const startTimeCandidates = [
      process.env.AGENDA_START_TIME_FIELD,
      "Ora INIZIO",
      "Ora Inizio",
      "Ora",
      "Orario INIZIO",
      "Orario Inizio",
    ].filter(Boolean);
    const endDateCandidates = [
      process.env.AGENDA_END_DATE_FIELD,
      "Data FINE",
      "Data Fine",
    ].filter(Boolean);
    const endTimeCandidates = [
      process.env.AGENDA_END_TIME_FIELD,
      "Ora FINE",
      "Ora Fine",
      "Orario FINE",
      "Orario Fine",
    ].filter(Boolean);
    const FIELD_OPERATOR = process.env.AGENDA_OPERATOR_FIELD || "Collaboratore";
    const FIELD_PATIENT = process.env.AGENDA_PATIENT_FIELD || "Paziente";
    const FIELD_SERVICE = process.env.AGENDA_SERVICE_FIELD || "Prestazione";
    const FIELD_LOCATION = process.env.AGENDA_LOCATION_FIELD || "Sede";
    const FIELD_TYPE = process.env.AGENDA_TYPE_FIELD || "Tipologia";
    const FIELD_DURATION = process.env.AGENDA_DURATION_FIELD || "Durata";
    const FIELD_INTERNAL = process.env.AGENDA_INTERNAL_NOTES_FIELD || "Note interne";

    const startAt = norm(body.startAt || body.start || body["Data e ora INIZIO"]);
    const endAt = norm(body.endAt || body.end || body["Data e ora FINE"]);
    const therapistId = norm(body.therapistId || body.operatorId || body.collaboratoreId);
    const patientId = norm(body.patientId || body.pazienteId);
    const serviceId = norm(body.serviceId || body.prestazioneId);
    const locationId = norm(body.locationId || body.sedeId);
    const type = norm(body.type || body.tipologia);
    const durationMin = Number(body.durationMin ?? body.durataMin ?? body.durata ?? "");
    const internalNote = norm(body.internalNote || body.noteInterne || body.note);

    if (!startAt || !endAt) {
      return res.status(400).json({ ok: false, error: "missing_datetime" });
    }
    if (!therapistId) {
      return res.status(400).json({ ok: false, error: "missing_operator" });
    }

    const baseFields = {};
    if (!Number.isNaN(durationMin) && durationMin > 0) baseFields[FIELD_DURATION] = durationMin;
    if (type) baseFields[FIELD_TYPE] = type;
    if (internalNote) baseFields[FIELD_INTERNAL] = internalNote;

    // linked records (best effort)
    const opArr = asLinkArray(therapistId);
    if (opArr) baseFields[FIELD_OPERATOR] = opArr;
    const patArr = asLinkArray(patientId);
    if (patArr) baseFields[FIELD_PATIENT] = patArr;
    const servArr = asLinkArray(serviceId);
    if (servArr) baseFields[FIELD_SERVICE] = servArr;
    const locArr = asLinkArray(locationId);
    if (locArr) baseFields[FIELD_LOCATION] = locArr;

    const schemaKey = `apptCreate:schema:${tableName}`;
    const cached = memGet(schemaKey);

    const attemptDatetime = async (FIELD_START, FIELD_END) => {
      const fields = { ...baseFields };
      fields[FIELD_START] = startAt;
      fields[FIELD_END] = endAt;
      return await tryCreate({ tableName, fields });
    };

    const attemptSplit = async ({ FIELD_SD, FIELD_ST, FIELD_ED, FIELD_ET }) => {
      const fields = { ...baseFields };
      const sd = ymdFromIso(startAt);
      const st = hmFromIso(startAt);
      const ed = ymdFromIso(endAt);
      const et = hmFromIso(endAt);
      if (FIELD_SD) fields[FIELD_SD] = sd;
      if (FIELD_ST) fields[FIELD_ST] = st;
      if (FIELD_ED) fields[FIELD_ED] = ed;
      if (FIELD_ET) fields[FIELD_ET] = et;
      return await tryCreate({ tableName, fields });
    };

    // 1) Use cached schema if available
    if (cached?.mode === "datetime" && cached.FIELD_START && cached.FIELD_END) {
      try {
        const created = await attemptDatetime(cached.FIELD_START, cached.FIELD_END);
        return res.status(200).json({ ok: true, id: created?.id, fields: created?.fields || {} });
      } catch {
        // fallthrough to re-discovery
      }
    }
    if (cached?.mode === "split" && cached.FIELD_SD && cached.FIELD_ST && cached.FIELD_ED && cached.FIELD_ET) {
      try {
        const created = await attemptSplit(cached);
        return res.status(200).json({ ok: true, id: created?.id, fields: created?.fields || {} });
      } catch {
        // fallthrough to re-discovery
      }
    }

    // 2) Try datetime candidates, adjusting on computed/unknown errors.
    let si = 0;
    let ei = 0;
    let lastErr = null;
    while (si < startCandidates.length && ei < endCandidates.length) {
      const FIELD_START = startCandidates[si];
      const FIELD_END = endCandidates[ei];
      try {
        const created = await attemptDatetime(FIELD_START, FIELD_END);
        memSet(schemaKey, { mode: "datetime", FIELD_START, FIELD_END }, 60 * 60_000);
        return res.status(200).json({ ok: true, id: created?.id, fields: created?.fields || {} });
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || "");
        const fieldName = parseAirtableFieldNameFromError(msg);
        if (fieldName && fieldName === FIELD_START && (isComputedFieldError(msg) || isUnknownFieldError(msg))) {
          si += 1;
          continue;
        }
        if (fieldName && fieldName === FIELD_END && (isComputedFieldError(msg) || isUnknownFieldError(msg))) {
          ei += 1;
          continue;
        }
        // If message doesn't identify which field, but it is an "unknown field" error, advance both.
        if (!fieldName && isUnknownFieldError(msg)) {
          si += 1;
          ei += 1;
          continue;
        }
        // Any other error: surface it
        throw e;
      }
    }

    // 3) Try split date/time fields (common when datetime is computed)
    for (const FIELD_SD of startDateCandidates) {
      for (const FIELD_ST of startTimeCandidates) {
        for (const FIELD_ED of endDateCandidates) {
          for (const FIELD_ET of endTimeCandidates) {
            try {
              const created = await attemptSplit({ FIELD_SD, FIELD_ST, FIELD_ED, FIELD_ET });
              memSet(schemaKey, { mode: "split", FIELD_SD, FIELD_ST, FIELD_ED, FIELD_ET }, 60 * 60_000);
              return res.status(200).json({ ok: true, id: created?.id, fields: created?.fields || {} });
            } catch (e) {
              lastErr = e;
              const msg = String(e?.message || "");
              // Try next combo only on computed/unknown field errors, otherwise bubble up.
              if (isComputedFieldError(msg) || isUnknownFieldError(msg)) continue;
              throw e;
            }
          }
        }
      }
    }

    return res.status(500).json({
      ok: false,
      error: "agenda_schema_mismatch",
      details: {
        table: tableName,
        tried: {
          startCandidates,
          endCandidates,
          startDateCandidates,
          startTimeCandidates,
          endDateCandidates,
          endTimeCandidates,
        },
        lastError: String(lastErr?.message || "unknown"),
      },
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

