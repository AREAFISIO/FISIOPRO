import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";

function enc(x) {
  return encodeURIComponent(String(x));
}

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    const err = new Error("Missing env vars: " + missing.join(", "));
    err.status = 500;
    throw err;
  }
}

function ymdToRange(dateYMD) {
  const [y, m, d] = dateYMD.split("-").map((x) => parseInt(x, 10));
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

async function airtableList({ table, filterByFormula, fields = [], sortField, sortDir = "asc", pageSize = 100 }) {
  const params = new URLSearchParams();
  if (filterByFormula) params.set("filterByFormula", filterByFormula);
  if (sortField) {
    params.append("sort[0][field]", sortField);
    params.append("sort[0][direction]", sortDir);
  }
  for (const f of fields) params.append("fields[]", f);
  params.set("pageSize", String(pageSize));

  const baseUrl = `${enc(table)}?${params.toString()}`;
  let out = [];
  let offset = null;

  while (true) {
    const pagePath = offset ? `${baseUrl}&offset=${encodeURIComponent(offset)}` : baseUrl;
    const json = await airtableFetch(pagePath);
    out = out.concat(json.records || []);
    if (!json.offset) break;
    offset = json.offset;
  }

  return out;
}

async function physioCanAccessPatient({ patientId, email }) {
  // Must have at least one appointment linked to that patient AND assigned to that physio email.
  const safeId = String(patientId).replace(/"/g, '\\"');
  const safeEmail = String(email).replace(/"/g, '\\"');
  const formula = `AND(FIND("${safeId}", ARRAYJOIN({Paziente})), LOWER({Email}) = LOWER("${safeEmail}"))`;

  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
    pageSize: "1",
  });

  const data = await airtableFetch(`${enc("APPUNTAMENTI")}?${qs.toString()}`);
  return Boolean(data?.records?.length);
}

function mapPatient(rec) {
  const f = rec?.fields || {};
  return {
    id: rec.id,
    Nome: f["Nome"] || "",
    Cognome: f["Cognome"] || "",
    Telefono: f["Telefono"] || "",
    Email: f["Email"] || "",
    "Data di nascita": f["Data di nascita"] || "",
  };
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });

    requireEnv("AIRTABLE_TOKEN", "AIRTABLE_BASE_ID");

    const date = String(req.query?.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: "date must be YYYY-MM-DD" });
    }

    const role = normalizeRole(session.role || "");
    const email = String(session.email || "").toLowerCase();
    const { startISO, endISO } = ymdToRange(date);
    const [, mm, dd] = date.split("-");
    const ddmm = `${dd}/${mm}`; // for string DOB formats

    // ===== Appointments (today) =====
    const FIELD_EMAIL = "Email";
    const FIELD_START = "Data e ora INIZIO";
    const FIELD_END = "Data e ora FINE";
    const FIELD_DUR = "Durata";
    const FIELD_PAT = "Paziente";

    const dateFilter = `AND(
      OR(IS_AFTER({${FIELD_START}}, "${startISO}"), IS_SAME({${FIELD_START}}, "${startISO}")),
      IS_BEFORE({${FIELD_START}}, "${endISO}")
    )`;

    const roleFilter =
      role === "physio" ? `{${FIELD_EMAIL}} = "${email}"` : "TRUE()";

    const apptFormula = `AND(${dateFilter}, ${roleFilter})`;

    const apptRecords = await airtableList({
      table: "APPUNTAMENTI",
      filterByFormula: apptFormula,
      fields: [FIELD_EMAIL, FIELD_START, FIELD_END, FIELD_DUR, FIELD_PAT],
      sortField: FIELD_START,
      sortDir: "asc",
    });

    const appts = apptRecords.map((r) => {
      const f = r.fields || {};
      const patientLink = f[FIELD_PAT];
      return {
        id: r.id,
        email: (f[FIELD_EMAIL] || "").toLowerCase(),
        start: f[FIELD_START] || "",
        end: f[FIELD_END] || "",
        durata: f[FIELD_DUR] ?? "",
        patientId: Array.isArray(patientLink) && patientLink.length ? patientLink[0] : "",
      };
    });

    // ===== Patient map for today's appointments =====
    const patientIds = Array.from(new Set(appts.map((a) => a.patientId).filter(Boolean)));
    const patientById = {};

    for (let i = 0; i < patientIds.length; i += 50) {
      const chunk = patientIds.slice(i, i + 50);
      const orParts = chunk.map((id) => `RECORD_ID()="${String(id).replace(/"/g, '\\"')}"`);
      const formula = `OR(${orParts.join(",")})`;
      const recs = await airtableList({
        table: "ANAGRAFICA",
        filterByFormula: formula,
        fields: ["Nome", "Cognome", "Telefono", "Email", "Data di nascita"],
        pageSize: 50,
      });
      for (const r of recs) patientById[r.id] = mapPatient(r);
    }

    const appointments = appts.map((a) => ({
      ...a,
      patient: a.patientId ? (patientById[a.patientId] || { id: a.patientId }) : null,
    }));

    // ===== Birthdays (today) =====
    // Support both Airtable Date field and string "DD/MM/YYYY" formats.
    const dobFormula = `AND(
      {Data di nascita} != "",
      OR(
        DATETIME_FORMAT({Data di nascita}, "DD/MM") = "${ddmm}",
        LEFT({Data di nascita}, 5) = "${ddmm}"
      )
    )`;

    const birthdayRecords = await airtableList({
      table: "ANAGRAFICA",
      filterByFormula: dobFormula,
      fields: ["Nome", "Cognome", "Telefono", "Email", "Data di nascita"],
      sortField: "Cognome",
      sortDir: "asc",
      pageSize: 100,
    });

    let birthdays = birthdayRecords.map(mapPatient);
    if (role === "physio") {
      const filtered = [];
      for (const p of birthdays) {
        const ok = await physioCanAccessPatient({ patientId: p.id, email });
        if (ok) filtered.push(p);
      }
      birthdays = filtered;
    }

    birthdays.sort((a, b) => {
      const ak = `${a.Cognome || ""} ${a.Nome || ""}`.trim().toLowerCase();
      const bk = `${b.Cognome || ""} ${b.Nome || ""}`.trim().toLowerCase();
      return ak.localeCompare(bk, "it");
    });

    return res.status(200).json({
      ok: true,
      date,
      appointments,
      birthdays,
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "Server error" });
  }
}

