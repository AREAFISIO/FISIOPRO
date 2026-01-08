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
  const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r|\n/g, " ").trim();
  return `{${f}}="${esc}"`;
}

async function loadRiepilogo({ clinicaId } = {}) {
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

  if (!FIELD_MESE || !FIELD_SCOST) {
    const err = new Error("riepilogo_annuale_schema_mismatch");
    err.status = 500;
    err.details = { meseFieldResolved: Boolean(FIELD_MESE), scostamentoFieldResolved: Boolean(FIELD_SCOST) };
    throw err;
  }

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
      budget: asNumber(FIELD_BUDGET ? f[FIELD_BUDGET] : null) ?? 0,
      reale: asNumber(FIELD_REALE ? f[FIELD_REALE] : null) ?? 0,
      scostamento: asNumber(f[FIELD_SCOST]) ?? 0,
    };
  });
}

// /api/check-budget
// Individua mesi critici con Scostamento > 0.
// Predispone struttura notifiche (email/slack) SENZA implementazione.
export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  setPrivateCache(res, 30);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const clinica = String(req.query?.clinica || "").trim();
    const items = await loadRiepilogo({ clinicaId: clinica });

    const critici = items
      .filter((x) => Number(x.scostamento || 0) > 0)
      .map((x) => ({ mese: x.mese, scostamento: x.scostamento, budget: x.budget, reale: x.reale }))
      .sort((a, b) => Number(b.scostamento || 0) - Number(a.scostamento || 0));

    return res.status(200).json({
      ok: true,
      mesiCritici: critici,
      // FUTURO: integrare invio notifiche (senza breaking change)
      notifications: {
        email: {
          enabled: false,
          to: [],
          // templateId: "budget_alert_v1",
        },
        slack: {
          enabled: false,
          webhookConfigured: Boolean(process.env.SLACK_WEBHOOK_URL),
          // webhookUrl: process.env.SLACK_WEBHOOK_URL, // non esporre in chiaro
        },
      },
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error", details: e.details || null });
  }
}

