import { airtableFetch, requireRoles } from "./_auth.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

const SALES_TABLE = process.env.SALES_TABLE || "VENDITE";
const PATIENT_LINK_FIELD = process.env.SALES_PATIENT_FIELD || "Paziente";

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

      const { data: p, error: pErr } = await sb.from("patients").select("id").eq("airtable_id", pid).maybeSingle();
      if (pErr) return res.status(500).json({ error: `supabase_patient_lookup_failed: ${pErr.message}` });
      if (!p?.id) return res.status(200).json({ items: [] });

      const { data: rows, error } = await sb
        .from("sales")
        .select("airtable_id,sold_at,sold_date,price_total,airtable_fields")
        .eq("patient_id", p.id)
        .order("sold_at", { ascending: false })
        .order("sold_date", { ascending: false })
        .limit(200);
      if (error) return res.status(500).json({ error: `supabase_sales_failed: ${error.message}` });

      const items = (rows || []).map((r) => {
        const f = (r.airtable_fields && typeof r.airtable_fields === "object") ? r.airtable_fields : {};
        return {
          id: String(r.airtable_id || ""),
          data: f["Data vendita"] || f.Data || (r.sold_at ? new Date(r.sold_at).toISOString() : (r.sold_date ? String(r.sold_date) : "")),
          voce: f.Voce || f["Voce prezzario"] || f.Prodotto || f["LINK TO PRESTAZIONI"] || "",
          importo: f.Importo || f.Totale || f["Prezzo totale"] || (r.price_total ?? ""),
          note: f.Note || "",
        };
      });

      return res.status(200).json({ items });
    }

    const table = encodeURIComponent(SALES_TABLE);
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
        data: f.Data || f["Data vendita"] || "",
        voce: f.Voce || f["Voce prezzario"] || f.Prodotto || "",
        importo: f.Importo || f.Totale || "",
        note: f.Note || "",
      };
    });

    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
