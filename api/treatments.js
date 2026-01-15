import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc } from "./_common.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

// TRATTAMENTI (catalogo)
export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const tableName = process.env.AIRTABLE_TRATTAMENTI_TABLE || process.env.TREATMENTS_TABLE || "TRATTAMENTI";
    const fieldName = process.env.AIRTABLE_TRATTAMENTI_NAME_FIELD || "Nome trattamento";
    const fieldActive = process.env.AIRTABLE_TRATTAMENTI_ACTIVE_FIELD || "Attivo";

    const activeOnly = String(req.query?.activeOnly ?? "1") !== "0";
    const q = String(req.query?.q || "").trim().toLowerCase();

    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();
      // Read from raw records (catalog differs across bases).
      const { data: rows, error } = await sb
        .from("airtable_raw_records")
        .select("airtable_id,fields")
        .eq("table_name", tableName)
        .limit(2000);
      if (error) return res.status(500).json({ ok: false, error: `supabase_treatments_raw_failed: ${error.message}` });

      const q2 = q ? q.toLowerCase() : "";
      const items = (rows || [])
        .map((r) => {
          const f = (r.fields && typeof r.fields === "object") ? r.fields : {};
          const name = String(
            f[fieldName] ??
            f["Nome trattamento"] ??
            f["Tipo trattamento"] ??
            f["Trattamento"] ??
            f["Nome"] ??
            f["Name"] ??
            "",
          ).trim();
          if (!name) return null;
          const activeVal = f[fieldActive] ?? f.Attivo ?? f.Active ?? f.Abilitato ?? undefined;
          const active = activeVal === undefined ? true : Boolean(activeVal);
          return { id: String(r.airtable_id || ""), name, active };
        })
        .filter(Boolean)
        .filter((it) => (activeOnly ? Boolean(it.active) : true))
        .filter((it) => (q2 ? String(it.name || "").toLowerCase().includes(q2) : true))
        .sort((a, b) => a.name.localeCompare(b.name, "it"));

      return res.status(200).json({ ok: true, items });
    }

    const qs = new URLSearchParams({ pageSize: "100" });

    // optional filter: active + search
    const tableEnc = enc(tableName);
    // optional filter: active + search (best-effort; some bases have different field names)
    const filters = [];
    if (activeOnly) filters.push(`{${fieldActive}}=1`);
    if (q) {
      const qEsc = escAirtableString(q);
      filters.push(`FIND("${qEsc}", LOWER({${fieldName}}))`);
    }
    if (filters.length) qs.set("filterByFormula", `AND(${filters.join(",")})`);

    let data;
    try {
      data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
    } catch (e) {
      // Fallback when fieldActive/fieldName differ in the base:
      // - retry without filterByFormula (and without LOWER({fieldName}) references)
      if (isUnknownFieldError(e?.message)) {
        const qs2 = new URLSearchParams({ pageSize: "100" });
        data = await airtableFetch(`${tableEnc}?${qs2.toString()}`);
      } else {
        throw e;
      }
    }

    const q2 = q ? q.toLowerCase() : "";
    const items = (data.records || [])
      .map((r) => {
        const f = r.fields || {};
        const name = String(
          f[fieldName] ??
          f["Nome trattamento"] ??
          f["Trattamento"] ??
          f["Nome"] ??
          f["Name"] ??
          "",
        ).trim();
        if (!name) return null;
        const activeVal =
          f[fieldActive] ??
          f["Attivo"] ??
          f["Active"] ??
          f["Abilitato"] ??
          undefined;
        const active = activeVal === undefined ? true : Boolean(activeVal);
        return { id: r.id, name, active };
      })
      .filter(Boolean)
      .filter((it) => (activeOnly ? Boolean(it.active) : true))
      .filter((it) => (q2 ? String(it.name || "").toLowerCase().includes(q2) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "it"));

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}
