import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc, norm, readJsonBody } from "./_common.js";
import { airtableList, escAirtableString as escAirtableStringLib } from "../lib/airtableClient.js";

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "si" || s === "sì" || s === "ok";
}

function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "manager"]);
  if (!user) return;

  try {
    const tableName = process.env.AIRTABLE_FONTI_TABLE || "FONTI";
    const fieldName = process.env.AIRTABLE_FONTI_NAME_FIELD || "Nome fonte";
    const fieldType = process.env.AIRTABLE_FONTI_TYPE_FIELD || "Tipo";
    const fieldActive = process.env.AIRTABLE_FONTI_ACTIVE_FIELD || "Attiva";
    const fieldNote = process.env.AIRTABLE_FONTI_NOTE_FIELD || "Note";

    const tableEnc = enc(tableName);

    if (req.method === "GET") {
      // NEW CONTRACT (requested): /api/fonti?q=... (Airtable CSV schema: primary "FONTE")
      // NOTE: keep old behavior if q is missing (backward compatibility).
      const q = String(req.query?.q ?? "").trim();
      if (q) {
        const qq = escAirtableStringLib(q.toLowerCase());
        const formula = `FIND(LOWER("${qq}"), LOWER({FONTE}&""))`;
        const { records } = await airtableList("FONTI", {
          filterByFormula: formula,
          maxRecords: 200,
          sort: [{ field: "FONTE", direction: "asc" }],
          fields: [
            "FONTE",
            "n° generale",
            "2024 - n° generale",
            "2024 - (€) Generale",
            "Anno",
            "Periodo",
            "Generale check",
          ],
        });

        const items = (records || []).map((r) => {
          const f = r.fields || {};
          const fonte = String(f["FONTE"] ?? "").trim();
          const tot = toNum(f["n° generale"]);
          const tot2024 = toNum(f["2024 - n° generale"]);
          const eur2024 = toNum(f["2024 - (€) Generale"]);
          return {
            id: r.id,
            fonte,
            tot,
            tot2024,
            eur2024,
            anno: f["Anno"] ?? "",
            periodo: f["Periodo"] ?? "",
            generaleCheck: toBool(f["Generale check"]),
            fields: f,
          };
        });

        const totals = items.reduce(
          (acc, it) => {
            acc.tot += toNum(it.tot);
            acc.tot2024 += toNum(it.tot2024);
            acc.eur2024 += toNum(it.eur2024);
            return acc;
          },
          { tot: 0, tot2024: 0, eur2024: 0 },
        );

        return res.status(200).json({ ok: true, q, items, totals });
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
            tipo: f[fieldType] ?? "",
            attiva: Boolean(f[fieldActive]),
            note: f[fieldNote] ?? "",
            _fields: f,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));

      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "POST") {
      // Only manager should create/update catalog entries.
      if (String(user.role) !== "manager") return res.status(403).json({ ok: false, error: "forbidden" });

      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const name = norm(body.name || body.nome || body[fieldName]);
      if (!name) return res.status(400).json({ ok: false, error: "missing_name" });

      const fields = {};
      fields[fieldName] = name;
      const tipo = norm(body.tipo || body[fieldType]);
      if (tipo) fields[fieldType] = tipo;
      if (body.attiva !== undefined) fields[fieldActive] = Boolean(body.attiva);
      const note = norm(body.note || body[fieldNote]);
      if (note) fields[fieldNote] = note;

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

