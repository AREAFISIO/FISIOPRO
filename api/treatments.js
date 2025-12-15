import { airtableFetch, requireRoles } from "./_auth.js";

const TREATMENTS_TABLE = process.env.TREATMENTS_TABLE || "EROGATO";
const PATIENT_LINK_FIELD = process.env.TREATMENTS_PATIENT_FIELD || "Paziente";

function filterByPatientRecordId(patientRecordId) {
  const rid = String(patientRecordId).replace(/"/g, '\\"');
  return `FIND("${rid}", ARRAYJOIN({${PATIENT_LINK_FIELD}}))`;
}

export default async function handler(req, res) {
  const user = requireRoles(req, res, ["front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const patientId = req.query?.patientId;
    if (!patientId) return res.status(400).json({ error: "patientId is required" });

    const table = encodeURIComponent(TREATMENTS_TABLE);
    const qs = new URLSearchParams({
      filterByFormula: filterByPatientRecordId(patientId),
      sort[0][field]: "Data",
      sort[0][direction]: "desc",
      pageSize: "50",
    });

    const data = await airtableFetch(`${table}?${qs.toString()}`);

    const items = (data.records || []).map(r => {
      const f = r.fields || {};
      return {
        id: r.id,
        data: f.Data || f["Data erogazione"] || "",
        prestazione: f.Prestazione || f["Voce prezzario"] || "",
        stato: f.Stato || f.Esito || "",
        note: f.Note || f["Note interne"] || "",
      };
    });

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
