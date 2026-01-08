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

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    setPrivateCache(res, 30);

    const meseRaw = String(req.query?.mese || "").trim();
    const clinicaId = String(req.query?.clinica || "").trim();

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

