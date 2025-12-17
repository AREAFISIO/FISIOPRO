// api/appointments.js
import { normalizeRole, requireSession } from "./_auth.js";

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

export default async function handler(req, res) {
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    requireEnv("AIRTABLE_TOKEN", "AIRTABLE_BASE_ID");

    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;

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
