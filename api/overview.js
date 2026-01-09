import { ensureRes, requireRoles } from "./_auth.js";
import { escAirtableString, setPrivateCache, enc } from "./_common.js";
import { airtableListAll, asNumber, inferTableFieldKeys, resolveFieldKeyFromKeys } from "./_airtableClient.js";

function monthKeyUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addMonthsUTC(date, deltaMonths) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  d.setUTCMonth(d.getUTCMonth() + Number(deltaMonths || 0));
  return d;
}

function fmtMonthShortIt(key) {
  // key: YYYY-MM
  const m = Number(String(key || "").split("-")[1] || 0);
  const map = ["", "Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  return map[m] || String(key || "");
}

function classifyFixedVariable(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s.includes("fiss")) return "fisse";
  if (s.includes("variab")) return "variabili";
  return "";
}

function buildClinicFilterFormula({ clinicField, clinicaId }) {
  const f = String(clinicField || "").trim() || "Clinica/Centro di costo";
  const v = String(clinicaId || "").trim();
  if (!v) return "";
  const esc = escAirtableString(v);
  return `{${f}}="${esc}"`;
}

function dayIsoUTC(d) {
  // YYYY-MM-DD
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysUTC(date, deltaDays) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  return d;
}

// /api/overview
// CFO snapshot + trend ultimi 6 mesi (Entrate vs Costi).
// Source: MOVIMENTI_BANCA (default) con campi:
// - Data
// - Importo
// - Tipo (Entrata / Uscita / Neutra)
// - Natura Costo (Fissa / Variabile / N/A)
// - Clinica/Centro di costo (opzionale)
export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  setPrivateCache(res, 30);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const clinicaId = String(req.query?.clinica || "").trim();

    // ---- compute date window: last 6 months (including current) ----
    const now = new Date();
    const startMonth = addMonthsUTC(now, -5); // first month in the 6-month window
    const endMonthExclusive = addMonthsUTC(now, 1); // first day of next month (exclusive)

    const monthKeys = [];
    for (let i = 0; i < 6; i++) monthKeys.push(monthKeyUTC(addMonthsUTC(startMonth, i)));

    // ---- Airtable schema (robust) ----
    const tableName = process.env.AIRTABLE_MOVIMENTI_BANCA_TABLE || "MOVIMENTI_BANCA";
    const tableEnc = enc(tableName);
    const keys = await inferTableFieldKeys(tableEnc, `movimentiBanca:keys:${tableName}`);

    const FIELD_DATA = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_MOVIMENTI_BANCA_DATA_FIELD, "Data", "Data movimento"]);
    const FIELD_IMPORTO = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_MOVIMENTI_BANCA_IMPORTO_FIELD, "Importo", "Importo totale"]);
    const FIELD_TIPO = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_MOVIMENTI_BANCA_TIPO_FIELD, "Tipo"]);
    const FIELD_NATURA = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_MOVIMENTI_BANCA_NATURA_FIELD, "Natura Costo", "Natura costo"]);

    if (!FIELD_DATA || !FIELD_IMPORTO || !FIELD_TIPO) {
      return res.status(500).json({
        ok: false,
        error: "movimenti_banca_schema_mismatch",
        details: {
          dataFieldResolved: Boolean(FIELD_DATA),
          importoFieldResolved: Boolean(FIELD_IMPORTO),
          tipoFieldResolved: Boolean(FIELD_TIPO),
        },
      });
    }

    // Airtable date filters:
    // Use IS_AFTER/IS_BEFORE with +/- 1 day for inclusivity.
    const startInclusive = startMonth; // first day of first month
    const endExclusive = endMonthExclusive; // first day of next month
    const startMinus1 = addDaysUTC(startInclusive, -1);
    const endPlus1 = addDaysUTC(endExclusive, 1);

    const dateFormula = `AND(IS_AFTER({${FIELD_DATA}},"${dayIsoUTC(startMinus1)}"),IS_BEFORE({${FIELD_DATA}},"${dayIsoUTC(endPlus1)}"))`;
    const clinicFormula = buildClinicFilterFormula({
      clinicField: process.env.AIRTABLE_CLINICA_FIELD || "Clinica/Centro di costo",
      clinicaId,
    });
    const filterByFormula = [dateFormula, clinicFormula].filter(Boolean).length
      ? `AND(${[dateFormula, clinicFormula].filter(Boolean).join(",")})`
      : dateFormula;

    const records = await airtableListAll({
      tableEnc,
      fields: [FIELD_DATA, FIELD_IMPORTO, FIELD_TIPO, FIELD_NATURA].filter(Boolean),
      filterByFormula,
      pageSize: 100,
      maxRecords: 10_000,
    });

    // ---- aggregate by month ----
    const byMonth = new Map(monthKeys.map((k) => [k, { entrate: 0, costi: 0, costiFissi: 0, costiVariabili: 0 }]));

    for (const r of records || []) {
      const f = r?.fields || {};
      const rawDate = f[FIELD_DATA];
      const d = new Date(String(rawDate || ""));
      if (Number.isNaN(d.getTime())) continue;
      const mk = monthKeyUTC(d);
      if (!byMonth.has(mk)) continue;

      const tipo = String(f[FIELD_TIPO] || "").trim().toLowerCase();
      const amountRaw = asNumber(f[FIELD_IMPORTO]);
      if (!Number.isFinite(amountRaw)) continue;
      const amount = Math.abs(Number(amountRaw));
      if (amount === 0) continue;

      const agg = byMonth.get(mk);
      if (!agg) continue;

      if (tipo === "entrata") {
        agg.entrate += amount;
      } else if (tipo === "uscita") {
        agg.costi += amount;
        const t = classifyFixedVariable(FIELD_NATURA ? f[FIELD_NATURA] : "");
        if (t === "fisse") agg.costiFissi += amount;
        else if (t === "variabili") agg.costiVariabili += amount;
      } else {
        // Neutra / altro: ignorato
      }
    }

    const labels = monthKeys.map((k) => fmtMonthShortIt(k));
    const entrateSeries = monthKeys.map((k) => Math.round(byMonth.get(k)?.entrate || 0));
    const costiSeries = monthKeys.map((k) => Math.round(byMonth.get(k)?.costi || 0));

    const currentKey = monthKeyUTC(now);
    const cur = byMonth.get(currentKey) || { entrate: 0, costi: 0, costiFissi: 0, costiVariabili: 0 };
    const entrateMese = cur.entrate || 0;
    const costiMese = cur.costi || 0;
    const margineEuro = entrateMese - costiMese;
    const marginePct = entrateMese > 0 ? (margineEuro / entrateMese) * 100 : 0;
    const pctFissi = costiMese > 0 ? (cur.costiFissi / costiMese) * 100 : 0;
    const pctVariabili = costiMese > 0 ? (cur.costiVariabili / costiMese) * 100 : 0;

    return res.status(200).json({
      ok: true,
      currentMonth: {
        key: currentKey,
        entrate: Math.round(entrateMese * 100) / 100,
        costi: Math.round(costiMese * 100) / 100,
        margineEuro: Math.round(margineEuro * 100) / 100,
        marginePct: Math.round(marginePct * 10) / 10,
        pctFissi: Math.round(pctFissi * 10) / 10,
        pctVariabili: Math.round(pctVariabili * 10) / 10,
      },
      last6Months: {
        keys: monthKeys,
        labels,
        entrate: entrateSeries,
        costi: costiSeries,
      },
      meta: {
        table: tableName,
        window: { from: monthKeys[0], to: monthKeys[monthKeys.length - 1] },
        records: Number(records?.length || 0),
      },
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

