import { normalizeRole, signSession, setJson, makeSessionCookie } from "./_auth.js";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_COLLABORATORI_TABLE = "COLLABORATORI",
} = process.env;

function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

// Best-effort warm cache (helps if multiple logins or retries happen quickly).
const __loginLookupCache = new Map(); // email -> { ts:number, rec:any|null }
const CACHE_TTL_MS = 60_000;

async function fetchCollaboratorByEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email) return null;

  const cached = __loginLookupCache.get(email);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.rec;

  const table = encodeURIComponent(AIRTABLE_COLLABORATORI_TABLE);
  const formula = `LOWER({Email}) = LOWER("${escAirtableString(email)}")`;
  const qs = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
    pageSize: "1",
  });

  // Only fetch fields needed for login validation + display.
  ["Email", "Attivo", "Ruolo", "Codice accesso", "Nome"].forEach((f) => qs.append("fields[]", f));

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}?${qs.toString()}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
  });

  if (!r.ok) {
    // cache negative briefly to avoid hammering in case of repeated invalid attempts
    __loginLookupCache.set(email, { ts: Date.now(), rec: null });
    return null;
  }

  const data = await r.json().catch(() => ({}));
  const rec = data.records?.[0] || null;
  __loginLookupCache.set(email, { ts: Date.now(), rec });
  return rec;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return setJson(res, 405, { ok: false, error: "method_not_allowed" });

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return setJson(res, 500, { ok: false, error: "missing_env_airtable" });
  }

  try {
    const email = String(req.body?.email || "").trim();
    const codice = String(req.body?.codice || "").trim();

    if (!email || !codice) return setJson(res, 400, { ok: false, error: "missing_fields" });

    const rec = await fetchCollaboratorByEmail(email);
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
