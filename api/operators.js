import { airtableFetch, ensureRes, requireSession } from "./_auth.js";
import { memGetOrSet, setPrivateCache } from "./_common.js";

function pickName(fields) {
  const f = fields || {};
  const nome = String(f.Nome || "").trim();
  const cognome = String(f.Cognome || "").trim();
  const full = [nome, cognome].filter(Boolean).join(" ").trim();
  return (
    full ||
    String(f["Cognome e Nome"] || "").trim() ||
    String(f["Nome completo"] || "").trim() ||
    String(f.Name || "").trim() ||
    String(f["Full Name"] || "").trim() ||
    ""
  );
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    // Hot path for agenda: cache operators for a few minutes.
    setPrivateCache(res, 60);

    const tableName = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";
    const table = encodeURIComponent(tableName);

    // Only active physiotherapists (operators) by default.
    // Fields are aligned with auth-login.js: Attivo, Ruolo, Nome, Email
    const formula = `AND({Attivo}=1, OR({Ruolo}="Fisioterapista", {Ruolo}="Fisioterapista "))`;

    // Avoid sort-by-field errors if base differs; we sort in JS.
    const qs = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });

    const cacheKey = `operators:${tableName}:${formula}`;
    const items = await memGetOrSet(cacheKey, 5 * 60_000, async () => {
      const data = await airtableFetch(`${table}?${qs.toString()}`);
      return (data.records || [])
        .map((r) => {
          const f = r.fields || {};
          const name = String(pickName(f) || "").trim();
          if (!name) return null;
          return {
            id: r.id,
            name,
            email: String(f.Email || "").trim().toLowerCase(),
            role: String(f.Ruolo || "").trim(),
            active: Boolean(f.Attivo),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));
    });

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

