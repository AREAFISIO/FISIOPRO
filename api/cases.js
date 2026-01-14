import { airtableFetch, requireRoles } from "./_auth.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

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

    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();
      const pid = String(patientId || "").trim();

      const { data: p, error: pErr } = await sb.from("patients").select("id").eq("airtable_id", pid).maybeSingle();
      if (pErr) return res.status(500).json({ error: `supabase_patient_lookup_failed: ${pErr.message}` });
      if (!p?.id) return res.status(200).json({ items: [] });

      const { data: rows, error } = await sb
        .from("cases")
        .select("airtable_id,opened_on,status,airtable_fields")
        .eq("patient_id", p.id)
        .order("opened_on", { ascending: false })
        .limit(200);
      if (error) return res.status(500).json({ error: `supabase_cases_failed: ${error.message}` });

      const items = (rows || []).map((r) => {
        const f = (r.airtable_fields && typeof r.airtable_fields === "object") ? r.airtable_fields : {};
        return {
          id: String(r.airtable_id || ""),
          data: f["Data apertura"] || f.Data || (r.opened_on ? String(r.opened_on) : ""),
          titolo: f["CASO CLINICO"] || f["Titolo caso"] || f.Titolo || f["ID caso clinico"] || "",
          stato: f["Stato caso"] || f.Stato || String(r.status || ""),
          note: f["Note cliniche"] || f["Note caso"] || f.Note || "",
        };
      });

      return res.status(200).json({ items });
    }

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
