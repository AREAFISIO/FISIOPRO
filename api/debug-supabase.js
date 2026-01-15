import { ensureRes, requireRoles } from "./_auth.js";
import { getSupabaseAdmin, getSupabaseEnvDebug, isSupabaseEnabled } from "../lib/supabaseServer.js";

// Debug endpoint to verify Vercel env wiring (does NOT expose secrets).
// Access: manager only.
export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  try {
    const dbg = getSupabaseEnvDebug();
    const enabled = isSupabaseEnabled();

    // Minimal live check (does not return data).
    let live = { ok: false, error: "" };
    if (enabled) {
      try {
        const sb = getSupabaseAdmin();
        const { error } = await sb.from("patients").select("id").limit(1);
        live = { ok: !error, error: error ? error.message : "" };
      } catch (e) {
        live = { ok: false, error: String(e?.message || e) };
      }
    }

    return res.status(200).json({ ok: true, enabled, env: dbg, live });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "server_error" });
  }
}

