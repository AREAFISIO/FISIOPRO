import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc, norm, readJsonBody } from "./_common.js";
import { airtableCreate, airtableList, airtableUpdate, escAirtableString as esc } from "../lib/airtableClient.js";

function isWriteBlockedFieldName(fieldName) {
  const k = String(fieldName || "").trim();
  if (!k) return true;
  const low = k.toLowerCase();
  if (k === "...") return true;
  if (low.includes("copy")) return true;
  if (/\(from\s.+\)/i.test(k)) return true;
  return false;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "manager"]);
  if (!user) return;

  try {
    const tableName = process.env.AIRTABLE_TEST_CLINICI_TABLE || "TEST CLINICI";
    const fieldName = process.env.AIRTABLE_TEST_CLINICI_NAME_FIELD || "Nome test";
    const fieldDistretto = process.env.AIRTABLE_TEST_CLINICI_DISTRETTO_FIELD || "Distretto";
    const fieldCategoria = process.env.AIRTABLE_TEST_CLINICI_CATEGORIA_FIELD || "Categoria";
    const fieldTipoRis = process.env.AIRTABLE_TEST_CLINICI_TIPO_RIS_FIELD || "Tipo risultato";
    const fieldMin = process.env.AIRTABLE_TEST_CLINICI_MIN_FIELD || "Valore minimo";
    const fieldMax = process.env.AIRTABLE_TEST_CLINICI_MAX_FIELD || "Valore massimo";
    const fieldDesc = process.env.AIRTABLE_TEST_CLINICI_DESC_FIELD || "Descrizione test";
    const fieldInstr = process.env.AIRTABLE_TEST_CLINICI_INSTR_FIELD || "Istruzioni esecuzione";
    const fieldInterp = process.env.AIRTABLE_TEST_CLINICI_INTERP_FIELD || "Interpretazione risultato";
    const fieldActive = process.env.AIRTABLE_TEST_CLINICI_ACTIVE_FIELD || "Attivo";

    const tableEnc = enc(tableName);

    if (req.method === "GET") {
      // NEW CONTRACT: /api/test-clinici?q=... (search on NOME/CATEGORIA/DISTRETTO)
      // Keep old behavior when q is missing (backward compatibility).
      const q = norm(req.query?.q);
      if (q) {
        const qq = esc(q.toLowerCase());
        const formula = `OR(
          FIND(LOWER("${qq}"), LOWER({NOME}&"")),
          FIND(LOWER("${qq}"), LOWER({CATEGORIA}&"")),
          FIND(LOWER("${qq}"), LOWER({DISTRETTO}&""))
        )`;

        const { records } = await airtableList("TEST CLINICI", {
          filterByFormula: formula,
          maxRecords: 200,
          sort: [{ field: "NOME", direction: "asc" }],
          fields: ["NOME", "CATEGORIA", "DISTRETTO", "DESCRIZIONE", "STEP", "VIDEO URL", "VIDEO FILE"],
        });

        return res.status(200).json({
          ok: true,
          q,
          records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
        });
      }

      const activeOnly = String(req.query?.activeOnly ?? "1") !== "0";
      const qs = new URLSearchParams({ pageSize: "100" });
      if (activeOnly) qs.set("filterByFormula", `{${fieldActive}}=1`);
      const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);

      const items = (data.records || [])
        .map((r) => {
          const f = r.fields || {};
          const name = String(f[fieldName] ?? f.Nome ?? f.Name ?? "").trim();
          if (!name) return null;
          return {
            id: r.id,
            name,
            distretto: f[fieldDistretto] ?? "",
            categoria: f[fieldCategoria] ?? "",
            tipoRisultato: f[fieldTipoRis] ?? "",
            min: f[fieldMin] ?? null,
            max: f[fieldMax] ?? null,
            descrizione: f[fieldDesc] ?? "",
            istruzioni: f[fieldInstr] ?? "",
            interpretazione: f[fieldInterp] ?? "",
            attivo: Boolean(f[fieldActive]),
            _fields: f,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));

      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "POST") {
      // catalog management
      if (String(user.role) !== "manager") return res.status(403).json({ ok: false, error: "forbidden" });
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      // NEW CONTRACT: create/update by recordId (supports attachment field VIDEO FILE).
      // If caller passes "fields", treat it as Airtable payload.
      const recordId = norm(body.recordId || body.id);
      const rawFields = body.fields && typeof body.fields === "object" ? body.fields : body;
      if (recordId) {
        const fields = {};
        for (const [k, v] of Object.entries(rawFields || {})) {
          if (k === "recordId" || k === "id" || k === "createdTime") continue;
          if (isWriteBlockedFieldName(k)) continue;
          fields[k] = v;
        }
        const updated = await airtableUpdate("TEST CLINICI", recordId, fields);
        return res.status(200).json({ ok: true, record: { id: updated.id, createdTime: updated.createdTime, fields: updated.fields || {} } });
      }

      const name = norm(body.name || body.nome || body[fieldName]);
      if (!name) return res.status(400).json({ ok: false, error: "missing_name" });

      const fields = {};
      fields[fieldName] = name;

      const distretto = norm(body.distretto || body[fieldDistretto]);
      if (distretto) fields[fieldDistretto] = distretto;
      const categoria = norm(body.categoria || body[fieldCategoria]);
      if (categoria) fields[fieldCategoria] = categoria;
      const tipo = norm(body.tipoRisultato || body.tipo || body[fieldTipoRis]);
      if (tipo) fields[fieldTipoRis] = tipo;

      if (body.min !== undefined) fields[fieldMin] = body.min;
      if (body.max !== undefined) fields[fieldMax] = body.max;

      const descrizione = norm(body.descrizione || body[fieldDesc]);
      if (descrizione) fields[fieldDesc] = descrizione;
      const istruzioni = norm(body.istruzioni || body[fieldInstr]);
      if (istruzioni) fields[fieldInstr] = istruzioni;
      const interpretazione = norm(body.interpretazione || body[fieldInterp]);
      if (interpretazione) fields[fieldInterp] = interpretazione;

      if (body.attivo !== undefined) fields[fieldActive] = Boolean(body.attivo);

      const created = await airtableFetch(`${tableEnc}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });

      return res.status(200).json({ ok: true, id: created?.id, fields: created?.fields || {} });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

