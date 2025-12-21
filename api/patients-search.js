import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";

function enc(x) {
  return encodeURIComponent(String(x));
}

async function airtableList({ table, filterByFormula, fields = [], sortField, sortDir = "asc", pageSize = 50, maxPages = 2 }) {
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
  let pages = 0;

  while (pages < maxPages) {
    const pagePath = offset ? `${baseUrl}&offset=${encodeURIComponent(offset)}` : baseUrl;
    const json = await airtableFetch(pagePath);
    out = out.concat(json.records || []);
    pages += 1;
    if (!json.offset) break;
    offset = json.offset;
  }

  return out;
}

async function physioCanAccessPatient({ patientId, email }) {
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

    const role = normalizeRole(session.role || "");
    const email = String(session.email || "").toLowerCase();

    const q = String(req.query?.q || "").trim();
    if (!q || q.length < 2) return res.status(200).json({ ok: true, records: [] });

    const qSafe = q.replace(/"/g, '\\"').toLowerCase();

    // Search across name/surname/email/phone, allow partial match.
    const formula = `OR(
      FIND("${qSafe}", LOWER({Nome}&" "&{Cognome})),
      FIND("${qSafe}", LOWER({Cognome}&" "&{Nome})),
      FIND("${qSafe}", LOWER({Email})),
      FIND("${qSafe}", LOWER({Telefono}))
    )`;

    const recs = await airtableList({
      table: "ANAGRAFICA",
      filterByFormula: formula,
      fields: ["Nome", "Cognome", "Telefono", "Email", "Data di nascita"],
      sortField: "Cognome",
      sortDir: "asc",
      pageSize: 25,
      maxPages: 2,
    });

    let patients = recs.map(mapPatient);

    // RBAC: physio can only see patients they have appointments with.
    if (role === "physio") {
      const filtered = [];
      for (const p of patients) {
        const ok = await physioCanAccessPatient({ patientId: p.id, email });
        if (ok) filtered.push(p);
      }
      patients = filtered;
    }

    // limit output for UI
    patients = patients.slice(0, 10);

    return res.status(200).json({ ok: true, records: patients });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "Server error" });
  }
}

