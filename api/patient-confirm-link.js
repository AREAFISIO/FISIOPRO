import crypto from "node:crypto";
import { ensureRes, requireSession } from "./_auth.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
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
    const message = `Promemoria appuntamento.\n\nPer confermare clicca qui:\n${url}`;

    return res.status(200).json({ ok: true, url, message });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "server_error" });
  }
}

