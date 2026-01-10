import { ensureRes, requireRoles } from "./_auth.js";
import { norm } from "./_common.js";
import { airtableGet } from "../lib/airtableClient.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const recordId = norm(req.query?.recordId || req.query?.id);
    if (!recordId) return res.status(400).json({ ok: false, error: "missing_recordId" });
    const rec = await airtableGet("VALUTAZIONI", recordId);
    return res.status(200).json({ ok: true, record: { id: rec.id, createdTime: rec.createdTime, fields: rec.fields || {} } });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

