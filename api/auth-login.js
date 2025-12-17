import { normalizeRole, signSession, setJson, makeSessionCookie } from "./_auth.js";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_COLLABORATORI_TABLE = "COLLABORATORI",
} = process.env;

export default async function handler(req, res) {
  if (req.method !== "POST") return setJson(res, 405, { ok: false, error: "method_not_allowed" });

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return setJson(res, 500, { ok: false, error: "missing_env_airtable" });
  }

  try {
    const email = String(req.body?.email || "").trim();
    const codice = String(req.body?.codice || "").trim();

    if (!email || !codice) return setJson(res, 400, { ok: false, error: "missing_fields" });

    const table = encodeURIComponent(AIRTABLE_COLLABORATORI_TABLE);
    const filter = encodeURIComponent(`LOWER({Email}) = LOWER("${email}")`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}?filterByFormula=${filter}&maxRecords=1`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });

    if (!r.ok) return setJson(res, 401, { ok: false, error: "invalid" });

    const data = await r.json();
    const rec = data.records?.[0];
    if (!rec) return setJson(res, 401, { ok: false, error: "invalid" });

    const f = rec.fields || {};
    const attivo = Boolean(f.Attivo);
    const ruolo = String(f.Ruolo || "").trim();
    const codiceDb = String(f["Codice accesso"] || "").trim();
    const nome = String(f.Nome || "").trim();

    const ruoloValido = ruolo === "Fisioterapista" || ruolo === "Front office" || ruolo === "Manager";
    if (!attivo || !ruoloValido || !codiceDb || codiceDb !== codice) {
      return setJson(res, 401, { ok: false, error: "invalid" });
    }

    const role = normalizeRole(ruolo);
    const maxAgeSeconds = 60 * 60 * 1; // 1 ora (GDPR-friendly)
    const exp = Date.now() + maxAgeSeconds * 1000;

    const token = signSession({
      email: email.toLowerCase(),
      role,
      roleLabel: ruolo,
      nome,
      exp,
    });

    const cookie = makeSessionCookie(token, maxAgeSeconds);

    const user = { email: email.toLowerCase(), role, roleLabel: ruolo, nome };
    return setJson(res, 200, { ok: true, user }, cookie);
  } catch (e) {
    return setJson(res, 500, { ok: false, error: "server_error" });
  }
}
