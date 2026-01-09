import { ensureRes, requireRoles } from "../../_auth.js";
import { ficBuildAuthorizeUrl, randomState } from "../../_fic.js";

function setCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(String(value || ""))}`];
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("Secure");
  parts.push("SameSite=Lax");
  if (opts.maxAgeSeconds) parts.push(`Max-Age=${Number(opts.maxAgeSeconds) || 0}`);
  return parts.join("; ");
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "manager"]);
  if (!user) return;

  try {
    const state = randomState();
    const url = ficBuildAuthorizeUrl({ state });

    res.statusCode = 302;
    res.setHeader("Set-Cookie", setCookie("fp_fic_oauth_state", state, { maxAgeSeconds: 10 * 60 }));
    res.setHeader("Location", url);
    res.end();
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "server_error" });
  }
}

