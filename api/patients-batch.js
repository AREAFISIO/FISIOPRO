import { requireSession } from "./_auth.js";
import { fetchWithTimeout } from "./_common.js";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_PATIENTS_TABLE = "ANAGRAFICA",
} = process.env;

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  const session = requireSession(req);
  if (!session) return send(res, 401, { ok: false, error: "unauthorized" });

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return send(res, 500, { ok: false, error: "missing_env_airtable" });
  }

  try {
    const urlObj = new URL(req.url, `https://${req.headers.host}`);
    const idsParam = String(urlObj.searchParams.get("ids") || "").trim();
    if (!idsParam) return send(res, 400, { ok: false, error: "missing_ids" });

    const ids = idsParam
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 50); // sicurezza

    if (!ids.length) return send(res, 400, { ok: false, error: "missing_ids" });

    // filterByFormula: OR(RECORD_ID()='rec1', RECORD_ID()='rec2', ...)
    const orParts = ids.map((id) => `RECORD_ID()="${id}"`);
    const formula = `OR(${orParts.join(",")})`;

    const table = encodeURIComponent(AIRTABLE_PATIENTS_TABLE);
    const apiUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}` +
      `?filterByFormula=${encodeURIComponent(formula)}` +
      `&pageSize=50`;

    const timeoutMs = Number(process.env.AIRTABLE_FETCH_TIMEOUT_MS || 20_000);
    const r = await fetchWithTimeout(apiUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    }, timeoutMs);

    if (!r.ok) {
      const t = await r.text();
      return send(res, 500, { ok: false, error: "airtable_error", detail: t });
    }

    const data = await r.json();
    const records = (data.records || []).map((rec) => {
      const f = rec.fields || {};
      return {
        id: rec.id,
        fields: f,
      };
    });

    return send(res, 200, { ok: true, records });
  } catch (e) {
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
