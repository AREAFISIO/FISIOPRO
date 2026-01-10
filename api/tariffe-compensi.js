import { ensureRes, requireRoles } from "./_auth.js";
import { norm } from "./_common.js";
import { airtableList, escAirtableString as esc } from "../lib/airtableClient.js";

function toBoolParam(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "true" || s === "1" || s === "yes" || s === "si" || s === "sì") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "back", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const tipoTariffa = norm(req.query?.tipoTariffa);
    const livello = norm(req.query?.livello);
    const domicilio = toBoolParam(req.query?.domicilio);

    const parts = [];
    if (tipoTariffa) parts.push(`{Tipo tariffa}="${esc(tipoTariffa)}"`);
    if (livello) parts.push(`{Livello}="${esc(livello)}"`);
    if (domicilio !== null) parts.push(domicilio ? `{Domicilio}=TRUE()` : `OR({Domicilio}=FALSE(), {Domicilio}=BLANK())`);

    const filterByFormula = parts.length ? `AND(${parts.join(",")})` : "";

    const { records } = await airtableList("TARIFFE COMPENSI", {
      filterByFormula,
      maxRecords: 50,
      sort: [{ field: "Chiave tariffa", direction: "asc" }],
      fields: ["Chiave tariffa", "Tipo tariffa", "Livello", "Consuma seduta", "Compenso per slot 30m", "Compenso per 60m", "Domicilio"],
    });

    const items = (records || []).map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        chiave: f["Chiave tariffa"] ?? "",
        tipoTariffa: f["Tipo tariffa"] ?? "",
        livello: f["Livello"] ?? "",
        domicilio: Boolean(f["Domicilio"]),
        consumaSeduta: Boolean(f["Consuma seduta"]),
        compenso30m: f["Compenso per slot 30m"] ?? null,
        compenso60m: f["Compenso per 60m"] ?? null,
        fields: f,
      };
    });

    // Convenience: if filters narrow to one row, expose a "best" object.
    const best = items.length === 1 ? items[0] : null;

    return res.status(200).json({ ok: true, filters: { tipoTariffa, livello, domicilio }, best, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

