import { ensureRes, requireSession } from "./_auth.js";
import { norm, escAirtableString as escCommon, readJsonBody } from "./_common.js";
import { airtableCreate, airtableGet, airtableList, airtableUpdate, escAirtableString as esc } from "../lib/airtableClient.js";

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "si" || s === "sì" || s === "ok";
}

export default async function handler(req, res) {
  ensureRes(res);
  const session = requireSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

  try {
    if (req.method === "GET") {
      const q = norm(req.query?.q);
      const parts = [];
      if (q) {
        const qq = esc(q.toLowerCase());
        parts.push(`FIND(LOWER("${qq}"), LOWER({Servizio}&""))`);
        parts.push(`FIND(LOWER("${qq}"), LOWER({Codice}&""))`);
      }
      const filterByFormula = parts.length ? `OR(${parts.join(",")})` : "";

      const { records } = await airtableList("PRESTAZIONI", {
        filterByFormula,
        maxRecords: 500,
        sort: [{ field: "Servizio", direction: "asc" }],
        fields: [
          "Servizio",
          "Codice",
          "Costo Seduta singola",
          "Tipo tariffa",
          "N° SEDUTE INCLUSE",
          "Area",
          "Durata Singola",
          "Valore Totale",
          "Consuma seduta?",
          "È valutazione?",
          "È trattamento?",
          "Paga collaboratore?",
        ],
      });

      return res.status(200).json({
        ok: true,
        q,
        records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const payload = body.prestazione || body;
      const recordId = norm(payload.recordId || payload.id);

      const servizio = norm(payload.Servizio || payload.servizio);
      if (!recordId && !servizio) return res.status(400).json({ ok: false, error: "missing_servizio" });

      const fields = {};
      if (servizio) fields["Servizio"] = servizio;

      const codice = norm(payload.Codice || payload.codice);
      if (codice) fields["Codice"] = codice;

      const costo = payload["Costo Seduta singola"] ?? payload.costoSeduta ?? payload.costo;
      if (costo !== undefined && costo !== null && String(costo).trim() !== "") fields["Costo Seduta singola"] = costo;

      const tipoTariffa = norm(payload["Tipo tariffa"] || payload.tipoTariffa);
      if (tipoTariffa) fields["Tipo tariffa"] = tipoTariffa;

      const nSedute = payload["N° SEDUTE INCLUSE"] ?? payload.seduteIncluse;
      if (nSedute !== undefined && nSedute !== null && String(nSedute).trim() !== "") fields["N° SEDUTE INCLUSE"] = nSedute;

      const area = norm(payload.Area || payload.area);
      if (area) fields["Area"] = area;

      const durata = payload["Durata Singola"] ?? payload.durataSingola ?? payload.durata;
      if (durata !== undefined && durata !== null && String(durata).trim() !== "") fields["Durata Singola"] = durata;

      // Read-only / derived fields are not written: "Valore Totale", "Data creazione", lookup fields.
      if (payload["Consuma seduta?"] !== undefined || payload.consumaSeduta !== undefined) {
        fields["Consuma seduta?"] = toBool(payload["Consuma seduta?"] ?? payload.consumaSeduta);
      }
      if (payload["È valutazione?"] !== undefined || payload.eValutazione !== undefined) {
        fields["È valutazione?"] = toBool(payload["È valutazione?"] ?? payload.eValutazione);
      }
      if (payload["È trattamento?"] !== undefined || payload.eTrattamento !== undefined) {
        fields["È trattamento?"] = toBool(payload["È trattamento?"] ?? payload.eTrattamento);
      }
      if (payload["Paga collaboratore?"] !== undefined || payload.pagaCollaboratore !== undefined) {
        fields["Paga collaboratore?"] = toBool(payload["Paga collaboratore?"] ?? payload.pagaCollaboratore);
      }

      const out = recordId ? await airtableUpdate("PRESTAZIONI", recordId, fields) : await airtableCreate("PRESTAZIONI", fields);
      return res.status(200).json({ ok: true, record: { id: out.id, fields: out.fields || {}, createdTime: out.createdTime || "" } });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

