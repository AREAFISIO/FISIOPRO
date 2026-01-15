import crypto from "node:crypto";
import { ensureRes } from "./_auth.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function verifyToken(token, secret) {
  const t = norm(token);
  const [body, sig] = t.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const json = Buffer.from(body, "base64url").toString("utf8");
    const payload = JSON.parse(json);
    if (!payload?.apptId) return null;
    if (payload?.exp && Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const secret = String(process.env.PATIENT_CONFIRM_SECRET || process.env.SESSION_SECRET || "").trim();
    if (!secret) return res.status(500).json({ ok: false, error: "missing_confirm_secret" });

    const token = norm(req.query?.t || req.body?.t);
    const payload = verifyToken(token, secret);
    if (!payload) return res.status(400).json({ ok: false, error: "invalid_or_expired" });

    if (!isSupabaseEnabled()) return res.status(500).json({ ok: false, error: "supabase_not_enabled" });
    const sb = getSupabaseAdmin();

    // GET: just validate token
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, apptId: payload.apptId });
    }

    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    // Mark appointment as confirmed by patient.
    const { data: appt, error: aErr } = await sb
      .from("appointments")
      .select("id,airtable_id,airtable_fields")
      .eq("airtable_id", String(payload.apptId))
      .maybeSingle();
    if (aErr) return res.status(500).json({ ok: false, error: `supabase_appointment_lookup_failed: ${aErr.message}` });
    if (!appt?.id) return res.status(404).json({ ok: false, error: "not_found" });

    const f0 = appt.airtable_fields && typeof appt.airtable_fields === "object" ? appt.airtable_fields : {};
    const f = { ...f0, "Confermato dal paziente": true, "Conferma del paziente": true };

    const { error: upErr } = await sb.from("appointments").update({ airtable_fields: f }).eq("id", appt.id);
    if (upErr) return res.status(500).json({ ok: false, error: `supabase_appointment_update_failed: ${upErr.message}` });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "server_error" });
  }
}

