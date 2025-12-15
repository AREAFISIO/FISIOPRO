import { airtableFetch, requireRoles } from "./_auth.js";

const PATIENTS_TABLE = process.env.PATIENTS_TABLE || "PAZIENTI"; // <-- cambia se serve

// Utility: prova a trovare un campo "PatientId" collegamento
function buildFilterByPatientId(patientId) {
  // filtro soft: se in Airtable hai un campo "ID" o "Id" o "PatientId" puoi adattarlo
  // di default provo con {ID} = "..."
  const pid = String(patientId).replace(/"/g, '\\"');
  return `{ID}="${pid}"`;
}

export default async function handler(req, res) {
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const table = encodeURIComponent(PATIENTS_TABLE);

    // GET /api/patients?id=xxx -> singolo paziente
    if (req.query?.id) {
      const id = req.query.id;

      // 1) Provo read diretto recordId Airtable (se id è recordId)
      // 2) Se fallisce, provo ricerca per campo {ID} (puoi adattare)
      try {
        const rec = await airtableFetch(`${table}/${encodeURIComponent(id)}`);
        const f = rec.fields || {};

        const patient = {
          id: rec.id,
          nome: f.Nome || f.nome || f.FirstName || "",
          cognome: f.Cognome || f.cognome || f.LastName || "",
          nome_completo: f["Nome completo"] || f["Nome"] || "",
          email: f.Email || f.email || "",
          cellulare: f.Cellulare || f.Telefono || f.Phone || "",
          note: f.Note || f.note || "",
        };

        return res.status(200).json({ patient });
      } catch (e) {
        // fallback: search per campo ID
        const qs = new URLSearchParams({
          filterByFormula: buildFilterByPatientId(id),
          maxRecords: "1"
        });
        const data = await airtableFetch(`${table}?${qs.toString()}`);
        const rec = data.records?.[0];
        if (!rec) return res.status(404).json({ error: "Patient not found" });
        const f = rec.fields || {};

        const patient = {
          id: rec.id,
          nome: f.Nome || f.nome || f.FirstName || "",
          cognome: f.Cognome || f.cognome || f.LastName || "",
          nome_completo: f["Nome completo"] || "",
          email: f.Email || f.email || "",
          cellulare: f.Cellulare || f.Telefono || f.Phone || "",
          note: f.Note || f.note || "",
        };
        return res.status(200).json({ patient });
      }
    }

    // GET /api/patients -> lista (minimal)
    const qs = new URLSearchParams({ pageSize: "50" });
    const data = await airtableFetch(`${table}?${qs.toString()}`);

    const items = (data.records || []).map(rec => {
      const f = rec.fields || {};
      return {
        id: rec.id,
        nome: f.Nome || f.nome || "",
        cognome: f.Cognome || f.cognome || "",
        email: f.Email || "",
        cellulare: f.Cellulare || f.Telefono || "",
      };
    });

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
