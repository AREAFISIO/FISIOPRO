import { ensureRes, requireRoles } from "./_auth.js";
import { norm } from "./_common.js";
import { airtableList, escAirtableString as esc } from "../lib/airtableClient.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["back", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const anno = norm(req.query?.anno);
    let filterByFormula = "";
    if (anno) {
      // If {Mese} includes year (e.g. "2026-01" or "Gennaio 2026"), this works.
      // If it doesn't, Airtable will return 0 matches; caller can omit anno to fetch all.
      filterByFormula = `FIND("${esc(anno)}", {Mese}&"")`;
    }

    const { records } = await airtableList("RIEPILOGO ANNUALE", {
      filterByFormula,
      maxRecords: 500,
      sort: [{ field: "Mese", direction: "asc" }],
      fields: [
        "Mese",
        "Spese Fisse",
        "Spese Variabili",
        "Importo Variabile Competenza",
        "Totale Mensile",
        "Note",
        "Movimenti",
        "Totale Fisse Reali",
        "Totale Variabili Reali",
        "Totale Reale",
        "Scostamento",
        "Stato Budget",
        "Forecast Prossimo Anno",
        "Forecast avanzato",
      ],
    });

    return res.status(200).json({
      ok: true,
      anno: anno || null,
      records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

