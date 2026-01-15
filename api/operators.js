import { airtableFetch, ensureRes, requireRoles, requireSession } from "./_auth.js";
import { memGetOrSet, memSet, readJsonBody, setPrivateCache } from "./_common.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

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

function normalizeHexColor(s) {
  const x = String(s || "").trim();
  const m = x.match(/^#([0-9a-fA-F]{6})$/);
  return m ? ("#" + m[1].toUpperCase()) : "";
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

    // Hot path for agenda: cache operators for a few minutes.
    setPrivateCache(res, 60);

    const tableName = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";
    const table = encodeURIComponent(tableName);
    const COLOR_FIELD = String(process.env.AIRTABLE_COLLABORATORI_COLOR_FIELD || "Colore agenda").trim() || "Colore agenda";

    // Supabase fast-path
    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();

      if (req.method === "GET") {
        // Filter "active physiotherapists" using Airtable fields stored in JSON.
        // We keep this logic in JS because the dataset is small and bases vary.
        const { data, error } = await sb
          .from("collaborators")
          .select("id,airtable_id,name,airtable_fields")
          .limit(500);
        if (error) return res.status(500).json({ ok: false, error: `supabase_operators_failed: ${error.message}` });

        const items = (data || [])
          .map((r) => {
            const f = (r.airtable_fields && typeof r.airtable_fields === "object") ? r.airtable_fields : {};
            const ruolo = String(f.Ruolo || "").trim();
            const attivo = f.Attivo === undefined ? true : Boolean(f.Attivo);
            const email = String(f.Email || "").trim().toLowerCase();
            const color = normalizeHexColor(f[COLOR_FIELD] ?? "");
            return {
              id: String(r.airtable_id || ""), // UI expects Airtable record id
              name: String(r.name || "").trim(),
              email,
              role: ruolo,
              active: attivo,
              color,
            };
          })
          .filter((x) => x.name)
          .filter((x) => x.active)
          .filter((x) => String(x.role || "").includes("Fisioterapista"))
          .sort((a, b) => a.name.localeCompare(b.name, "it"));

        return res.status(200).json({ ok: true, items, colorField: COLOR_FIELD });
      }

      if (req.method === "PATCH") {
        const user = requireRoles(req, res, ["front", "manager"]);
        if (!user) return;

        const body = await readJsonBody(req);
        if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

        const colorsRaw = body.colors && typeof body.colors === "object" ? body.colors : null;
        const singleId = String(body.id || "").trim();
        const singleColor = normalizeHexColor(body.color);

        const pairs = [];
        if (colorsRaw) {
          for (const [id, c] of Object.entries(colorsRaw)) {
            const rid = String(id || "").trim();
            const col = normalizeHexColor(c);
            if (!rid || !col) continue;
            pairs.push([rid, col]);
          }
        } else if (singleId && singleColor) {
          pairs.push([singleId, singleColor]);
        }
        if (!pairs.length) return res.status(400).json({ ok: false, error: "missing_colors" });

        // Update collaborators.airtable_fields[COLOR_FIELD] in Supabase.
        for (const [airtableId, color] of pairs) {
          const { data: row, error: rowErr } = await sb
            .from("collaborators")
            .select("id,airtable_fields")
            .eq("airtable_id", airtableId)
            .maybeSingle();
          if (rowErr) return res.status(500).json({ ok: false, error: `supabase_operator_lookup_failed: ${rowErr.message}` });
          if (!row?.id) continue;
          const f = (row.airtable_fields && typeof row.airtable_fields === "object") ? { ...row.airtable_fields } : {};
          f[COLOR_FIELD] = color;
          const { error: upErr } = await sb.from("collaborators").update({ airtable_fields: f }).eq("id", row.id);
          if (upErr) return res.status(500).json({ ok: false, error: `supabase_operator_update_failed: ${upErr.message}` });
        }

        return res.status(200).json({ ok: true, updated: pairs.length, colorField: COLOR_FIELD });
      }

      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    // Only active physiotherapists (operators) by default.
    // Support both:
    // - single-select text: "Fisioterapista"
    // - multi-select / combined text: "CEO, Fisioterapista" / "CEO e Fisioterapista"
    // Fields are aligned with auth-login.js: Attivo, Ruolo, Nome, Email
    const formula = `AND({Attivo}=1, FIND("Fisioterapista", {Ruolo}&""))`;

    // Avoid sort-by-field errors if base differs; we sort in JS.
    const qs = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });

    const cacheKey = `operators:${tableName}:${formula}`;
    if (req.method === "GET") {
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
              color: normalizeHexColor(f[COLOR_FIELD] ?? ""),
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name, "it"));
      });
      return res.status(200).json({ ok: true, items, colorField: COLOR_FIELD });
    }

    if (req.method === "PATCH") {
      // Only Front office and Manager can change operator colors (shared across devices).
      const user = requireRoles(req, res, ["front", "manager"]);
      if (!user) return;

      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      // Accept:
      // - { id, color }
      // - { colors: { [operatorId]: "#RRGGBB" } }
      const colorsRaw = body.colors && typeof body.colors === "object" ? body.colors : null;
      const singleId = String(body.id || "").trim();
      const singleColor = normalizeHexColor(body.color);

      const pairs = [];
      if (colorsRaw) {
        for (const [id, c] of Object.entries(colorsRaw)) {
          const rid = String(id || "").trim();
          const col = normalizeHexColor(c);
          if (!rid || !col) continue;
          pairs.push([rid, col]);
        }
      } else if (singleId && singleColor) {
        pairs.push([singleId, singleColor]);
      }

      if (!pairs.length) {
        return res.status(400).json({ ok: false, error: "missing_colors" });
      }

      // Airtable batch update supports max 10 records per call.
      const chunks = [];
      for (let i = 0; i < pairs.length; i += 10) chunks.push(pairs.slice(i, i + 10));

      for (const chunk of chunks) {
        const records = chunk.map(([id, color]) => ({
          id,
          fields: { [COLOR_FIELD]: color },
        }));
        await airtableFetch(`${table}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records }),
        });
      }

      // Invalidate warm-instance cache so next GET returns the new colors immediately.
      memSet(cacheKey, undefined, 1_000);

      return res.status(200).json({ ok: true, updated: pairs.length, colorField: COLOR_FIELD });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

