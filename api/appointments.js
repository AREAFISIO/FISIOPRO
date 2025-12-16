import { requireSession } from "./_auth.js";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_APPOINTMENTS_TABLE = "APPUNTAMENTI",
  APPOINTMENTS_FISIO_EMAIL_FIELD = "Email",
  APPOINTMENTS_START_FIELD = "Data e ora INIZIO",
  APPOINTMENTS_END_FIELD = "Data e ora FINE",
  APPOINTMENTS_DURATION_FIELD = "Durata",
  APPOINTMENTS_PATIENT_FIELD = "Paziente",
} = process.env;

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function isoDayStart(dateStr) {
  return `${dateStr}T00:00:00.000Z`;
}
function isoDayEnd(dateStr) {
  return `${dateStr}T23:59:59.999Z`;
}

export default async function handler(req, res) {
  const session = requireSession(req);
  if (!session) return send(res, 401, { ok: false, error: "unauthorized" });

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return send(res, 500, { ok: false, error: "missing_env_airtable" });
  }

  try {
    const role = String(session.role || "");
    const email = String(session.email || "").trim().toLowerCase();

    const urlObj = new URL(req.url, `https://${req.headers.host}`);
    const from = urlObj.searchParams.get("from");
    const to = urlObj.searchParams.get("to");
    const limit = Math.min(parseInt(urlObj.searchParams.get("limit") || "200", 10), 500);

    const clauses = [];

    // RBAC: Fisioterapista vede solo i suoi
    if (role === "Fisioterapista") {
      clauses.push(`LOWER({${APPOINTMENTS_FISIO_EMAIL_FIELD}}) = "${email}"`);
    }

    // filtro date sulla DATA INIZIO
    if (from) clauses.push(`IS_AFTER({${APPOINTMENTS_START_FIELD}}, "${isoDayStart(from)}")`);
    if (to) clauses.push(`IS_BEFORE({${APPOINTMENTS_START_FIELD}}, "${isoDayEnd(to)}")`);

    const filterFormula = clauses.length ? `AND(${clauses.join(",")})` : "";

    const table = encodeURIComponent(AIRTABLE_APPOINTMENTS_TABLE);
    const filterParam = filterFormula ? `&filterByFormula=${encodeURIComponent(filterFormula)}` : "";

    const apiUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}` +
      `?pageSize=${limit}` +
      `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent(APPOINTMENTS_START_FIELD)}` +
      `&sort%5B0%5D%5Bdirection%5D=asc` +
      filterParam;

    const r = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });

    if (!r.ok) {
      const t = await r.text();
      return send(res, 500, { ok: false, error: "airtable_error", detail: t });
    }

    const data = await r.json();

    const records = (data.records || []).map((rec) => {
      const f = rec.fields || {};
      const patientVal = f[APPOINTMENTS_PATIENT_FIELD];
      const patientIds = Array.isArray(patientVal) ? patientVal : (patientVal ? [patientVal] : []);

      return {
        id: rec.id,
        email: f[APPOINTMENTS_FISIO_EMAIL_FIELD] || null,
        start: f[APPOINTMENTS_START_FIELD] || null,
        end: f[APPOINTMENTS_END_FIELD] || null,
        durata: f[APPOINTMENTS_DURATION_FIELD] || null,
        patientIds,
        fields: f,
      };
    });

    return send(res, 200, { ok: true, role, email, records });
  } catch (e) {
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
