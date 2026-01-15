import crypto from "node:crypto";
import { ensureRes, requireSession } from "./_auth.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function formatItShort(iso) {
  const s = norm(iso);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";

  const tz = String(process.env.CLINIC_TIMEZONE || "Europe/Rome").trim() || "Europe/Rome";
  try {
    const parts = new Intl.DateTimeFormat("it-IT", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const wk = get("weekday");
    const day = get("day");
    const mo = get("month");
    const hr = get("hour");
    const mi = get("minute");
    const wkCap = wk ? wk.charAt(0).toUpperCase() + wk.slice(1) : "";
    if (wkCap && day && mo && hr && mi) return `${wkCap} ${day}/${mo} ore ${hr}:${mi}`;
  } catch {
    // ignore
  }

  // Fallback (UTC-ish)
  const w = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"][d.getUTCDay()] || "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${w} ${dd}/${mm} ore ${hh}:${mi}`;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function signToken(payload, secret) {
  const json = JSON.stringify(payload);
  const body = b64url(json);
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export default async function handler(req, res) {
  ensureRes(res);
  const session = requireSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const apptId = norm(req.query?.id);
    if (!apptId) return res.status(400).json({ ok: false, error: "missing_id" });

    const secret = String(process.env.PATIENT_CONFIRM_SECRET || process.env.SESSION_SECRET || "").trim();
    if (!secret) return res.status(500).json({ ok: false, error: "missing_confirm_secret" });

    const expMs = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 giorni
    const token = signToken({ v: 1, apptId, exp: expMs }, secret);

    const origin =
      String(req.headers["x-forwarded-proto"] || "https") +
      "://" +
      String(req.headers["x-forwarded-host"] || req.headers.host || "");

    const url = `${origin}/confirm.html?t=${encodeURIComponent(token)}`;

    // Best-effort enrich message from Supabase (faster + already migrated).
    let header = "Promemoria appuntamento";
    let when = "";
    let meta = "";
    try {
      if (isSupabaseEnabled()) {
        const sb = getSupabaseAdmin();
        const { data: a } = await sb
          .from("appointments")
          .select("start_at,airtable_fields,patients:patients(label),collaborators:collaborators(name),services:services(name)")
          .eq("airtable_id", apptId)
          .maybeSingle();
        const f = a?.airtable_fields && typeof a.airtable_fields === "object" ? a.airtable_fields : {};
        const patientName = norm(f["Paziente"] || a?.patients?.label || "");
        const startISO = a?.start_at || f["Data e ora INIZIO"] || "";
        when = formatItShort(startISO);
        const serviceName = norm(a?.services?.name || "");
        const therapistName = norm(a?.collaborators?.name || "");
        const parts = [serviceName, therapistName].filter(Boolean);
        meta = parts.join(" • ");
        if (patientName) header = `Promemoria appuntamento: ${patientName}`;
      }
    } catch {
      // ignore
    }

    const lines = [
      `${header}.`,
      when ? when + (meta ? ` • ${meta}` : "") : "",
      "",
      "Per confermare clicca qui:",
      url,
    ].filter((x) => String(x).trim() !== "");

    const message = lines.join("\n");

    return res.status(200).json({ ok: true, url, message });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "server_error" });
  }
}

