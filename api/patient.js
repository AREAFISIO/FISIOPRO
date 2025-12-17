import { airtableFetch, normalizeRole, requireSession } from "./_auth.js";

function enc(x) {
  return encodeURIComponent(String(x));
}

async function physioCanAccessPatient({ patientId, email }) {
  // Must have at least one appointment linked to that patient AND assigned to that physio email.
  const formula = `AND(FIND("${String(patientId).replace(/"/g, '\\"')}", ARRAYJOIN({Paziente})), LOWER({Email}) = LOWER("${String(email).replace(/"/g, '\\"')}"))`;
  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
    pageSize: "1",
  });

  const table = enc("APPUNTAMENTI");
  const data = await airtableFetch(`${table}?${qs.toString()}`);
  return Boolean(data?.records?.length);
}

export default async function handler(req, res) {
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const patientId = req.query?.id;
    if (!patientId) return res.status(400).json({ error: "Missing id" });

    const role = normalizeRole(session.role);
    if (role === "physio") {
      const ok = await physioCanAccessPatient({ patientId, email: session.email });
      if (!ok) return res.status(403).json({ error: "Forbidden" });
    }

    const table = enc("ANAGRAFICA");
    const record = await airtableFetch(`${table}/${enc(patientId)}`);

    const f = record.fields || {};
    return res.status(200).json({
      id: record.id,
      Nome: f["Nome"] || "",
      Cognome: f["Cognome"] || "",
      Telefono: f["Telefono"] || "",
      Email: f["Email"] || "",
      "Data di nascita": f["Data di nascita"] || "",
      Note: f["Note"] || "",
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || "Server error" });
  }
}

