import { airtableFetch, normalizeRole, requireSession } from "./_auth.js";

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function ymdToUtcStartISO(ymd) {
  const [y, m, d] = String(ymd).split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString();
}

function addDaysUtcISO(iso, days) {
  const dt = new Date(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString();
}

export default async function handler(req, res) {
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const from = String(req.query?.from || "").trim();
    const to = String(req.query?.to || "").trim();
    if (!isYmd(from) || !isYmd(to)) {
      return res.status(400).json({ ok: false, error: "from/to must be YYYY-MM-DD" });
    }

    const startISO = ymdToUtcStartISO(from);
    const endExclusiveISO = addDaysUtcISO(ymdToUtcStartISO(to), 1);

    // Airtable datetime range filter (inclusive start, exclusive end)
    const FIELD_START = process.env.AGENDA_START_FIELD || "Data e ora INIZIO";
    const FIELD_EMAIL = process.env.AGENDA_EMAIL_FIELD || "Email";

    const rangeFilter = `AND(
      OR(IS_AFTER({${FIELD_START}}, "${startISO}"), IS_SAME({${FIELD_START}}, "${startISO}")),
      IS_BEFORE({${FIELD_START}}, "${endExclusiveISO}")
    )`;

    const role = normalizeRole(session.role);
    const email = String(session.email || "").toLowerCase();
    const roleFilter = role === "physio" ? `{${FIELD_EMAIL}} = "${email}"` : "TRUE()";

    const qs = new URLSearchParams({
      filterByFormula: `AND(${rangeFilter}, ${roleFilter})`,
      pageSize: "100",
      "sort[0][field]": FIELD_START,
      "sort[0][direction]": "asc",
    });

    const table = encodeURIComponent(process.env.AGENDA_TABLE || "APPUNTAMENTI");
    const data = await airtableFetch(`${table}?${qs.toString()}`);

    const items = (data.records || []).map((r) => {
      const f = r.fields || {};
      const dt = String(f[FIELD_START] || "");
      return {
        id: r.id,
        datetime: dt,
        date: dt ? dt.slice(0, 10) : "",
        time: dt ? dt.slice(11, 16) : "",
        fields: f,
      };
    });

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

