import { ensureRes, requireRoles } from "../_auth.js";
import { readJsonBody, norm } from "../_common.js";
import { airtableUpdate, resolveLinkedIds } from "../../lib/airtableClient.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["back", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const body = await readJsonBody(req);
    if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

    const movimentoIdRaw = norm(body.movimentoId || body.movimento || body.movementId);
    if (!movimentoIdRaw) return res.status(400).json({ ok: false, error: "missing_movimentoId" });

    const fatturaIdRaw = norm(body.fatturaId || body.fattura || body.invoiceId);

    const [movimentoRecId] = await resolveLinkedIds({ table: "MOVIMENTI CONTO", values: movimentoIdRaw });
    const fatturaIds = fatturaIdRaw ? await resolveLinkedIds({ table: "FATTURE FIC", values: fatturaIdRaw, allowMissing: true }) : [];

    const fields = {
      "Fattura collegata": fatturaIds.length ? [fatturaIds[0]] : [],
    };

    const out = await airtableUpdate("MOVIMENTI CONTO", movimentoRecId, fields);
    return res.status(200).json({ ok: true, record: { id: out.id, fields: out.fields || {} } });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

