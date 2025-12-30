import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { enc, memGetOrSet, setPrivateCache } from "./_common.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const s = norm(x);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function normalizeKeyLoose(s) {
  // "Voce agenda" ~ "Voce Agenda" ~ "voce_agenda"
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function resolveFieldKeyFromRecord(fieldsObj, candidates) {
  const f = fieldsObj || {};
  const keys = Object.keys(f);
  if (!keys.length) return "";

  const byLower = new Map(keys.map((k) => [k.toLowerCase(), k]));
  for (const c of candidates || []) {
    const want = norm(c);
    if (!want) continue;
    const hit = byLower.get(want.toLowerCase());
    if (hit) return hit;
  }

  const keysLoose = new Map(keys.map((k) => [normalizeKeyLoose(k), k]));
  for (const c of candidates || []) {
    const wantLoose = normalizeKeyLoose(c);
    if (!wantLoose) continue;
    const hit = keysLoose.get(wantLoose);
    if (hit) return hit;
  }

  return "";
}

async function getFieldsFromMeta(tableName) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return [];
  const url = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(AIRTABLE_BASE_ID)}/tables`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    if (!res.ok) return [];
    const tables = json.tables || [];
    const wanted = String(tableName || "").trim();
    const t =
      tables.find((x) => String(x?.name || "") === wanted) ||
      tables.find((x) => String(x?.name || "").toLowerCase() === wanted.toLowerCase()) ||
      null;
    return (t?.fields || []).filter(Boolean);
  } catch {
    return [];
  }
}

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

async function sampleDistinctValues({ tableEnc, fieldCandidates, maxPages = 6 }) {
  const out = new Set();
  const candidates = uniq(fieldCandidates);
  const primary = candidates[0] || "";

  // 1) Try with fields[] using the first candidate that Airtable accepts.
  for (const cand of candidates) {
    let offset = null;
    let pages = 0;
    let fieldOk = false;
    while (pages < maxPages) {
      pages += 1;
      const qs = new URLSearchParams({ pageSize: "100" });
      if (offset) qs.set("offset", offset);
      qs.append("fields[]", cand);

      let data;
      try {
        data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
        fieldOk = true;
      } catch (e) {
        // If field doesn't exist (often due to case differences or renamed fields), try next candidate.
        if (isUnknownFieldError(e?.message)) {
          fieldOk = false;
          break;
        }
        throw e;
      }

      for (const r of data.records || []) {
        const f = r.fields || {};
        const v = f[cand];
        if (typeof v === "string") {
          const s = v.trim();
          if (s) out.add(s);
        } else if (Array.isArray(v)) {
          for (const x of v) {
            if (typeof x !== "string") continue;
            const s = x.trim();
            if (s) out.add(s);
          }
        }
      }

      offset = data.offset || null;
      if (!offset) break;
      if (out.size >= 150) break;
    }

    if (fieldOk) {
      return {
        values: Array.from(out).sort((a, b) => a.localeCompare(b, "it")),
        resolvedField: cand,
        fieldFound: true,
      };
    }
  }

  // 2) Fallback: fetch without fields[] and infer the actual field key from returned records.
  out.clear();
  let offset = null;
  let pages = 0;
  let resolvedKey = "";
  while (pages < maxPages) {
    pages += 1;
    const qs = new URLSearchParams({ pageSize: "100" });
    if (offset) qs.set("offset", offset);
    const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);

    for (const r of data.records || []) {
      const f = r.fields || {};
      if (!resolvedKey) resolvedKey = resolveFieldKeyFromRecord(f, candidates);
      const k = resolvedKey || primary;
      const v = k ? f[k] : undefined;
      if (typeof v === "string") {
        const s = v.trim();
        if (s) out.add(s);
      } else if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x !== "string") continue;
          const s = x.trim();
          if (s) out.add(s);
        }
      }
    }

    offset = data.offset || null;
    if (!offset) break;
    if (out.size >= 150) break;
  }

  return {
    values: Array.from(out).sort((a, b) => a.localeCompare(b, "it")),
    resolvedField: resolvedKey || "",
    fieldFound: Boolean(resolvedKey),
  };
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    setPrivateCache(res, 60);

    const tableName = norm(req.query?.table || process.env.AGENDA_TABLE || "APPUNTAMENTI");
    const requestedField = norm(req.query?.field);
    if (!requestedField) return res.status(400).json({ ok: false, error: "missing_field" });

    // Allow renamed fields via env overrides (keeps frontend stable).
    const candidates = [requestedField];
    const reqLower = requestedField.toLowerCase();
    if (reqLower === "voce agenda" || reqLower === "voce_agenda" || reqLower === "voceagenda") {
      candidates.push(process.env.AGENDA_VOCE_AGENDA_FIELD || process.env.AGENDA_TYPE_FIELD || "");
    }
    if (reqLower === "stato appuntamento" || reqLower === "stato_appuntamento" || reqLower === "statoappuntamento") {
      candidates.push(process.env.AGENDA_STATUS_FIELD || "");
    }
    const fieldCandidates = uniq(candidates);

    const cacheKey = `fieldOptions:${tableName}:${fieldCandidates.join("|")}`;
    const items = await memGetOrSet(cacheKey, 10 * 60_000, async () => {
      // 1) Try Meta API for true single-select choices.
      const metaFields = await getFieldsFromMeta(tableName);
      for (const cand of fieldCandidates) {
        const meta =
          metaFields.find((f) => String(f?.name || "") === cand) ||
          metaFields.find((f) => String(f?.name || "").toLowerCase() === cand.toLowerCase()) ||
          null;
        const choices = meta?.options?.choices || meta?.typeOptions?.choices || [];
        if (Array.isArray(choices) && choices.length) {
          const vals = choices.map((c) => norm(c?.name)).filter(Boolean);
          if (vals.length) return vals;
        }
      }

      // 2) Fallback: sample record values.
      const tableEnc = enc(tableName);
      const sampled = await sampleDistinctValues({ tableEnc, fieldCandidates });
      if (!sampled.fieldFound) {
        const err = new Error(`Field not found: ${requestedField}`);
        err.status = 404;
        err.details = { table: tableName, requestedField, tried: fieldCandidates };
        throw err;
      }
      return sampled.values;
    });

    return res.status(200).json({ ok: true, items: (items || []).map((name) => ({ id: name, name })) });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error", details: e.details || undefined });
  }
}

