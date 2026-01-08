import { ensureRes, requireRoles } from "./_auth.js";
import { setPrivateCache } from "./_common.js";
import { airtableListAll, asNumber, asString, inferTableFieldKeys, resolveFieldKeyFromKeys } from "./_airtableClient.js";

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

function buildClinicFilterFormula({ clinicField, clinicaId }) {
  const f = String(clinicField || "").trim() || "Clinica";
  const v = String(clinicaId || "").trim();
  if (!v) return "";
  // NOTE: se il campo non esiste nel base Airtable, il chiamante deve gestire fallback.
  // escape minimal for Airtable string literals
  const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r|\n/g, " ").trim();
  return `{${f}}="${esc}"`;
}

async function listRiepilogo({ clinicaId } = {}) {
  const tableName = process.env.AIRTABLE_RIEPILOGO_ANNUALE_TABLE || "RIEPILOGO_ANNUALE";
  const tableEnc = encodeURIComponent(tableName);

  const keys = await inferTableFieldKeys(tableEnc, `riepilogoAnnuale:keys:${tableName}`);
  const FIELD_MESE = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_RIEPILOGO_MESE_FIELD, "Mese"]);
  const FIELD_BUDGET = resolveFieldKeyFromKeys(keys, [
    process.env.AIRTABLE_RIEPILOGO_TOTALE_MENSILE_FIELD,
    "Totale Mensile (budget)",
    "Totale Mensile",
    "Budget",
  ]);
  const FIELD_REALE = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_RIEPILOGO_TOTALE_REALE_FIELD, "Totale Reale", "Reale"]);
  const FIELD_SCOST = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_RIEPILOGO_SCOSTAMENTO_FIELD, "Scostamento"]);

  if (!FIELD_MESE) {
    const err = new Error("riepilogo_annuale_schema_mismatch");
    err.status = 500;
    err.details = { meseFieldResolved: false };
    throw err;
  }

  // Predisposizione multi-clinica: tenta filtro su campo "Clinica" (fallback se campo non esiste).
  const clinicFormula = buildClinicFilterFormula({ clinicField: process.env.AIRTABLE_CLINICA_FIELD || "Clinica", clinicaId });

  let records;
  try {
    records = await airtableListAll({
      tableName,
      fields: [FIELD_MESE, FIELD_BUDGET, FIELD_REALE, FIELD_SCOST].filter(Boolean),
      filterByFormula: clinicFormula || undefined,
      sort: [{ field: FIELD_MESE, direction: "asc" }],
      pageSize: 100,
      maxRecords: 500,
    });
  } catch (e) {
    // Se il base non ha ancora il campo clinica, non bloccare: restituisci aggregato.
    if (clinicaId && isUnknownFieldError(e?.message)) {
      records = await airtableListAll({
        tableName,
        fields: [FIELD_MESE, FIELD_BUDGET, FIELD_REALE, FIELD_SCOST].filter(Boolean),
        sort: [{ field: FIELD_MESE, direction: "asc" }],
        pageSize: 100,
        maxRecords: 500,
      });
    } else {
      throw e;
    }
  }

  return (records || []).map((r) => {
    const f = r?.fields || {};
    return {
      mese: asString(f[FIELD_MESE]),
      totaleMensile: asNumber(FIELD_BUDGET ? f[FIELD_BUDGET] : null) ?? 0,
      totaleReale: asNumber(FIELD_REALE ? f[FIELD_REALE] : null) ?? 0,
      scostamento: asNumber(FIELD_SCOST ? f[FIELD_SCOST] : null) ?? 0,
    };
  });
}

// /api/riepilogo-mensile
// Output: [{ Mese, Totale Mensile, Totale Reale, Scostamento }]
export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  setPrivateCache(res, 30);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const clinica = String(req.query?.clinica || "").trim();
    const items = await listRiepilogo({ clinicaId: clinica });
    return res.status(200).json(
      items.map((x) => ({
        Mese: x.mese,
        "Totale Mensile": x.totaleMensile,
        "Totale Reale": x.totaleReale,
        Scostamento: x.scostamento,
      })),
    );
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error", details: e.details || null });
  }
}

