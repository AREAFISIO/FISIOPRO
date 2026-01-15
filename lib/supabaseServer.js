import { createClient } from "@supabase/supabase-js";

function normalizeEnvValue(v) {
  let s = process.env[v] ? String(process.env[v]) : "";
  s = String(s || "").trim();
  // Handle accidental quotes copied from dashboards:
  // e.g. "https://xxx.supabase.co" or "eyJ..."
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function isSupabaseEnabled() {
  const backend = normalizeEnvValue("DATA_BACKEND").toLowerCase();
  const url = normalizeEnvValue("SUPABASE_URL");
  const key = normalizeEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  return backend === "supabase" && Boolean(url) && Boolean(key);
}

export function getSupabaseAdmin() {
  const url = normalizeEnvValue("SUPABASE_URL");
  const key = normalizeEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    const err = new Error("missing_env_supabase");
    err.status = 500;
    throw err;
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function getSupabaseEnvDebug() {
  const url = normalizeEnvValue("SUPABASE_URL");
  const key = normalizeEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  const backend = normalizeEnvValue("DATA_BACKEND");
  const safe = (k) => {
    const s = String(k || "");
    if (!s) return { present: false, len: 0, prefix: "", suffix: "" };
    return {
      present: true,
      len: s.length,
      prefix: s.slice(0, 6),
      suffix: s.slice(-4),
    };
  };
  let host = "";
  try { host = url ? new URL(url).host : ""; } catch { host = ""; }
  return { backend, urlHost: host, key: safe(key) };
}

