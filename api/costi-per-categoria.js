import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc, memGetOrSet, setPrivateCache } from "./_common.js";

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

function toNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  // Accept "1.234,56" or "1234.56"
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function pickCategory(v) {
  if (Array.isArray(v)) return String(v[0] || "").trim();
  return String(v ?? "").trim();
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    setPrivateCache(res, 60);

    const tableName = String(process.env.AIRTABLE_COSTI_TABLE || process.env.AIRTABLE_COSTS_TABLE || "COSTI").trim();
    const tableEnc = enc(tableName);

    // Candidate field names (can be overridden via env).
    const categoryEnv = process.env.AIRTABLE_COSTI_CATEGORIA_FIELD || process.env.AIRTABLE_COSTS_CATEGORY_FIELD;
    const amountEnv = process.env.AIRTABLE_COSTI_IMPORTO_FIELD || process.env.AIRTABLE_COSTS_AMOUNT_FIELD;

    const cacheKey = `costiPerCategoria:${tableName}`;
    const payload = await memGetOrSet(cacheKey, 60_000, async () => {
      // Fetch one record to infer real Airtable field keys (avoids unknown field name errors).
      const sample = await airtableFetch(`${tableEnc}?pageSize=1`);
      const keys = Object.keys(sample?.records?.[0]?.fields || {});

      const FIELD_CATEGORY = resolveFieldKeyFromKeys(keys, [categoryEnv, "Categoria", "Categoria costo", "Tipo", "Voce"].filter(Boolean));
      const FIELD_AMOUNT = resolveFieldKeyFromKeys(keys, [amountEnv, "Importo", "Totale", "Costo", "Valore", "€"].filter(Boolean));

      if (!FIELD_CATEGORY || !FIELD_AMOUNT) {
        return {
          ok: true,
          items: [],
          total: 0,
          meta: {
            table: tableName,
            categoryField: FIELD_CATEGORY || null,
            amountField: FIELD_AMOUNT || null,
            warning: "schema_mismatch",
          },
        };
      }

      const totals = new Map(); // category -> number
      let offset = null;
      let loops = 0;
      const maxPages = 20; // hard safety limit (20 * 100 = 2000 records)

      do {
        const qs = new URLSearchParams({ pageSize: "100" });
        if (offset) qs.set("offset", String(offset));
        // Only request needed fields.
        qs.append("fields[]", FIELD_CATEGORY);
        qs.append("fields[]", FIELD_AMOUNT);

        const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
        const recs = Array.isArray(data?.records) ? data.records : [];

        for (const r of recs) {
          const f = r?.fields || {};
          const cat = pickCategory(f[FIELD_CATEGORY]) || "Senza categoria";
          const amt = toNumber(f[FIELD_AMOUNT]);
          totals.set(cat, (totals.get(cat) || 0) + amt);
        }

        offset = data?.offset || null;
        loops += 1;
      } while (offset && loops < maxPages);

      const items = Array.from(totals.entries())
        .map(([categoria, totale]) => ({ categoria, totale }))
        .sort((a, b) => Number(b.totale) - Number(a.totale));

      const total = items.reduce((s, x) => s + (Number(x.totale) || 0), 0);

      return {
        ok: true,
        items,
        total,
        meta: { table: tableName, categoryField: FIELD_CATEGORY, amountField: FIELD_AMOUNT },
      };
    });

    return res.status(200).json(payload);
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

