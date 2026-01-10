import { ensureRes, requireRoles } from "./_auth.js";
import { norm, readJsonBody } from "./_common.js";
import {
  airtableCreate,
  airtableGet,
  airtableList,
  airtableUpdate,
  airtableUpsertByPrimary,
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

function isUnknownFieldError(e) {
  const msg = String(e?.message || "").toLowerCase();
  return msg.includes("unknown field name") || msg.includes("unknown field names");
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

async function resolvePrestazioneIds(values) {
  const arr = Array.isArray(values) ? values : values === undefined || values === null ? [] : [values];
  const out = [];
  for (const v0 of arr) {
    const v = String(v0 ?? "").trim();
    if (!v) continue;
    if (looksLikeRecordId(v)) {
      out.push(v);
      continue;
    }
    // Try by primary ("Servizio")
    let ids = await resolveLinkedIds({ table: "PRESTAZIONI", values: v, allowMissing: true });
    if (ids.length) {
      out.push(ids[0]);
      continue;
    }
    // Fallback by Codice exact
    const formula = `LOWER({Codice}&"") = LOWER("${esc(v)}")`;
    const found = await airtableList("PRESTAZIONI", { filterByFormula: formula, maxRecords: 1, pageSize: 1, fields: ["Servizio", "Codice"] });
    const rid = found.records?.[0]?.id || "";
    if (!rid) {
      const err = new Error(`prestazione_not_found:${v}`);
      err.status = 400;
      throw err;
    }
    out.push(rid);
  }
  return out;
}

async function resolveCaseClinicoId(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (looksLikeRecordId(v)) return v;
  // Try by primary ("CASO CLINICO")
  let ids = await resolveLinkedIds({ table: "CASI CLINICI", values: v, allowMissing: true });
  if (ids.length) return ids[0];
  // Fallback by ID caso clinico
  const formula = `LOWER({ID caso clinico}&"") = LOWER("${esc(v)}")`;
  const found = await airtableList("CASI CLINICI", { filterByFormula: formula, maxRecords: 1, pageSize: 1, fields: ["ID caso clinico", "CASO CLINICO"] });
  return found.records?.[0]?.id || "";
}

async function listVenditeByDateField({ dateField, fromISO, toISO, parts }) {
  const p = [...(parts || [])];
  if (fromISO) p.push(`{${dateField}} >= DATETIME_PARSE("${esc(fromISO)}")`);
  if (toISO) p.push(`{${dateField}} <= DATETIME_PARSE("${esc(toISO)}")`);
  const filterByFormula = p.length ? `AND(${p.join(",")})` : "";
  return await airtableList("VENDITE", {
    filterByFormula,
    maxRecords: 1000,
    sort: [{ field: dateField, direction: "desc" }],
    fields: [
      "ID Vendita",
      "Vendita",
      "Paziente",
      "Stato vendita",
      "Tipo di vendita",
      dateField,
      "LINK TO PRESTAZIONI",
      "Sedute vendute",
      "Numero sedute erogate",
      "Sedute residue",
      "Prezzo totale",
      "PREZZO SCONTO",
      "Modalità di Pagamento 1",
      "Metodo di Pagamento 1",
      "Stato Pagamento",
      "Assicurazione",
      "🧑‍💻 Fonti (per accredito extra)",
      "Caso clinico",
      "APPUNTAMENTI",
      "Erogati collegati",
      "SEDUTE COMPLETATE",
      "N° Fattura 1",
      "N° Fattura 2",
      "Data Fattura 1",
      "Data Fattura 2",
    ],
  });
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "back", "manager"]);
  if (!user) return;

  try {
    if (req.method === "GET") {
      const recordIdPaziente = norm(req.query?.recordIdPaziente || req.query?.paziente);
      const stato = norm(req.query?.stato);
      const fromISO = parseIsoOrEmpty(req.query?.from, "from");
      const toISO = parseIsoOrEmpty(req.query?.to, "to");

      const parts = [];
      if (recordIdPaziente) {
        const [pazId] = await resolveLinkedIds({ table: "ANAGRAFICA", values: recordIdPaziente });
        parts.push(`FIND("${esc(pazId)}", ARRAYJOIN({Paziente}))`);
      }
      if (stato) parts.push(`{Stato vendita}="${esc(stato)}"`);

      // Date field can be "DATA E ORA VENDITA" or "Data vendita". Try one then fallback.
      let data;
      try {
        data = await listVenditeByDateField({ dateField: "DATA E ORA VENDITA", fromISO, toISO, parts });
      } catch (e) {
        if (!isUnknownFieldError(e)) throw e;
        data = await listVenditeByDateField({ dateField: "Data vendita", fromISO, toISO, parts });
      }

      const records = (data.records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} }));
      return res.status(200).json({ ok: true, records });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const payload = body.vendita || body;
      const recordId = norm(payload.recordId || payload.id);

      const rawFields = payload.fields && typeof payload.fields === "object" ? payload.fields : payload;
      const fields = {};
      for (const [k, v] of Object.entries(rawFields || {})) {
        if (k === "recordId" || k === "id" || k === "createdTime") continue;
        if (isWriteBlockedFieldName(k)) continue;
        fields[k] = v;
      }

      // Paziente: allow name -> recordId
      if (fields["Paziente"] !== undefined) {
        const [pazId] = await resolveLinkedIds({ table: "ANAGRAFICA", values: fields["Paziente"], allowMissing: false });
        fields["Paziente"] = [pazId];
      }

      // Prestazioni: accept name/codice/recordId(s)
      if (fields["LINK TO PRESTAZIONI"] !== undefined) {
        const ids = await resolvePrestazioneIds(fields["LINK TO PRESTAZIONI"]);
        fields["LINK TO PRESTAZIONI"] = ids;
      } else if (payload.prestazione !== undefined || payload.prestazioni !== undefined || payload.codicePrestazione !== undefined) {
        const ids = await resolvePrestazioneIds(payload.prestazioni ?? payload.prestazione ?? payload.codicePrestazione);
        fields["LINK TO PRESTAZIONI"] = ids;
      }

      // Caso clinico: allow "ID caso clinico" or name
      if (fields["Caso clinico"] !== undefined) {
        const casoId = await resolveCaseClinicoId(fields["Caso clinico"]);
        if (casoId) fields["Caso clinico"] = [casoId];
      } else if (payload.casoClinico !== undefined) {
        const casoId = await resolveCaseClinicoId(payload.casoClinico);
        if (casoId) fields["Caso clinico"] = [casoId];
      }

      // Optional link-ish fields: if base uses TEXT, fallback to text on type errors
      const fallbackText = {};
      for (const [fieldName, tableName] of [
        ["Assicurazione", "ASSICURAZIONI"],
        ["🧑‍💻 Fonti (per accredito extra)", "FONTI"],
      ]) {
        if (fields[fieldName] === undefined) continue;
        const v = String(Array.isArray(fields[fieldName]) ? fields[fieldName][0] : fields[fieldName] ?? "").trim();
        if (!v) continue;
        fallbackText[fieldName] = v;
        const ids = await resolveLinkedIds({ table: tableName, values: v, allowMissing: true });
        if (ids.length) fields[fieldName] = [ids[0]];
      }

      // Other links
      if (fields["APPUNTAMENTI"] !== undefined) {
        const ids = await resolveLinkedIds({ table: "APPUNTAMENTI", values: fields["APPUNTAMENTI"], allowMissing: true });
        fields["APPUNTAMENTI"] = ids;
      }
      if (fields["Erogati collegati"] !== undefined) {
        const ids = await resolveLinkedIds({ table: "EROGATO", values: fields["Erogati collegati"], allowMissing: true });
        fields["Erogati collegati"] = ids;
      }

      // Upsert strategy:
      // - recordId present -> update by recordId
      // - else if ID Vendita present -> upsert by primary
      const idVendita = norm(fields["ID Vendita"] ?? payload["ID Vendita"] ?? payload.idVendita);

      async function writeOnce(f) {
        if (recordId) return await airtableUpdate("VENDITE", recordId, f);
        if (idVendita) return (await airtableUpsertByPrimary("VENDITE", "ID Vendita", idVendita, f)).record;
        return await airtableCreate("VENDITE", f);
      }

      let out;
      try {
        out = await writeOnce(fields);
      } catch (e) {
        if (!isLikelyTypeError(e)) throw e;
        const f2 = { ...fields };
        for (const [k, v] of Object.entries(fallbackText)) {
          if (Array.isArray(f2[k])) f2[k] = v;
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

