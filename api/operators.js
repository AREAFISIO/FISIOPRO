import { airtableFetch, ensureRes, requireSession } from "./_auth.js";

function pickName(fields) {
  const f = fields || {};
  return (
    f.Nome ||
    f["Cognome e Nome"] ||
    f["Nome completo"] ||
    f.Name ||
    f["Full Name"] ||
    ""
  );
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const tableName = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";
    const table = encodeURIComponent(tableName);

    // Only active physiotherapists (operators) by default.
    // Fields are aligned with auth-login.js: Attivo, Ruolo, Nome, Email
    const formula = `AND({Attivo}=1, OR({Ruolo}="Fisioterapista", {Ruolo}="Fisioterapista "))`;

    const qs = new URLSearchParams({
      filterByFormula: formula,
      pageSize: "100",
      "sort[0][field]": "Nome",
      "sort[0][direction]": "asc",
    });

    const data = await airtableFetch(`${table}?${qs.toString()}`);
    const items = (data.records || [])
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
      .filter(Boolean);

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

