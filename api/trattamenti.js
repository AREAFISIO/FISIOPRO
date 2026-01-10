import { ensureRes, requireRoles } from "./_auth.js";
import { norm, readJsonBody } from "./_common.js";
import {
  airtableCreate,
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

function looksLikeRecordId(s) {
  return typeof s === "string" && s.startsWith("rec");
}

function isWriteBlockedFieldName(fieldName) {
  const k = String(fieldName || "").trim();
  if (!k) return true;
  const low = k.toLowerCase();
  if (k === "...") return true;
  if (low.includes("copy")) return true;
  if (/\(from\s.+\)/i.test(k)) return true;
  return false;
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

async function resolveCaseClinicoId(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (looksLikeRecordId(v)) return v;
  // Try by primary (CASO CLINICO) first (via schema resolver)
  let ids = await resolveLinkedIds({ table: "CASI CLINICI", values: v, allowMissing: true });
  if (ids.length) return ids[0];
  // Fallback: match by {ID caso clinico} exact
  const formula = `LOWER({ID caso clinico}&"") = LOWER("${esc(v)}")`;
  const found = await airtableList("CASI CLINICI", { filterByFormula: formula, maxRecords: 1, pageSize: 1, fields: ["ID caso clinico", "CASO CLINICO"] });
  return found.records?.[0]?.id || "";
}

async function resolvePrestazioneId(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (looksLikeRecordId(v)) return v;
  // Try by primary ("Servizio")
  let ids = await resolveLinkedIds({ table: "PRESTAZIONI", values: v, allowMissing: true });
  if (ids.length) return ids[0];
  // Fallback by codice exact
  const formula = `LOWER({Codice}&"") = LOWER("${esc(v)}")`;
  const found = await airtableList("PRESTAZIONI", { filterByFormula: formula, maxRecords: 1, pageSize: 1, fields: ["Servizio", "Codice"] });
  return found.records?.[0]?.id || "";
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "manager"]);
  if (!user) return;

  try {
    if (req.method === "GET") {
      const recordIdCaso = norm(req.query?.recordIdCaso || req.query?.caso);
      const recordIdPaziente = norm(req.query?.recordIdPaziente || req.query?.paziente);
      const fromISO = parseIsoOrEmpty(req.query?.from, "from");
      const toISO = parseIsoOrEmpty(req.query?.to, "to");

      const parts = [];
      if (fromISO) parts.push(`{Data} >= DATETIME_PARSE("${esc(fromISO)}")`);
      if (toISO) parts.push(`{Data} <= DATETIME_PARSE("${esc(toISO)}")`);

      if (recordIdPaziente) {
        const [pazId] = await resolveLinkedIds({ table: "ANAGRAFICA", values: recordIdPaziente });
        parts.push(`FIND("${esc(pazId)}", ARRAYJOIN({Paziente}))`);
      }
      if (recordIdCaso) {
        const casoId = await resolveCaseClinicoId(recordIdCaso);
        if (casoId) parts.push(`OR(FIND("${esc(casoId)}", ARRAYJOIN({Caso clinico})), FIND("${esc(casoId)}", ARRAYJOIN({CASI CLINICI})))`);
      }

      const filterByFormula = parts.length ? `AND(${parts.join(",")})` : "";

      const { records } = await airtableList("TRATTAMENTI", {
        filterByFormula,
        maxRecords: 500,
        sort: [{ field: "Data", direction: "desc" }],
        fields: [
          "Id trattamento",
          "Data",
          "Paziente",
          "Collaboratore",
          "Appuntamento",
          "Caso clinico",
          "CASI CLINICI",
          "Erogato",
          "Vendita di riferimento",
          "LISTINO TERAPIE",
          "Tipo trattamento",
          "Patologia",
          "Macro Area",
          "Sotto-Area",
          "Struttura Anatomica",
          "Lateralità",
          "Sport",
          "Rischio Complicanze",
          "Follow-up Consigliato",
          "Note Fisioterapista",
          "Trattamento eseguito",
          "Indicazioni prossima seduta",
          "BODY T",
          "TEST T",
          "Allegati",
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

      const payload = body.trattamento || body;
      const recordId = norm(payload.recordId || payload.id);

      const rawFields = payload.fields && typeof payload.fields === "object" ? payload.fields : payload;
      const fields = {};
      for (const [k, v] of Object.entries(rawFields || {})) {
        if (k === "recordId" || k === "id" || k === "createdTime") continue;
        if (isWriteBlockedFieldName(k)) continue;
        fields[k] = v;
      }

      // Links (best-effort; some can be TEXT in some bases)
      const linkFallbackText = {};

      // Required-ish links
      if (fields["Paziente"] !== undefined) {
        const [id] = await resolveLinkedIds({ table: "ANAGRAFICA", values: fields["Paziente"], allowMissing: false });
        fields["Paziente"] = [id];
      }
      if (fields["Collaboratore"] !== undefined) {
        const [id] = await resolveLinkedIds({ table: "COLLABORATORI", values: fields["Collaboratore"], allowMissing: false });
        fields["Collaboratore"] = [id];
      }

      // Optional links
      if (fields["Appuntamento"] !== undefined) {
        const ids = await resolveLinkedIds({ table: "APPUNTAMENTI", values: fields["Appuntamento"], allowMissing: true });
        if (ids.length) fields["Appuntamento"] = [ids[0]];
      }
      if (fields["Erogato"] !== undefined) {
        const ids = await resolveLinkedIds({ table: "EROGATO", values: fields["Erogato"], allowMissing: true });
        if (ids.length) fields["Erogato"] = [ids[0]];
      }
      if (fields["Vendita di riferimento"] !== undefined) {
        const ids = await resolveLinkedIds({ table: "VENDITE", values: fields["Vendita di riferimento"], allowMissing: true });
        if (ids.length) fields["Vendita di riferimento"] = [ids[0]];
      }

      if (fields["LISTINO TERAPIE"] !== undefined) {
        const pId = await resolvePrestazioneId(fields["LISTINO TERAPIE"]);
        if (pId) fields["LISTINO TERAPIE"] = [pId];
      }

      if (fields["Caso clinico"] !== undefined) {
        const casoId = await resolveCaseClinicoId(fields["Caso clinico"]);
        if (casoId) fields["Caso clinico"] = [casoId];
      }
      if (fields["CASI CLINICI"] !== undefined) {
        const casoId = await resolveCaseClinicoId(fields["CASI CLINICI"]);
        if (casoId) fields["CASI CLINICI"] = [casoId];
      }

      // Taxonomy links (may be TEXT in some bases; allow fallback)
      for (const [fieldName, tableName] of [
        ["Patologia", "PATOLOGIE ORTOPEDICHE"],
        ["Macro Area", "MACRO AREE"],
        ["Sotto-Area", "SOTTO AREE"],
        ["Struttura Anatomica", "STRUTTURE ANATOMICHE"],
        ["Sport", "SPORT"],
      ]) {
        if (fields[fieldName] === undefined) continue;
        const raw = fields[fieldName];
        const s = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim();
        if (!s) continue;
        linkFallbackText[fieldName] = s;
        const ids = await resolveLinkedIds({ table: tableName, values: s, allowMissing: true });
        if (ids.length) fields[fieldName] = [ids[0]];
      }

      // "TEST T" can be multi-link to TEST CLINICI or plain text.
      if (fields["TEST T"] !== undefined) {
        const raw = fields["TEST T"];
        const arr = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
        const cleaned = arr.map((x) => String(x ?? "").trim()).filter(Boolean);
        if (cleaned.length) {
          // Resolve names -> record IDs (primary "NOME"); error if a name can't be found.
          const ids = await resolveLinkedIds({ table: "TEST CLINICI", values: cleaned, allowMissing: false });
          fields["TEST T"] = ids;
          linkFallbackText["TEST T"] = cleaned.join(", ");
        } else {
          fields["TEST T"] = [];
        }
      }

      async function writeOnce(f) {
        if (recordId) return await airtableUpdate("TRATTAMENTI", recordId, f);
        return await airtableCreate("TRATTAMENTI", f);
      }

      let out;
      try {
        out = await writeOnce(fields);
      } catch (e) {
        if (!isLikelyTypeError(e)) throw e;
        // Fallback for bases where taxonomy/test fields are TEXT instead of LINK.
        const f2 = { ...fields };
        for (const [k, v] of Object.entries(linkFallbackText)) {
          if (k in f2 && Array.isArray(f2[k])) f2[k] = v;
        }
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

