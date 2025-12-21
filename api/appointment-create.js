import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";

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

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const body = await readJsonBody(req);
    if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

    const tableName = process.env.AGENDA_TABLE || "APPUNTAMENTI";
    const FIELD_START = process.env.AGENDA_START_FIELD || "Data e ora INIZIO";
    const FIELD_END = process.env.AGENDA_END_FIELD || "Data e ora FINE";
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

    const fields = {};
    fields[FIELD_START] = startAt;
    fields[FIELD_END] = endAt;
    if (!Number.isNaN(durationMin) && durationMin > 0) fields[FIELD_DURATION] = durationMin;
    if (type) fields[FIELD_TYPE] = type;
    if (internalNote) fields[FIELD_INTERNAL] = internalNote;

    // linked records (best effort)
    const opArr = asLinkArray(therapistId);
    if (opArr) fields[FIELD_OPERATOR] = opArr;
    const patArr = asLinkArray(patientId);
    if (patArr) fields[FIELD_PATIENT] = patArr;
    const servArr = asLinkArray(serviceId);
    if (servArr) fields[FIELD_SERVICE] = servArr;
    const locArr = asLinkArray(locationId);
    if (locArr) fields[FIELD_LOCATION] = locArr;

    const table = encodeURIComponent(tableName);
    const created = await airtableFetch(`${table}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });

    return res.status(200).json({ ok: true, id: created?.id, fields: created?.fields || {} });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

