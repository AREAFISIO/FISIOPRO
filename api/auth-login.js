import { signSession } from "./_auth.js";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_COLLABORATORI_TABLE = "COLLABORATORI",
} = process.env;

function send(res, status, data, cookie) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "method_not_allowed" });

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return send(res, 500, { ok: false, error: "missing_env_airtable" });
  }

  try {
    // Vercel node functions: req.body c'è già se invii JSON
    const email = String(req.body?.email || "").trim();
    const codice = String(req.body?.codice || "").trim();

    if (!email || !codice) return send(res, 400, { ok: false, error: "missing_fields" });

    const table = encodeURIComponent(AIRTABLE_COLLABORATORI_TABLE);
    const filter = encodeURIComponent(`LOWER({Email}) = LOWER("${email}")`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}?filterByFormula=${filter}&maxRecords=1`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });

    if (!r.ok) return send(res, 401, { ok: false, error: "invalid" });

    const data = await r.json();
    const rec = data.records?.[0];
    if (!rec) return send(res, 401, { ok: false, error: "invalid" });

    const f = rec.fields || {};
    const attivo = Boolean(f.Attivo);
    const ruolo = String(f.Ruolo || "").trim();
    const codiceDb = String(f["Codice accesso"] || "").trim();
    const nome = String(f.Nome || "").trim();

    const ruoloValido = ruolo === "Fisioterapista" || ruolo === "Front office" || ruolo === "Manager";
    if (!attivo || !ruoloValido || !codiceDb || codiceDb !== codice) {
      return send(res, 401, { ok: false, error: "invalid" });
    }

    // Sessione firmata
    const token = signSession({ email, role: ruolo, nome });

    // Cookie SICURA (httpOnly, Secure, SameSite=Lax)
    const cookie = [
      `fp_session=${token}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${60 * 60 * 8}`, // 8 ore (meglio di 12 per sanità)
    ].join("; ");

    return send(res, 200, { ok: true, role: ruolo, nome }, cookie);
  } catch (e) {
    return send(res, 500, { ok: false, error: "server_error" });
  }
}
