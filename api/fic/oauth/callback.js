import { ensureRes, getCookie, requireRoles } from "../../_auth.js";
import { ficExchangeCodeForTokens, ficGetCompanyId, ficUpsertTokenRecord } from "../../_fic.js";

function clearCookie(name) {
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "manager"]);
  if (!user) return;

  try {
    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();
    const cookieState = String(getCookie(req, "fp_fic_oauth_state") || "").trim();

    if (!code) return res.status(400).json({ ok: false, error: "missing_code" });
    if (!state || !cookieState || state !== cookieState) {
      return res.status(400).json({ ok: false, error: "invalid_state" });
    }

    const tokens = await ficExchangeCodeForTokens(code);
    const accessToken = String(tokens.access_token || "").trim();
    const refreshToken = String(tokens.refresh_token || "").trim();
    const expiresIn = Number(tokens.expires_in || 0);
    if (!accessToken || !refreshToken) return res.status(502).json({ ok: false, error: "oauth_token_exchange_failed" });

    const companyId = await ficGetCompanyId(accessToken);
    const expiresAtIso = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();

    await ficUpsertTokenRecord({
      companyId,
      accessToken,
      refreshToken,
      expiresAtIso,
    });

    res.statusCode = 302;
    res.setHeader("Set-Cookie", clearCookie("fp_fic_oauth_state"));
    res.setHeader("Location", `/pages/fatturazione.html?oauth=ok&companyId=${encodeURIComponent(companyId)}`);
    res.end();
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ ok: false, error: e?.message || "server_error" });
  }
}

