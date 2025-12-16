import { requireSession } from "./_auth.js";

export default async function handler(req, res) {
  const session = requireSession(req);

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: Boolean(session), session: session || null }));
}
