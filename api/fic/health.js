import { ensureRes, requireRoles } from "../_auth.js";

function isSet(name) {
  return Boolean(String(process.env[name] || "").trim());
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager", "front"]);
  if (!user) return;

  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const required = ["FIC_CLIENT_ID", "FIC_CLIENT_SECRET", "FIC_REDIRECT_URI"];
  const missing = required.filter((k) => !isSet(k));

  return res.status(200).json({
    ok: missing.length === 0,
    missing,
    present: Object.fromEntries(required.map((k) => [k, isSet(k)])),
    vercelEnv: String(process.env.VERCEL_ENV || ""),
    vercelUrl: String(process.env.VERCEL_URL || ""),
    commit: String(process.env.VERCEL_GIT_COMMIT_SHA || ""),
  });
}

