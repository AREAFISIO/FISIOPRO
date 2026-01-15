import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { asLinkArray, enc, norm, readJsonBody, filterByLinkedRecordId } from "./_common.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "back", "manager", "physio"]);
  if (!user) return;

  try {
    const tableName = process.env.AIRTABLE_ANAMNESI_TABLE || "ANAMNESI E CONSENSO";
    const fieldPatient = process.env.AIRTABLE_ANAMNESI_PATIENT_FIELD || "Paziente";
    const fieldConsent = process.env.AIRTABLE_ANAMNESI_CONSENT_FIELD || "Consenso informato";
    const fieldConsentDate = process.env.AIRTABLE_ANAMNESI_CONSENT_DATE_FIELD || "Data consenso";
    const fieldRemote = process.env.AIRTABLE_ANAMNESI_REMOTA_FIELD || "Anamnesi remota";
    const fieldRecent = process.env.AIRTABLE_ANAMNESI_RECENTE_FIELD || "Anamnesi recente";
    const fieldAllergies = process.env.AIRTABLE_ANAMNESI_ALLERGIE_FIELD || "Allergie";
    const fieldDrugs = process.env.AIRTABLE_ANAMNESI_FARMACI_FIELD || "Farmaci";
    const fieldNotes = process.env.AIRTABLE_ANAMNESI_NOTE_FIELD || "Note";

    const tableEnc = enc(tableName);

    if (req.method === "GET") {
      const patientId = norm(req.query?.patientId);
      const maxRecords = Math.min(Number(req.query?.maxRecords || 50) || 50, 200);
      const qs = new URLSearchParams({ pageSize: "100", maxRecords: String(maxRecords) });

      // Supabase fast-path (read-only GET).
      if (isSupabaseEnabled()) {
        const sb = getSupabaseAdmin();
        if (!patientId) return res.status(200).json({ ok: true, items: [], offset: null });

        // This table isn't normalized yet: read from airtable_raw_records.
        // In your base the patient link is often "LINK TO ANAGRAFICA" (array of rec...).
        const { data: rows, error } = await sb
          .from("airtable_raw_records")
          .select("airtable_id,fields")
          .eq("table_name", tableName)
          .limit(2000);
        if (error) return res.status(500).json({ ok: false, error: `supabase_anamnesi_raw_failed: ${error.message}` });

        const pid = String(patientId);
        const items = (rows || [])
          .map((r) => {
            const f = (r.fields && typeof r.fields === "object") ? r.fields : {};
            const links = f["LINK TO ANAGRAFICA"] || f[fieldPatient] || f.Paziente || [];
            const asArr = Array.isArray(links) ? links : typeof links === "string" ? [links] : [];
            const match = asArr.some((x) => String(x || "").trim() === pid);
            if (!match) return null;
            return {
              id: String(r.airtable_id || ""),
              patientId: pid,
              consenso: Boolean(f[fieldConsent] ?? f["CONSENSO INFORMATO"] ?? f["Consenso informato"] ?? false),
              dataConsenso: f[fieldConsentDate] || f["DATA "] || f.Data || "",
              anamnesiRemota: f[fieldRemote] || f["ANAMNESI"] || "",
              anamnesiRecente: f[fieldRecent] || "",
              farmaci: f[fieldDrugs] || "",
              allergie: f[fieldAllergies] || "",
              note: f[fieldNotes] || f.Note || "",
              _fields: f,
            };
          })
          .filter(Boolean)
          .slice(0, maxRecords);

        return res.status(200).json({ ok: true, items, offset: null });
      }

      if (patientId) {
        const formula = filterByLinkedRecordId({ linkField: fieldPatient, recordId: patientId });
        if (formula) qs.set("filterByFormula", formula);
      }

      const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
      const items = (data.records || []).map((r) => {
        const f = r.fields || {};
        const pat = f[fieldPatient];
        return {
          id: r.id,
          patientId: Array.isArray(pat) && pat.length ? pat[0] : "",
          consenso: Boolean(f[fieldConsent]),
          dataConsenso: f[fieldConsentDate] || "",
          anamnesiRemota: f[fieldRemote] || "",
          anamnesiRecente: f[fieldRecent] || "",
          farmaci: f[fieldDrugs] || "",
          allergie: f[fieldAllergies] || "",
          note: f[fieldNotes] || "",
          _fields: f,
        };
      });

      return res.status(200).json({ ok: true, items, offset: data.offset || null });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const patientId = norm(body.patientId || body.pazienteId || body.Paziente);
      if (!patientId) return res.status(400).json({ ok: false, error: "missing_patient" });

      const fields = {};
      fields[fieldPatient] = asLinkArray(patientId);

      if (body.consenso !== undefined) fields[fieldConsent] = Boolean(body.consenso);
      if (body.dataConsenso) fields[fieldConsentDate] = norm(body.dataConsenso);
      if (body.anamnesiRemota) fields[fieldRemote] = body.anamnesiRemota;
      if (body.anamnesiRecente) fields[fieldRecent] = body.anamnesiRecente;
      if (body.farmaci) fields[fieldDrugs] = body.farmaci;
      if (body.allergie) fields[fieldAllergies] = body.allergie;
      if (body.note) fields[fieldNotes] = norm(body.note);

      const created = await airtableFetch(`${tableEnc}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });

      return res.status(200).json({ ok: true, id: created?.id, fields: created?.fields || {} });
    }

    if (req.method === "PATCH") {
      const id = norm(req.query?.id);
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });

      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const fields = {};
      if (body.consenso !== undefined) fields[fieldConsent] = Boolean(body.consenso);
      if (body.dataConsenso !== undefined) fields[fieldConsentDate] = norm(body.dataConsenso);
      if (body.anamnesiRemota !== undefined) fields[fieldRemote] = body.anamnesiRemota;
      if (body.anamnesiRecente !== undefined) fields[fieldRecent] = body.anamnesiRecente;
      if (body.farmaci !== undefined) fields[fieldDrugs] = body.farmaci;
      if (body.allergie !== undefined) fields[fieldAllergies] = body.allergie;
      if (body.note !== undefined) fields[fieldNotes] = norm(body.note);

      const updated = await airtableFetch(`${tableEnc}/${enc(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });

      return res.status(200).json({ ok: true, id: updated?.id, fields: updated?.fields || {} });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

