import { ensureRes, requireRoles } from "./_auth.js";
import { escAirtableString, memGetOrSet, setPrivateCache, enc } from "./_common.js";
import { airtableListAll, asNumber } from "./_airtableClient.js";

function normalizeKeyLoose(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function resolveFieldKeyFromKeys(keys, candidates) {
  const list = Array.isArray(keys) ? keys : [];
  if (!list.length) return "";

  const byLower = new Map(list.map((k) => [String(k).toLowerCase(), String(k)]));
  for (const c of candidates || []) {
    const want = String(c || "").trim();
    if (!want) continue;
    const hit = byLower.get(want.toLowerCase());
    if (hit) return hit;
  }

  const byLoose = new Map(list.map((k) => [normalizeKeyLoose(k), String(k)]));
  for (const c of candidates || []) {
    const wantLoose = normalizeKeyLoose(c);
    if (!wantLoose) continue;
    const hit = byLoose.get(wantLoose);
    if (hit) return hit;
  }

  return "";
}

async function inferTableFieldKeys(tableEnc, cacheKey) {
  return await memGetOrSet(cacheKey, 60 * 60_000, async () => {
    // Single call: fetch one record without fields[] so we can see real keys.
    const records = await airtableListAll({ tableEnc, pageSize: 1, maxRecords: 1 });
    const first = records?.[0]?.fields || {};
    return Object.keys(first || {});
  });
}

function classifyFixedVariable(v) {
  // Returns "fisse" | "variabili" | "" (unknown)
  if (v === null || v === undefined) return "";
  const s = String(v).trim().toLowerCase();
  if (!s) return "";
  if (s.includes("fiss")) return "fisse";
  if (s.includes("variab")) return "variabili";
  return "";
}

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

function dayIsoUTC(d) {
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

function parseYmd(s) {
  const v = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    setPrivateCache(res, 30);

    const meseRaw = String(req.query?.mese || "").trim(); // supports "YYYY-MM" or legacy month labels
    const clinicaId = String(req.query?.clinica || "").trim();
    const naturaRaw = String(req.query?.natura || "").trim(); // "Fissa" | "Variabile" (optional)
    const startRaw = String(req.query?.start || "").trim(); // YYYY-MM-DD (optional)
    const endRaw = String(req.query?.end || "").trim(); // YYYY-MM-DD (optional)

    // ============================
    // Preferred source: MOVIMENTI_BANCA (Macro-based)
    // If schema doesn't match, fallback to legacy ESTRATTO_CONTO logic (keeps old pages working).
    // ============================
    try {
      const tableName = process.env.AIRTABLE_MOVIMENTI_BANCA_TABLE || "MOVIMENTI_BANCA";
      const tableEnc = enc(tableName);
      const keys = await inferTableFieldKeys(tableEnc, `movimentiBanca:keys:${tableName}`);

      const FIELD_DATA = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_MOVIMENTI_BANCA_DATA_FIELD, "Data", "Data movimento"]);
      const FIELD_IMPORTO = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_MOVIMENTI_BANCA_IMPORTO_FIELD, "Importo", "Importo totale"]);
      const FIELD_TIPO = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_MOVIMENTI_BANCA_TIPO_FIELD, "Tipo"]);
      const FIELD_MACRO = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_MOVIMENTI_BANCA_MACRO_FIELD, "Macro"]);
      const FIELD_NATURA = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_MOVIMENTI_BANCA_NATURA_FIELD, "Natura Costo", "Natura costo"]);

      // NOTE: Clinica field name can vary; keep env override compatible with other endpoints.
      const FIELD_CLINICA = resolveFieldKeyFromKeys(keys, [
        process.env.AIRTABLE_MOVIMENTI_BANCA_CLINICA_FIELD,
        "Clinica/Centro di costo",
        "Clinica",
        "Centro di costo",
      ]);

      const canUse = Boolean(FIELD_DATA && FIELD_IMPORTO && FIELD_TIPO && FIELD_MACRO);
      if (canUse) {
        // ---- Build filter formula (only "Uscita") ----
        const parts = [];
        parts.push(`{${FIELD_TIPO}}="Uscita"`);

        // month filter: prefer YYYY-MM on Data.
        if (meseRaw && /^\d{4}-\d{2}$/.test(meseRaw)) {
          parts.push(`DATETIME_FORMAT({${FIELD_DATA}}, "YYYY-MM")="${escAirtableString(meseRaw)}"`);
        }

        // date range (inclusive)
        const startD = parseYmd(startRaw);
        const endD = parseYmd(endRaw);
        if (startD && endD) {
          const startMinus1 = addDaysUTC(startD, -1);
          const endPlus1 = addDaysUTC(endD, 1);
          parts.push(
            `AND(IS_AFTER({${FIELD_DATA}},"${dayIsoUTC(startMinus1)}"),IS_BEFORE({${FIELD_DATA}},"${dayIsoUTC(endPlus1)}"))`,
          );
        }

        // clinica filter (if field exists)
        if (clinicaId && FIELD_CLINICA) {
          const esc = escAirtableString(clinicaId);
          parts.push(`{${FIELD_CLINICA}}="${esc}"`);
        }

        // natura filter (if field exists)
        if (naturaRaw && FIELD_NATURA) {
          const esc = escAirtableString(naturaRaw);
          parts.push(`{${FIELD_NATURA}}="${esc}"`);
        }

        const filterByFormula = parts.length ? `AND(${parts.join(",")})` : undefined;

        const records = await airtableListAll({
          tableEnc,
          fields: [FIELD_DATA, FIELD_IMPORTO, FIELD_TIPO, FIELD_MACRO, FIELD_NATURA, FIELD_CLINICA].filter(Boolean),
          filterByFormula,
          pageSize: 100,
          maxRecords: 10_000,
        });

        const byMacro = new Map(); // macro -> { macro, totale, fisse, variabili }
        for (const r of records || []) {
          const f = r?.fields || {};
          const macro = String(f[FIELD_MACRO] || "").trim() || "Senza macro";
          const importoRaw = asNumber(f[FIELD_IMPORTO]);
          if (!Number.isFinite(importoRaw)) continue;
          const amount = Math.abs(Number(importoRaw));
          if (!amount) continue;

          let agg = byMacro.get(macro);
          if (!agg) {
            agg = { macro, totale: 0, fisse: 0, variabili: 0 };
            byMacro.set(macro, agg);
          }
          agg.totale += amount;

          const natura = classifyFixedVariable(FIELD_NATURA ? f[FIELD_NATURA] : "");
          if (natura === "fisse") agg.fisse += amount;
          else if (natura === "variabili") agg.variabili += amount;
        }

        const normNum = (n) => {
          const nn = Math.round(Number(n || 0) * 100) / 100;
          return Number.isFinite(nn) && Math.abs(nn - Math.round(nn)) < 1e-9 ? Math.round(nn) : nn;
        };

        const out = Array.from(byMacro.values())
          .map((x) => {
            const fisse = normNum(x.fisse);
            const variabili = normNum(x.variabili);
            const naturaCosto =
              fisse > 0 && variabili === 0 ? "Fissa" :
              variabili > 0 && fisse === 0 ? "Variabile" :
              fisse > 0 && variabili > 0 ? "Mista" : "N/A";

            // Backward compatible fields:
            return {
              categoria: x.macro, // legacy consumer
              macro: x.macro, // new consumer
              totale: normNum(x.totale),
              fisse,
              variabili,
              naturaCosto,
            };
          })
          .sort((a, b) => Number(b.totale || 0) - Number(a.totale || 0));

        return res.status(200).json(out);
      }
    } catch {
      // If MOVIMENTI_BANCA isn't available / doesn't match, fallback below.
    }

    const tableName = process.env.AIRTABLE_ESTRATTO_CONTO_TABLE || "ESTRATTO_CONTO";
    const tableEnc = enc(tableName);

    // Resolve real field names from existing keys (robust against schema differences).
    const keys = await inferTableFieldKeys(tableEnc, `estrattoConto:keys:${tableName}`);

    // AIRTABLE SPEC
    // - Categoria (link a CATEGORIE_SPESE)
    // - Tipo Spesa (lookup)
    // - Importo Fisso (formula)
    // - Importo Variabile (formula)
    // - Mese (formula)
    const FIELD_CATEGORIA = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_ESTRATTO_CONTO_CATEGORIA_FIELD, "Categoria"]);
    const FIELD_IMPORTO = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_ESTRATTO_CONTO_IMPORTO_FIELD, "Importo"]);
    const FIELD_TIPO_SPESA = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_ESTRATTO_CONTO_TIPO_SPESA_FIELD, "Tipo Spesa", "Tipo spesa"]);
    const FIELD_IMPORTO_FISSO = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_ESTRATTO_CONTO_IMPORTO_FISSO_FIELD, "Importo Fisso"]);
    const FIELD_IMPORTO_VARIABILE = resolveFieldKeyFromKeys(keys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_IMPORTO_VARIABILE_FIELD,
      "Importo Variabile",
    ]);
    const FIELD_MESE = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_ESTRATTO_CONTO_MESE_FIELD, "Mese"]);
    const FIELD_DATA = resolveFieldKeyFromKeys(keys, [process.env.AIRTABLE_ESTRATTO_CONTO_DATA_FIELD, "Data"]);

    if (!FIELD_CATEGORIA || !FIELD_IMPORTO) {
      return res.status(500).json({
        ok: false,
        error: "estratto_conto_schema_mismatch",
        details: {
          categoriaFieldResolved: Boolean(FIELD_CATEGORIA),
          importoFieldResolved: Boolean(FIELD_IMPORTO),
        },
      });
    }

    // ---- Carica mappa CATEGORIE_SPESE (recordId -> Nome Categoria) ----
    const categoriesTableName = process.env.AIRTABLE_CATEGORIE_SPESE_TABLE || "CATEGORIE_SPESE";
    const categoriesTableEnc = enc(categoriesTableName);
    const catKeys = await inferTableFieldKeys(categoriesTableEnc, `categorieSpese:keys:${categoriesTableName}`);
    const FIELD_CAT_NOME = resolveFieldKeyFromKeys(catKeys, [
      process.env.AIRTABLE_CATEGORIE_SPESE_NOME_FIELD,
      "Nome Categoria",
      "Nome",
      "Categoria",
      "Name",
    ]);

    const categorieRecords = await airtableListAll({
      tableName: categoriesTableName,
      fields: FIELD_CAT_NOME ? [FIELD_CAT_NOME] : undefined,
      pageSize: 100,
      maxRecords: 5_000,
    });
    const catIdToName = new Map();
    for (const r of categorieRecords || []) {
      const f = r?.fields || {};
      const name = (FIELD_CAT_NOME ? String(f[FIELD_CAT_NOME] || "") : "") || String(Object.values(f || {})?.[0] || "");
      if (r?.id) catIdToName.set(r.id, String(name || "").trim());
    }

    // ---- Carica ESTRATTO_CONTO ----
    const fields = [
      FIELD_CATEGORIA,
      FIELD_IMPORTO,
      FIELD_TIPO_SPESA,
      FIELD_IMPORTO_FISSO,
      FIELD_IMPORTO_VARIABILE,
      FIELD_MESE,
      FIELD_DATA,
    ].filter(Boolean);

    const monthFormula = (() => {
      if (!meseRaw) return "";
      const mese = escAirtableString(meseRaw);
      // Support both:
      // - legacy labels (e.g. "Gennaio") via FIELD_MESE or DATETIME_FORMAT(...,"MMMM")
      // - ISO month key (YYYY-MM) via DATETIME_FORMAT(...,"YYYY-MM")
      const isYm = /^\d{4}-\d{2}$/.test(String(meseRaw || "").trim());
      if (isYm && FIELD_DATA) return `DATETIME_FORMAT({${FIELD_DATA}}, "YYYY-MM")="${mese}"`;
      if (FIELD_MESE) return `{${FIELD_MESE}}="${mese}"`;
      if (FIELD_DATA) return `DATETIME_FORMAT({${FIELD_DATA}}, "MMMM")="${mese}"`;
      return "";
    })();
    if (meseRaw && !monthFormula) return res.status(400).json({ ok: false, error: "missing_mese_field" });

    const clinicFormula = buildClinicFilterFormula({ clinicField: process.env.AIRTABLE_CLINICA_FIELD || "Clinica", clinicaId });
    const filterByFormula = [monthFormula, clinicFormula].filter(Boolean).length
      ? `AND(${[monthFormula, clinicFormula].filter(Boolean).join(",")})`
      : "";

    let records;
    try {
      records = await airtableListAll({
        tableName,
        fields,
        filterByFormula: filterByFormula || undefined,
        pageSize: 100,
        maxRecords: 10_000,
      });
    } catch (e) {
      // Se la clinica non è ancora modellata nel base, non bloccare: rimuovi il filtro clinica.
      if (clinicaId && isUnknownFieldError(e?.message)) {
        records = await airtableListAll({
          tableName,
          fields,
          filterByFormula: monthFormula || undefined,
          pageSize: 100,
          maxRecords: 10_000,
        });
      } else {
        throw e;
      }
    }

    const byCategoria = new Map(); // categoria -> { categoria, totale, fisse, variabili }

    for (const r of records) {
      const f = r?.fields || {};
      // Categoria è un link: Airtable restituisce array di recordId.
      const catIds = Array.isArray(f[FIELD_CATEGORIA]) ? f[FIELD_CATEGORIA] : (f[FIELD_CATEGORIA] ? [f[FIELD_CATEGORIA]] : []);
      const catId = String(catIds?.[0] || "").trim();
      const categoria = (catIdToName.get(catId) || "").trim() || "Senza categoria";

      // Se presenti, usiamo i campi formula Importo Fisso/Variabile (spec Airtable).
      const fisso = FIELD_IMPORTO_FISSO ? (asNumber(f[FIELD_IMPORTO_FISSO]) ?? 0) : 0;
      const variabile = FIELD_IMPORTO_VARIABILE ? (asNumber(f[FIELD_IMPORTO_VARIABILE]) ?? 0) : 0;
      const hasFormulaSplit = Boolean(FIELD_IMPORTO_FISSO || FIELD_IMPORTO_VARIABILE);

      let importoTot = 0;
      let addFisse = 0;
      let addVariabili = 0;

      if (hasFormulaSplit) {
        importoTot = (asNumber(fisso) ?? 0) + (asNumber(variabile) ?? 0);
        addFisse = asNumber(fisso) ?? 0;
        addVariabili = asNumber(variabile) ?? 0;
      } else {
        importoTot = asNumber(f[FIELD_IMPORTO]) ?? 0;
        const tipo = FIELD_TIPO_SPESA ? classifyFixedVariable(f[FIELD_TIPO_SPESA]) : "";
        if (tipo === "fisse") addFisse = importoTot;
        else addVariabili = importoTot;
      }

      if (!Number.isFinite(importoTot) || importoTot === 0) continue;

      let agg = byCategoria.get(categoria);
      if (!agg) {
        agg = { categoria, totale: 0, fisse: 0, variabili: 0 };
        byCategoria.set(categoria, agg);
      }

      agg.totale += importoTot;
      agg.fisse += addFisse;
      agg.variabili += addVariabili;
    }

    const out = Array.from(byCategoria.values()).map((x) => {
      // normalize to integers when they are effectively integers (avoids 23999.999999 style output)
      const normNum = (n) => {
        const nn = Math.round(Number(n || 0) * 100) / 100;
        return Number.isFinite(nn) && Math.abs(nn - Math.round(nn)) < 1e-9 ? Math.round(nn) : nn;
      };
      return {
        categoria: x.categoria,
        totale: normNum(x.totale),
        fisse: normNum(x.fisse),
        variabili: normNum(x.variabili),
      };
    });

    out.sort((a, b) => Number(b.totale || 0) - Number(a.totale || 0));

    return res.status(200).json(out);
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

