import { setJson, clearSessionCookie } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return setJson(res, 405, { ok: false, error: "method_not_allowed" });

  const cookie = clearSessionCookie();
  return setJson(res, 200, { ok: true }, cookie);
}
