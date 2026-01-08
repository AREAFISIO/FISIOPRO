import { airtableFetch, requireRoles } from "./_auth.js";

const CASES_TABLE = process.env.CASES_TABLE || "CASI CLINICI";
const PATIENT_LINK_FIELD = process.env.CASES_PATIENT_FIELD || "Paziente";

function filterByPatientRecordId(patientRecordId) {
  const rid = String(patientRecordId).replace(/"/g, '\\"');
  return `FIND("${rid}", ARRAYJOIN({${PATIENT_LINK_FIELD}}))`;
}

export default async function handler(req, res) {
  const user = requireRoles(req, res, ["physio", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const patientId = req.query?.patientId;
    if (!patientId) return res.status(400).json({ error: "patientId is required" });

    const table = encodeURIComponent(CASES_TABLE);
    const qs = new URLSearchParams({
      filterByFormula: filterByPatientRecordId(patientId),
      pageSize: "50",
    });
    qs.append("sort[0][field]", "Data");
    qs.append("sort[0][direction]", "desc");

    const data = await airtableFetch(`${table}?${qs.toString()}`);

    const items = (data.records || []).map(r => {
      const f = r.fields || {};
      return {
        id: r.id,
        data: f.Data || f["Data apertura"] || "",
        titolo: f.Titolo || f["Titolo caso"] || "",
        stato: f.Stato || f["Stato caso"] || "",
        note: f.Note || f["Note cliniche"] || "",
      };
    });

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
