import crypto from "node:crypto";
import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { readJsonBody, setPrivateCache } from "./_common.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeHexColor(s) {
  const x = String(s || "").trim();
  const m = x.match(/^#([0-9a-fA-F]{6})$/);
  return m ? ("#" + m[1].toUpperCase()) : "";
}

function makeSyntheticRecId() {
  try {
    return `rec_${crypto.randomUUID()}`;
  } catch {
    return `rec_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function roleLabelNormalize(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low.includes("ceo") || low.includes("manager") || low.includes("admin")) return "CEO";
  if (low.includes("back") || low.includes("segreteria") || low.includes("amministr")) return "Back office";
  if (low.includes("front")) return "Front office";
  if (low.includes("fisioterap") || low.includes("physio")) return "Fisioterapista";
  return s;
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["manager"]);
  if (!user) return;

  try {
    setPrivateCache(res, 0);

    const tableName = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";
    const tableEnc = encodeURIComponent(tableName);
    const COLOR_FIELD = String(process.env.AIRTABLE_COLLABORATORI_COLOR_FIELD || "Colore agenda").trim() || "Colore agenda";

    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();

      if (req.method === "GET") {
        const { data, error } = await sb
          .from("collaborators")
          .select("id,airtable_id,name,role,airtable_fields")
          .limit(2000);
        if (error) return res.status(500).json({ ok: false, error: `supabase_collaborators_failed: ${error.message}` });

        const items = (data || [])
          .map((r) => {
            const f = (r.airtable_fields && typeof r.airtable_fields === "object") ? r.airtable_fields : {};
            const roleLabel = roleLabelNormalize(r.role || f.Ruolo || "");
            const active = f.Attivo === undefined ? true : Boolean(f.Attivo);
            const email = String(f.Email || "").trim().toLowerCase();
            const color = normalizeHexColor(f[COLOR_FIELD] ?? "");
            return {
              id: String(r.airtable_id || ""),
              name: String(r.name || "").trim(),
              email,
              roleLabel,
              active,
              color,
            };
          })
          .filter((x) => x.id && x.name)
          .sort((a, b) => a.name.localeCompare(b.name, "it"));

        return res.status(200).json({ ok: true, items, colorField: COLOR_FIELD });
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

        const name = norm(body.name);
        const email = norm(body.email).toLowerCase();
        const roleLabel = roleLabelNormalize(body.roleLabel || body.role || "");
        const active = body.active === undefined ? true : Boolean(body.active);

        if (!name) return res.status(400).json({ ok: false, error: "missing_name" });
        if (!email) return res.status(400).json({ ok: false, error: "missing_email" });
        if (!roleLabel) return res.status(400).json({ ok: false, error: "missing_role" });

        const airtableId = makeSyntheticRecId();
        const fields = {
          ...(typeof body.fields === "object" && body.fields ? body.fields : {}),
          Email: email,
          Ruolo: roleLabel,
          Attivo: active,
        };

        const { data, error } = await sb
          .from("collaborators")
          .insert({ airtable_id: airtableId, name, role: roleLabel, airtable_fields: fields })
          .select("airtable_id")
          .maybeSingle();
        if (error) return res.status(500).json({ ok: false, error: `supabase_collaborator_create_failed: ${error.message}` });

        return res.status(200).json({ ok: true, id: data?.airtable_id || airtableId });
      }

      if (req.method === "PATCH") {
        const body = await readJsonBody(req);
        if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

        const id = norm(body.id);
        if (!id) return res.status(400).json({ ok: false, error: "missing_id" });

        const { data: row, error: rowErr } = await sb
          .from("collaborators")
          .select("id,airtable_fields")
          .eq("airtable_id", id)
          .maybeSingle();
        if (rowErr) return res.status(500).json({ ok: false, error: `supabase_collaborator_lookup_failed: ${rowErr.message}` });
        if (!row?.id) return res.status(404).json({ ok: false, error: "not_found" });

        const nextName = body.name !== undefined ? norm(body.name) : "";
        const nextEmail = body.email !== undefined ? norm(body.email).toLowerCase() : "";
        const nextRole = body.roleLabel !== undefined ? roleLabelNormalize(body.roleLabel) : (body.role !== undefined ? roleLabelNormalize(body.role) : "");
        const nextActive = body.active !== undefined ? Boolean(body.active) : undefined;

        const f = (row.airtable_fields && typeof row.airtable_fields === "object") ? { ...row.airtable_fields } : {};
        if (nextEmail) f.Email = nextEmail;
        if (nextRole) f.Ruolo = nextRole;
        if (nextActive !== undefined) f.Attivo = Boolean(nextActive);

        const patch = { airtable_fields: f };
        if (body.name !== undefined) patch.name = nextName;
        if (nextRole) patch.role = nextRole;

        const { error: upErr } = await sb.from("collaborators").update(patch).eq("id", row.id);
        if (upErr) return res.status(500).json({ ok: false, error: `supabase_collaborator_update_failed: ${upErr.message}` });

        return res.status(200).json({ ok: true });
      }

      if (req.method === "DELETE") {
        const body = await readJsonBody(req);
        if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });
        const id = norm(body.id);
        if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
        // Soft-delete: just mark inactive.
        const { data: row, error: rowErr } = await sb
          .from("collaborators")
          .select("id,airtable_fields")
          .eq("airtable_id", id)
          .maybeSingle();
        if (rowErr) return res.status(500).json({ ok: false, error: `supabase_collaborator_lookup_failed: ${rowErr.message}` });
        if (!row?.id) return res.status(404).json({ ok: false, error: "not_found" });
        const f = (row.airtable_fields && typeof row.airtable_fields === "object") ? { ...row.airtable_fields } : {};
        f.Attivo = false;
        const { error: upErr } = await sb.from("collaborators").update({ airtable_fields: f }).eq("id", row.id);
        if (upErr) return res.status(500).json({ ok: false, error: `supabase_collaborator_update_failed: ${upErr.message}` });
        return res.status(200).json({ ok: true });
      }

      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    // Airtable fallback (Manager-only)
    if (req.method === "GET") {
      const qs = new URLSearchParams({ pageSize: "200" });
      const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
      const items = (data.records || [])
        .map((r) => {
          const f = r.fields || {};
          return {
            id: r.id,
            name: String(f.Nome || f["Cognome e Nome"] || f.Name || "").trim(),
            email: String(f.Email || "").trim().toLowerCase(),
            roleLabel: roleLabelNormalize(f.Ruolo || ""),
            active: f.Attivo === undefined ? true : Boolean(f.Attivo),
            color: normalizeHexColor(f[COLOR_FIELD] ?? ""),
          };
        })
        .filter((x) => x.id && x.name)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));
      return res.status(200).json({ ok: true, items, colorField: COLOR_FIELD });
    }

    const body = await readJsonBody(req);
    if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

    if (req.method === "POST") {
      const name = norm(body.name);
      const email = norm(body.email).toLowerCase();
      const roleLabel = roleLabelNormalize(body.roleLabel || body.role || "");
      const active = body.active === undefined ? true : Boolean(body.active);
      if (!name) return res.status(400).json({ ok: false, error: "missing_name" });
      if (!email) return res.status(400).json({ ok: false, error: "missing_email" });
      if (!roleLabel) return res.status(400).json({ ok: false, error: "missing_role" });

      const created = await airtableFetch(`${tableEnc}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: { Nome: name, Email: email, Ruolo: roleLabel, Attivo: active },
        }),
      });
      return res.status(200).json({ ok: true, id: created?.id || "" });
    }

    if (req.method === "PATCH" || req.method === "DELETE") {
      const id = norm(body.id);
      if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
      const fields = {};
      if (body.name !== undefined) fields.Nome = norm(body.name);
      if (body.email !== undefined) fields.Email = norm(body.email).toLowerCase();
      if (body.roleLabel !== undefined || body.role !== undefined) fields.Ruolo = roleLabelNormalize(body.roleLabel || body.role || "");
      if (body.active !== undefined) fields.Attivo = Boolean(body.active);
      if (req.method === "DELETE") fields.Attivo = false;
      await airtableFetch(`${tableEnc}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

