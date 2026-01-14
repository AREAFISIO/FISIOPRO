import { createClient } from "@supabase/supabase-js";

function env(name) {
  return process.env[name] ? String(process.env[name]) : "";
}

export function isSupabaseEnabled() {
  return env("DATA_BACKEND").toLowerCase() === "supabase" && env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY");
}

export function getSupabaseAdmin() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    const err = new Error("missing_env_supabase");
    err.status = 500;
    throw err;
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

