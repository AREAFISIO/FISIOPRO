import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc, filterByLinkedRecordId } from "./_common.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

// VALUTAZIONI (cliniche)
export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const tableName = process.env.AIRTABLE_VALUTAZIONI_TABLE || "VALUTAZIONI";
    const patientField = process.env.AIRTABLE_VALUTAZIONI_PATIENT_FIELD || "Paziente";

    const patientId = String(req.query?.patientId || "").trim();
    const maxRecords = Math.min(Number(req.query?.maxRecords || 50) || 50, 200);

    if (isSupabaseEnabled() && patientId) {
      const sb = getSupabaseAdmin();
      const { data: p, error: pErr } = await sb.from("patients").select("id").eq("airtable_id", patientId).maybeSingle();
      if (pErr) return res.status(500).json({ ok: false, error: `supabase_patient_lookup_failed: ${pErr.message}` });
      if (!p?.id) return res.status(200).json({ ok: true, items: [], offset: null });

      const { data: rows, error } = await sb
        .from("evaluations")
        .select("airtable_id,evaluated_at,evaluation_type,airtable_fields")
        .eq("patient_id", p.id)
        .order("evaluated_at", { ascending: false })
        .limit(maxRecords);
      if (error) return res.status(500).json({ ok: false, error: `supabase_evaluations_failed: ${error.message}` });

      const items = (rows || []).map((r) => {
        const f = (r.airtable_fields && typeof r.airtable_fields === "object") ? r.airtable_fields : {};
        return {
          id: String(r.airtable_id || ""),
          patientId,
          data: f["Data valutazione"] || f.Data || (r.evaluated_at ? String(r.evaluated_at) : ""),
          tipo: f["Tipo valutazione"] || f.Tipo || (r.evaluation_type || ""),
          fisioterapista: f.Fisioterapista || f.Operatore || "",
          note: f["Note cliniche"] || f.Note || "",
          _fields: f,
        };
      });

      return res.status(200).json({ ok: true, items, offset: null });
    }

    const qs = new URLSearchParams({ pageSize: String(Math.min(maxRecords, 100)) });
    if (patientId) {
      const formula = filterByLinkedRecordId({ linkField: patientField, recordId: patientId });
      if (formula) qs.set("filterByFormula", formula);
    }

    // Best-effort sort by date; if field doesn't exist Airtable returns error.
    // We avoid specifying sort to be resilient across bases.
    qs.set("maxRecords", String(maxRecords));

    const tableEnc = enc(tableName);
    const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);

    const items = (data.records || []).map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        patientId: Array.isArray(f[patientField]) && f[patientField].length ? f[patientField][0] : "",
        data: f["Data valutazione"] || f.Data || "",
        tipo: f["Tipo valutazione"] || f.Tipo || "",
        fisioterapista: f.Fisioterapista || f.Operatore || "",
        note: f["Note cliniche"] || f.Note || "",
        _fields: f,
      };
    });

    return res.status(200).json({ ok: true, items, offset: data.offset || null });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}
