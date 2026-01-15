import { airtableFetch, requireRoles } from "./_auth.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

const INSURANCE_TABLE = process.env.INSURANCE_TABLE || "PRATICHE ASSICURATIVE";
const PATIENT_LINK_FIELD = process.env.INSURANCE_PATIENT_FIELD || "Paziente";

function filterByPatientRecordId(patientRecordId) {
  const rid = String(patientRecordId).replace(/"/g, '\\"');
  return `FIND("${rid}", ARRAYJOIN({${PATIENT_LINK_FIELD}}))`;
}

export default async function handler(req, res) {
  const user = requireRoles(req, res, ["front", "back", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const patientId = req.query?.patientId;
    if (!patientId) return res.status(400).json({ error: "patientId is required" });

    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();
      const pid = String(patientId || "").trim();

      // This table may not be normalized: read from raw records.
      const tableName = String(INSURANCE_TABLE || "").trim();
      const { data: rows, error } = await sb
        .from("airtable_raw_records")
        .select("airtable_id,fields")
        .eq("table_name", tableName)
        .limit(2000);
      if (error) return res.status(500).json({ error: `supabase_insurance_raw_failed: ${error.message}` });

      const items = (rows || [])
        .map((r) => {
          const f = (r.fields && typeof r.fields === "object") ? r.fields : {};
          const links = f[PATIENT_LINK_FIELD] || f.Paziente || [];
          const arr = Array.isArray(links) ? links : typeof links === "string" ? [links] : [];
          const match = arr.some((x) => String(x || "").trim() === pid);
          if (!match) return null;
          return {
            id: String(r.airtable_id || ""),
            data: f.Data || f["Data"] || "",
            pratica: f.Pratica || f["Nome pratica"] || "",
            stato: f.Stato || "",
            note: f.Note || "",
          };
        })
        .filter(Boolean)
        .slice(0, 200);

      return res.status(200).json({ items });
    }

    const table = encodeURIComponent(INSURANCE_TABLE);
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
        data: f.Data || "",
        pratica: f.Pratica || f["Nome pratica"] || "",
        stato: f.Stato || "",
        note: f.Note || "",
      };
    });

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
