import { ensureRes, requireRoles } from "../_auth.js";
import { ficApiFetch, ficEnsureAccessToken, ficGetTokenRecord } from "../_fic.js";

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    // Use any stored token record; then refresh if needed.
    const rec = await ficGetTokenRecord({});
    const companyIdFromAirtable = String(rec?.fields?.["Company ID"] || "").trim();
    if (!companyIdFromAirtable) return res.status(409).json({ ok: false, error: "fic_not_connected" });

    const { accessToken } = await ficEnsureAccessToken({ companyId: companyIdFromAirtable });

    const info = await ficApiFetch("/v2/user/info", { method: "GET", accessToken });
    const companies = info?.data?.companies || info?.companies || [];

    const items = (companies || []).map((c) => ({
      id: String(c?.id ?? c?.company_id ?? "").trim(),
      name: String(c?.name || c?.company_name || "").trim(),
    })).filter((x) => x.id);

    return res.status(200).json({
      ok: true,
      items,
      hint: "Copia l'ID dell'azienda corretta e impostalo su Vercel come FIC_DEFAULT_COMPANY_ID, poi rifai 'Collega Fatture in Cloud'.",
    });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ ok: false, error: e?.message || "server_error" });
  }
}

