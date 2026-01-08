import { ensureRes, requireRoles } from "./_auth.js";
import { setPrivateCache } from "./_common.js";
import {
  airtableListAll,
  asLinkIds,
  asNumber,
  asString,
  inferTableFieldKeys,
  resolveFieldKeyFromKeys,
} from "./_airtableClient.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    setPrivateCache(res, 30);

    const op = String(req.query?.op || "dashboard").trim();
    const mese = String(req.query?.mese || "").trim(); // optional filter (e.g. "2026-01")

    const TABLE_CATEGORIE = process.env.AIRTABLE_CATEGORIE_SPESE_TABLE || "CATEGORIE_SPESE";
    const TABLE_ESTRATTO = process.env.AIRTABLE_ESTRATTO_CONTO_TABLE || "ESTRATTO_CONTO";
    const TABLE_RIEPILOGO = process.env.AIRTABLE_RIEPILOGO_ANNUALE_TABLE || "RIEPILOGO_ANNUALE";

    const tCat = encodeURIComponent(TABLE_CATEGORIE);
    const tEstr = encodeURIComponent(TABLE_ESTRATTO);
    const tRiep = encodeURIComponent(TABLE_RIEPILOGO);

    // --- Resolve real field names from a single sample record (case-insensitive / loose).
    const [catKeys, estrKeys, riepKeys] = await Promise.all([
      inferTableFieldKeys(tCat, `contabilita:keys:${TABLE_CATEGORIE}`),
      inferTableFieldKeys(tEstr, `contabilita:keys:${TABLE_ESTRATTO}`),
      inferTableFieldKeys(tRiep, `contabilita:keys:${TABLE_RIEPILOGO}`),
    ]);

    const CAT_NOME = resolveFieldKeyFromKeys(catKeys, [
      process.env.AIRTABLE_CATEGORIE_SPESE_NOME_FIELD,
      "Nome Categoria",
      "Categoria",
      "Nome",
      "Name",
    ].filter(Boolean));
    const CAT_TIPO = resolveFieldKeyFromKeys(catKeys, [
      process.env.AIRTABLE_CATEGORIE_SPESE_TIPO_FIELD,
      "Tipo",
      "Tipo spesa",
    ].filter(Boolean));

    const EC_DATA = resolveFieldKeyFromKeys(estrKeys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_DATA_FIELD,
      "Data",
      "Data movimento",
    ].filter(Boolean));
    const EC_IMPORTO = resolveFieldKeyFromKeys(estrKeys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_IMPORTO_FIELD,
      "Importo",
      "Importo totale",
    ].filter(Boolean));
    const EC_CATEGORIA = resolveFieldKeyFromKeys(estrKeys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_CATEGORIA_FIELD,
      "Categoria",
      "Categorie",
    ].filter(Boolean));
    const EC_FISSO = resolveFieldKeyFromKeys(estrKeys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_IMPORTO_FISSO_FIELD,
      "Importo Fisso",
      "Fisso",
    ].filter(Boolean));
    const EC_VAR = resolveFieldKeyFromKeys(estrKeys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_IMPORTO_VARIABILE_FIELD,
      "Importo Variabile",
      "Variabile",
    ].filter(Boolean));
    const EC_MESE = resolveFieldKeyFromKeys(estrKeys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_MESE_FIELD,
      "Mese",
      "Periodo",
    ].filter(Boolean));

    const R_MESE = resolveFieldKeyFromKeys(riepKeys, [
      process.env.AIRTABLE_RIEPILOGO_ANNUALE_MESE_FIELD,
      "Mese",
      "Periodo",
    ].filter(Boolean));
    const R_TOT_MENSILE = resolveFieldKeyFromKeys(riepKeys, [
      process.env.AIRTABLE_RIEPILOGO_ANNUALE_TOTALE_MENSILE_FIELD,
      "Totale Mensile",
      "Totale mensile",
    ].filter(Boolean));
    const R_TOT_REALE = resolveFieldKeyFromKeys(riepKeys, [
      process.env.AIRTABLE_RIEPILOGO_ANNUALE_TOTALE_REALE_FIELD,
      "Totale Reale",
      "Totale reale",
    ].filter(Boolean));
    const R_SCOST = resolveFieldKeyFromKeys(riepKeys, [
      process.env.AIRTABLE_RIEPILOGO_ANNUALE_SCOSTAMENTO_FIELD,
      "Scostamento",
      "Delta",
    ].filter(Boolean));

    if (op === "health") {
      return res.status(200).json({
        ok: true,
        tables: {
          categorie: TABLE_CATEGORIE,
          estratto: TABLE_ESTRATTO,
          riepilogo: TABLE_RIEPILOGO,
        },
        fields: {
          categorie: { nome: CAT_NOME, tipo: CAT_TIPO },
          estratto: { data: EC_DATA, importo: EC_IMPORTO, categoria: EC_CATEGORIA, fisso: EC_FISSO, variabile: EC_VAR, mese: EC_MESE },
          riepilogo: { mese: R_MESE, totaleMensile: R_TOT_MENSILE, totaleReale: R_TOT_REALE, scostamento: R_SCOST },
        },
      });
    }

    if (op !== "dashboard") return res.status(400).json({ ok: false, error: "unknown_op" });

    // --- Fetch records (only needed fields for speed).
    const filterEstratto = (mese && EC_MESE) ? `{${EC_MESE}}="${mese.replace(/"/g, '\\"')}"` : "";

    const [catRecs, estrRecs, riepRecs] = await Promise.all([
      airtableListAll({
        tableEnc: tCat,
        fields: [CAT_NOME, CAT_TIPO].filter(Boolean),
        pageSize: 100,
        maxRecords: 1000,
      }),
      airtableListAll({
        tableEnc: tEstr,
        fields: [EC_DATA, EC_IMPORTO, EC_CATEGORIA, EC_FISSO, EC_VAR, EC_MESE].filter(Boolean),
        filterByFormula: filterEstratto || undefined,
        pageSize: 100,
        maxRecords: 2000,
      }),
      airtableListAll({
        tableEnc: tRiep,
        fields: [R_MESE, R_TOT_MENSILE, R_TOT_REALE, R_SCOST].filter(Boolean),
        sort: R_MESE ? [{ field: R_MESE, direction: "asc" }] : undefined,
        pageSize: 100,
        maxRecords: 1000,
      }),
    ]);

    // --- Normalize to clean dashboard JSON.
    const categories = (catRecs || [])
      .map((r) => {
        const f = r.fields || {};
        const name = asString(CAT_NOME ? f[CAT_NOME] : "");
        if (!name) return null;
        return {
          id: r.id,
          name,
          tipo: asString(CAT_TIPO ? f[CAT_TIPO] : ""),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "it"));

    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const estratto = (estrRecs || [])
      .map((r) => {
        const f = r.fields || {};
        const categoriaIds = asLinkIds(EC_CATEGORIA ? f[EC_CATEGORIA] : null);
        const categoriaId = categoriaIds[0] || "";
        const cat = categoriaId ? categoryById.get(categoriaId) : null;
        return {
          id: r.id,
          data: asString(EC_DATA ? f[EC_DATA] : ""),
          mese: asString(EC_MESE ? f[EC_MESE] : ""),
          importo: asNumber(EC_IMPORTO ? f[EC_IMPORTO] : null),
          importoFisso: asNumber(EC_FISSO ? f[EC_FISSO] : null),
          importoVariabile: asNumber(EC_VAR ? f[EC_VAR] : null),
          categoriaId,
          categoriaName: cat?.name || "",
          categoriaTipo: cat?.tipo || "",
        };
      })
      .sort((a, b) => String(a.data || "").localeCompare(String(b.data || ""), "it"));

    const riepilogo = (riepRecs || [])
      .map((r) => {
        const f = r.fields || {};
        return {
          id: r.id,
          mese: asString(R_MESE ? f[R_MESE] : ""),
          totaleMensile: asNumber(R_TOT_MENSILE ? f[R_TOT_MENSILE] : null),
          totaleReale: asNumber(R_TOT_REALE ? f[R_TOT_REALE] : null),
          scostamento: asNumber(R_SCOST ? f[R_SCOST] : null),
        };
      })
      .filter((x) => x.mese)
      .sort((a, b) => a.mese.localeCompare(b.mese, "it"));

    return res.status(200).json({
      ok: true,
      mese: mese || null,
      categories,
      estratto,
      riepilogo,
      meta: {
        tables: { categorie: TABLE_CATEGORIE, estratto: TABLE_ESTRATTO, riepilogo: TABLE_RIEPILOGO },
        counts: { categories: categories.length, estratto: estratto.length, riepilogo: riepilogo.length },
      },
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

