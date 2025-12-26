import { normalizeRole, signSession, setJson, makeSessionCookie } from "./_auth.js";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_COLLABORATORI_TABLE = "COLLABORATORI",
} = process.env;

function normalizeRequestedRole(raw) {
  const r = String(raw || "").trim().toLowerCase();
  if (!r) return "";
  if (r === "physio" || r === "fisioterapista") return "physio";
  if (r === "front" || r === "front-office" || r === "front office") return "front";
  if (r === "ceo") return "manager";
  if (r === "manager" || r === "admin" || r === "amministratore") return "manager";
  return "";
}

function roleLabelFor(normalized) {
  if (normalized === "physio") return "Fisioterapista";
  if (normalized === "front") return "Front office";
  if (normalized === "manager") return "CEO";
  return "";
}

function pickName(fields) {
  const f = fields || {};
  const nome = String(f.Nome || "").trim();
  const cognome = String(f.Cognome || "").trim();
  return [nome, cognome].filter(Boolean).join(" ").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return setJson(res, 405, { ok: false, error: "method_not_allowed" });

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return setJson(res, 500, { ok: false, error: "missing_env_airtable" });
  }

  try {
    const email = String(req.body?.email || "").trim();
    const codice = String(req.body?.codice || "").trim();
    const requestedRole = normalizeRequestedRole(req.body?.asRole || req.body?.role);

    if (!email || !codice) return setJson(res, 400, { ok: false, error: "missing_fields" });

    const table = encodeURIComponent(AIRTABLE_COLLABORATORI_TABLE);
    // Fetch all matching records for the same email (some users may have multiple roles).
    const filterFormula = `LOWER({Email}) = LOWER("${email}")`;
    const filter = encodeURIComponent(filterFormula);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${table}?filterByFormula=${filter}&pageSize=10&maxRecords=10`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });

    if (!r.ok) return setJson(res, 401, { ok: false, error: "invalid" });

    const data = await r.json();
    const records = Array.isArray(data.records) ? data.records : [];
    if (!records.length) return setJson(res, 401, { ok: false, error: "invalid" });

    // Keep only records that are active + have matching access code.
    const valid = records
      .map((rec) => {
        const f = rec?.fields || {};
        const attivo = Boolean(f.Attivo);
        const ruoloLabel = String(f.Ruolo || "").trim();
        const ruolo = normalizeRole(ruoloLabel);
        const codiceDb = String(f["Codice accesso"] || "").trim();
        if (!attivo || !codiceDb || codiceDb !== codice) return null;
        // Allowed roles in the app (CEO maps to manager)
        if (!ruolo || !["physio", "front", "manager"].includes(ruolo)) return null;
        return {
          id: rec.id,
          fields: f,
          role: ruolo,
          roleLabel: ruoloLabel || roleLabelFor(ruolo),
          nome: String(f.Nome || "").trim(),
          cognome: String(f.Cognome || "").trim(),
        };
      })
      .filter(Boolean);

    if (!valid.length) return setJson(res, 401, { ok: false, error: "invalid" });

    // Pick the role to use:
    // - If requestedRole is provided, pick a matching record when possible.
    // - Safe downgrade is allowed (e.g., Manager can login as Physio).
    // - Privilege escalation is NOT allowed without an explicit matching record.
    let chosen = null;
    if (requestedRole) {
      chosen = valid.find((x) => x.role === requestedRole) || null;
      if (!chosen && requestedRole === "physio") {
        // downgrade: allow manager/front to login as physio (same credentials).
        chosen = valid.find((x) => x.role === "manager") || valid.find((x) => x.role === "front") || null;
        if (chosen) {
          chosen = {
            ...chosen,
            role: "physio",
            roleLabel: roleLabelFor("physio"),
          };
        }
      }
      if (!chosen && requestedRole === "front") {
        // downgrade: allow manager to login as front.
        chosen = valid.find((x) => x.role === "manager") || null;
        if (chosen) {
          chosen = {
            ...chosen,
            role: "front",
            roleLabel: roleLabelFor("front"),
          };
        }
      }
      if (!chosen) return setJson(res, 401, { ok: false, error: "invalid" });
    } else {
      // default: least privileged first (physio -> front -> manager)
      chosen = valid.find((x) => x.role === "physio") || valid.find((x) => x.role === "front") || valid.find((x) => x.role === "manager") || null;
      if (!chosen) return setJson(res, 401, { ok: false, error: "invalid" });
    }

    const role = normalizeRole(chosen.role);
    const maxAgeSeconds = 60 * 60 * 1; // 1 ora (GDPR-friendly)
    const exp = Date.now() + maxAgeSeconds * 1000;

    const token = signSession({
      email: email.toLowerCase(),
      role,
      roleLabel: chosen.roleLabel || roleLabelFor(role),
      nome: chosen.nome || pickName(chosen.fields) || "",
      cognome: chosen.cognome || "",
      exp,
    });

    const cookie = makeSessionCookie(token, maxAgeSeconds);

    const user = {
      email: email.toLowerCase(),
      role,
      roleLabel: chosen.roleLabel || roleLabelFor(role),
      nome: chosen.nome || "",
      cognome: chosen.cognome || "",
    };
    return setJson(res, 200, { ok: true, user }, cookie);
  } catch (e) {
    return setJson(res, 500, { ok: false, error: "server_error" });
  }
}
