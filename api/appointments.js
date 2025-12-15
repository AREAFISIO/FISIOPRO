import { airtableFetch, requireRoles } from "./_auth.js";

const APPOINTMENTS_TABLE = process.env.APPOINTMENTS_TABLE || "APPUNTAMENTI";
const PATIENT_LINK_FIELD = process.env.APPOINTMENTS_PATIENT_FIELD || "Paziente"; // campo link al paziente

function filterByPatientRecordId(patientRecordId) {
  const rid = String(patientRecordId).replace(/"/g, '\\"');
  // match su linked record id: FIND("recXXXX", ARRAYJOIN({Paziente}))
  return `FIND("${rid}", ARRAYJOIN({${PATIENT_LINK_FIELD}}))`;
}

export default async function handler(req, res) {
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const patientId = req.query?.patientId;
    if (!patientId) return res.status(400).json({ error: "patientId is required" });

    const table = encodeURIComponent(APPOINTMENTS_TABLE);
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
        data: f.Data || f["Data e ora"] || "",
        durata: f.Durata || "",
        prestazione: f.Prestazione || f["Voce prezzario"] || "",
        note: f.Note || f["Note interne"] || "",
        operatore: f.Operatore || f.Incaricato || "",
      };
    });

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
