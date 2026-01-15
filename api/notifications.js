import { ensureRes, requireRoles } from "./_auth.js";
import { setPrivateCache } from "./_common.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "back", "manager"]);
  if (!user) return;

  try {
    setPrivateCache(res, 10);

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    // v0: UI scaffold only.
    // Next step (when you confirm): connect to a real provider log (Brevo/Twilio/WhatsApp Cloud API)
    // or to a Supabase table `notifications` to store sends and status updates.

    const year = norm(req.query?.year);
    const month = norm(req.query?.month);
    const channel = norm(req.query?.channel);
    const q = norm(req.query?.q);
    const onlyFailed = String(req.query?.onlyFailed || "") === "1";
    const onlyScheduled = String(req.query?.onlyScheduled || "") === "1";

    void year; void month; void channel; void q; void onlyFailed; void onlyScheduled;

    return res.status(200).json({
      ok: true,
      summary: {
        email: { sent: 0, error: 0, read: 0, scheduled: 0 },
        sms: { sent: 0, error: 0, available: 0, scheduled: 0 },
        whatsapp: { sent: 0, error: 0, available: 0, scheduled: 0 },
      },
      items: [],
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

