import { ensureRes, requireRoles } from "../../../_auth.js";
import { fetchWithTimeout } from "../../../_common.js";
import { ficApiFetch, ficEnsureAccessToken, fattureUpsertByFicDocumentId } from "../../../_fic.js";

function enc(x) {
  return encodeURIComponent(String(x ?? ""));
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "manager"]);
  if (!user) return;

  try {
    const documentId = String(req.query?.id || "").trim();
    if (!documentId) return res.status(400).json({ ok: false, error: "missing_id" });

    const download = String(req.query?.download || "").trim() === "1";

    const { companyId, accessToken } = await ficEnsureAccessToken();

    // Try direct PDF first (many FIC setups return application/pdf).
    const pdfResOrJson = await ficApiFetch(`/v2/entities/${enc(companyId)}/issued_documents/${enc(documentId)}/pdf`, {
      method: "GET",
      accessToken,
      headers: {
        Accept: "application/pdf, application/json",
      },
    });

    let pdfBuffer = null;

    if (pdfResOrJson && typeof pdfResOrJson.arrayBuffer === "function") {
      // It's a fetch Response (PDF)
      const ab = await pdfResOrJson.arrayBuffer();
      pdfBuffer = Buffer.from(ab);
    } else {
      // It's JSON (often contains a temporary URL)
      const url =
        String(pdfResOrJson?.data?.url || pdfResOrJson?.url || pdfResOrJson?.data?.attachment_url || "").trim();
      if (!url) return res.status(502).json({ ok: false, error: "pdf_url_missing" });

      const timeoutMs = Number(process.env.FIC_FETCH_TIMEOUT_MS || 25_000);
      const r = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);
      if (!r.ok) return res.status(502).json({ ok: false, error: `pdf_download_failed_${r.status}` });
      const ab = await r.arrayBuffer();
      pdfBuffer = Buffer.from(ab);

      // Save last temporary URL (optional trace)
      try {
        await fattureUpsertByFicDocumentId(documentId, {
          "PDF URL Temporaneo": url,
        });
      } catch {}
    }

    // Mark as downloaded/printed (best-effort)
    try {
      await fattureUpsertByFicDocumentId(documentId, {
        "PDF Scaricato": true,
      });
    } catch {}

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="fattura_${documentId}.pdf"`,
    );
    res.end(pdfBuffer);
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ ok: false, error: e?.message || "server_error" });
  }
}

