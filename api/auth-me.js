import { requireSession, setJson } from "./_auth.js";

export default async function handler(req, res) {
  const session = requireSession(req);
  return setJson(res, 200, { ok: Boolean(session), session: session || null });
}
