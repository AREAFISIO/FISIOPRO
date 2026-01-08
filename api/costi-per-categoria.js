import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { escAirtableString, memGetOrSet, setPrivateCache, enc } from "./_common.js";

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
    const data = await airtableFetch(`${tableEnc}?pageSize=1`);
    const first = data?.records?.[0]?.fields || {};
    return Object.keys(first || {});
  });
}

function parseEuroNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  // Handle strings like "1.234,56", "1234.56", "€ 1.234,00", "-200", etc.
  let s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/[€\s]/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  // If comma is present, assume Italian decimal separator and dot as thousands separator.
  if (hasComma) {
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else if (hasDot) {
    // If only dots, assume dot is decimal separator; also remove thousand separators if multiple dots.
    const parts = s.split(".");
    if (parts.length > 2) {
      const dec = parts.pop();
      s = parts.join("") + "." + dec;
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function classifyFixedVariable(v) {
  // Returns "fisse" | "variabili" | "" (unknown)
  if (v === null || v === undefined) return "";

  if (typeof v === "boolean") return v ? "fisse" : "";

  const s = String(v).trim().toLowerCase();
  if (!s) return "";
  if (s.includes("fiss") || s.includes("ricorr") || s.includes("ripet")) return "fisse";
  if (s.includes("variab")) return "variabili";
  return "";
}

async function fetchAllAirtableRecords(tableEnc, qs) {
  const records = [];
  let offset = null;
  do {
    if (offset) qs.set("offset", offset);
    const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
    for (const r of data?.records || []) records.push(r);
    offset = data?.offset || null;
  } while (offset);
  return records;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    setPrivateCache(res, 30);

    const meseRaw = String(req.query?.mese || "").trim();

    const tableName = process.env.AIRTABLE_ESTRATTO_CONTO_TABLE || "ESTRATTO_CONTO";
    const tableEnc = enc(tableName);

    // Resolve real field names from existing keys (robust against schema differences).
    const keys = await inferTableFieldKeys(tableEnc, `estrattoConto:keys:${tableName}`);

    const FIELD_CATEGORIA = resolveFieldKeyFromKeys(keys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_CATEGORIA_FIELD,
      "Categoria",
      "Categoria spesa",
      "Cat",
    ]);
    const FIELD_IMPORTO = resolveFieldKeyFromKeys(keys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_IMPORTO_FIELD,
      "Importo",
      "Importo (€)",
      "Totale",
      "Valore",
      "Uscita",
      "Spesa",
    ]);
    const FIELD_TIPO = resolveFieldKeyFromKeys(keys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_TIPO_FIELD,
      "Tipo",
      "Tipo spesa",
      "Fissa/Variabile",
      "Fisso/Variabile",
      "Fissa",
      "Ricorrente",
    ]);
    const FIELD_MESE = resolveFieldKeyFromKeys(keys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_MESE_FIELD,
      "Mese",
      "Mese competenza",
      "Mese (testo)",
    ]);
    const FIELD_DATA = resolveFieldKeyFromKeys(keys, [
      process.env.AIRTABLE_ESTRATTO_CONTO_DATA_FIELD,
      "Data",
      "Data movimento",
      "Data operazione",
    ]);

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

    const qs = new URLSearchParams({ pageSize: "100" });
    qs.append("fields[]", FIELD_CATEGORIA);
    qs.append("fields[]", FIELD_IMPORTO);
    if (FIELD_TIPO) qs.append("fields[]", FIELD_TIPO);
    if (FIELD_MESE) qs.append("fields[]", FIELD_MESE);
    if (FIELD_DATA) qs.append("fields[]", FIELD_DATA);

    if (meseRaw) {
      const mese = escAirtableString(meseRaw);
      if (FIELD_MESE) {
        qs.set("filterByFormula", `{${FIELD_MESE}}="${mese}"`);
      } else if (FIELD_DATA) {
        // Best-effort fallback: match month name extracted from date.
        // NOTE: month language depends on base locale; this still works if it matches "Gennaio", etc.
        qs.set("filterByFormula", `DATETIME_FORMAT({${FIELD_DATA}}, "MMMM")="${mese}"`);
      } else {
        return res.status(400).json({ ok: false, error: "missing_mese_field" });
      }
    }

    const records = await fetchAllAirtableRecords(tableEnc, qs);

    const byCategoria = new Map(); // categoria -> { categoria, totale, fisse, variabili }

    for (const r of records) {
      const f = r?.fields || {};
      const categoria = String(f[FIELD_CATEGORIA] ?? "").trim() || "Senza categoria";
      const importo = parseEuroNumber(f[FIELD_IMPORTO]);
      if (!Number.isFinite(importo) || importo === 0) {
        // ignore empty/zero values (keeps output cleaner)
        continue;
      }

      const tipo = FIELD_TIPO ? classifyFixedVariable(f[FIELD_TIPO]) : "";

      let agg = byCategoria.get(categoria);
      if (!agg) {
        agg = { categoria, totale: 0, fisse: 0, variabili: 0 };
        byCategoria.set(categoria, agg);
      }

      agg.totale += importo;
      if (tipo === "fisse") agg.fisse += importo;
      else if (tipo === "variabili") agg.variabili += importo;
      else agg.variabili += importo; // default: treat as variable if classification missing
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

