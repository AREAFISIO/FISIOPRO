import { fetchWithTimeout } from "./_common.js";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_RICHIESTE_TABLE = "RICHIESTE_ACCESSO",
} = process.env;

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "method_not_allowed" });

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return send(res, 500, { ok: false, error: "missing_env_airtable" });
  }

  try {
    const email = String(req.body?.email || "").trim();
    if (!email) return send(res, 400, { ok: false, error: "missing_email" });

    const table = encodeURIComponent(AIRTABLE_RICHIESTE_TABLE);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}`;

    const payload = {
      records: [
        {
          fields: {
            Email: email,
            Data: new Date().toISOString(),
            Stato: "Nuova"
          }
        }
      ]
    };

    const timeoutMs = Number(process.env.AIRTABLE_FETCH_TIMEOUT_MS || 20_000);
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, timeoutMs);

    if (!r.ok) return send(res, 500, { ok: false, error: "airtable_write_failed" });

    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
