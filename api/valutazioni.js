import { ensureRes, requireRoles } from "./_auth.js";
import { norm, readJsonBody } from "./_common.js";
import {
  airtableCreate,
  airtableGet,
  airtableList,
  airtableUpdate,
  escAirtableString as esc,
  resolveLinkedIds,
} from "../lib/airtableClient.js";

function parseIsoOrEmpty(v, label) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`invalid_${label}`);
    err.status = 400;
    throw err;
  }
  return d.toISOString();
}

function isWriteBlockedFieldName(fieldName) {
  const k = String(fieldName || "").trim();
  if (!k) return true;
  const low = k.toLowerCase();
  if (k === "...") return true;
  if (low.includes("copy")) return true;
  // Lookup/Rollup: read-only (e.g. "Nome (from ...)", "Stato (from ...)")
  if (/\(from\s.+\)/i.test(k)) return true;
  return false;
}

function looksLikeRecordId(s) {
  return typeof s === "string" && s.startsWith("rec");
}

function isLikelyTypeError(e) {
  const msg = String(e?.message || "").toLowerCase();
  return (
    msg.includes("invalid value") ||
    msg.includes("cannot parse") ||
    msg.includes("expects") ||
    msg.includes("not a valid") ||
    msg.includes("field") && msg.includes("type")
  );
}

async function resolveMaybeLink({ table, value, allowMissing = true }) {
  const v = Array.isArray(value) ? value[0] : value;
  const s = String(v ?? "").trim();
  if (!s) return { kind: "empty", recordIds: [], text: "" };
  if (looksLikeRecordId(s)) return { kind: "link", recordIds: [s], text: s };
  const ids = await resolveLinkedIds({ table, values: s, allowMissing });
  if (ids.length) return { kind: "link", recordIds: [ids[0]], text: s };
  return { kind: "text", recordIds: [], text: s };
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "manager"]);
  if (!user) return;

  try {
    if (req.method === "GET") {
      const recordIdPaziente = norm(req.query?.recordIdPaziente || req.query?.paziente);
      const collaboratore = norm(req.query?.collaboratore);
      const fromISO = parseIsoOrEmpty(req.query?.from, "from");
      const toISO = parseIsoOrEmpty(req.query?.to, "to");

      const parts = [];

      if (fromISO) parts.push(`{Data valutazione} >= DATETIME_PARSE("${esc(fromISO)}")`);
      if (toISO) parts.push(`{Data valutazione} <= DATETIME_PARSE("${esc(toISO)}")`);

      if (recordIdPaziente) {
        const [pazId] = await resolveLinkedIds({ table: "ANAGRAFICA", values: recordIdPaziente });
        parts.push(`FIND("${esc(pazId)}", ARRAYJOIN({Paziente}))`);
      }
      if (collaboratore) {
        const [colId] = await resolveLinkedIds({ table: "COLLABORATORI", values: collaboratore });
        parts.push(`FIND("${esc(colId)}", ARRAYJOIN({Collaboratore}))`);
      }

      const filterByFormula = parts.length ? `AND(${parts.join(",")})` : "";

      const { records } = await airtableList("VALUTAZIONI", {
        filterByFormula,
        maxRecords: 500,
        sort: [{ field: "Data valutazione", direction: "desc" }],
        fields: [
          "Valutazione",
          "ID Valutazione",
          "Data valutazione",
          "Tipo valutazione",
          "Paziente",
          "Collaboratore",
          "Caso clinico",
          "Appuntamento",
          "Erogato",
          "Patologia principale",
          "Scale",
          "Indicazioni percorso",
        ],
      });

      return res.status(200).json({
        ok: true,
        records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const payload = body.valutazione || body;
      const recordId = norm(payload.recordId || payload.id);

      // Accept either a direct Airtable {fields} payload or a flattened object.
      const rawFields = payload.fields && typeof payload.fields === "object" ? payload.fields : payload;
      const fields = {};
      for (const [k, v] of Object.entries(rawFields || {})) {
        if (k === "recordId" || k === "id" || k === "createdTime") continue;
        if (isWriteBlockedFieldName(k)) continue;
        fields[k] = v;
      }

      // Ensure linked records are arrays of record IDs.
      const pazienteInfo = await resolveMaybeLink({ table: "ANAGRAFICA", value: fields["Paziente"], allowMissing: false });
      if (pazienteInfo.kind === "link") fields["Paziente"] = pazienteInfo.recordIds;

      const collInfo = await resolveMaybeLink({ table: "COLLABORATORI", value: fields["Collaboratore"], allowMissing: false });
      if (collInfo.kind === "link") fields["Collaboratore"] = collInfo.recordIds;

      const casoInfo = await resolveMaybeLink({ table: "CASI CLINICI", value: fields["Caso clinico"], allowMissing: true });
      if (casoInfo.kind === "link") fields["Caso clinico"] = casoInfo.recordIds;

      const apptInfo = await resolveMaybeLink({ table: "APPUNTAMENTI", value: fields["Appuntamento"], allowMissing: true });
      if (apptInfo.kind === "link") fields["Appuntamento"] = apptInfo.recordIds;

      const erogInfo = await resolveMaybeLink({ table: "EROGATO", value: fields["Erogato"], allowMissing: true });
      if (erogInfo.kind === "link") fields["Erogato"] = erogInfo.recordIds;

      // Patologia principale can be LINK or TEXT depending on base
      const patInfo = await resolveMaybeLink({ table: "PATOLOGIE ORTOPEDICHE", value: fields["Patologia principale"], allowMissing: true });
      if (patInfo.kind === "link") fields["Patologia principale"] = patInfo.recordIds;

      // Write with a single fallback attempt for link-vs-text mismatches on optional fields.
      async function writeOnce(f) {
        if (recordId) return await airtableUpdate("VALUTAZIONI", recordId, f);
        return await airtableCreate("VALUTAZIONI", f);
      }

      let out;
      try {
        out = await writeOnce(fields);
      } catch (e) {
        if (!isLikelyTypeError(e)) throw e;
        // Fallback: convert optional link-ish fields back to plain text when the base uses TEXT.
        const f2 = { ...fields };
        if (patInfo.kind === "text") f2["Patologia principale"] = patInfo.text;
        if (casoInfo.kind === "text") f2["Caso clinico"] = casoInfo.text;
        out = await writeOnce(f2);
      }

      return res.status(200).json({ ok: true, record: { id: out.id, createdTime: out.createdTime, fields: out.fields || {} } });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

