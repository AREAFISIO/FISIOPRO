import { ensureRes, requireSession } from "../_auth.js";
import { norm } from "../_common.js";
import { airtableGet } from "../../lib/airtableClient.js";

export default async function handler(req, res) {
  ensureRes(res);
  const session = requireSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    const id = norm(req.query?.id);
    if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
    const rec = await airtableGet("PRESTAZIONI", id);
    return res.status(200).json({ ok: true, record: { id: rec.id, createdTime: rec.createdTime, fields: rec.fields || {} } });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

