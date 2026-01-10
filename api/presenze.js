import { ensureRes, requireRoles } from "./_auth.js";
import { norm, readJsonBody } from "./_common.js";
import { airtableCreate, airtableList, airtableUpdate, escAirtableString as esc, resolveLinkedIds } from "../lib/airtableClient.js";

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "si" || s === "sì" || s === "ok";
}

function parseIsoOrThrow(v, label) {
  const s = String(v ?? "").trim();
  if (!s) {
    const err = new Error(`missing_${label}`);
    err.status = 400;
    throw err;
  }
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

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["back", "manager"]);
  if (!user) return;

  try {
    if (req.method === "GET") {
      const fromISO = parseIsoOrThrow(req.query?.from, "from");
      const toISO = parseIsoOrThrow(req.query?.to, "to");

      const parts = [];
      parts.push(`{Data} >= DATETIME_PARSE("${esc(fromISO)}")`);
      parts.push(`{Data} <= DATETIME_PARSE("${esc(toISO)}")`);

      const operatore = norm(req.query?.operatore);
      if (operatore) {
        // Works for both link-field and text-field (via IFERROR fallback)
        const token = esc(operatore);
        parts.push(`FIND(LOWER("${token.toLowerCase()}"), LOWER(IFERROR(ARRAYJOIN({Operatore}), {Operatore}&"")))`);
      }

      const filterByFormula = `AND(${parts.join(",")})`;
      const { records } = await airtableList("PRESENZE SEGRETERIA", {
        filterByFormula,
        maxRecords: 2000,
        sort: [{ field: "Data", direction: "desc" }],
        fields: ["Operatore - Data", "Data", "Operatore", "Turno", "Note", "Presenza", "Ingresso", "Uscita", "Ore Tot", "Stato", "Orario"],
      });

      return res.status(200).json({
        ok: true,
        records: (records || []).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })),
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

      const payload = body.presenza || body;
      const recordId = norm(payload.recordId || payload.id);

      const data = norm(payload.Data || payload.data);
      const operatore = norm(payload.Operatore || payload.operatore);
      if (!recordId && (!data || !operatore)) return res.status(400).json({ ok: false, error: "missing_data_operatore" });

      const fields = {};
      if (data) fields["Data"] = data;
      if (payload.Turno !== undefined || payload.turno !== undefined) fields["Turno"] = norm(payload.Turno ?? payload.turno);
      if (payload.Note !== undefined || payload.note !== undefined) fields["Note"] = norm(payload.Note ?? payload.note);
      if (payload.Ingresso !== undefined || payload.ingresso !== undefined) fields["Ingresso"] = norm(payload.Ingresso ?? payload.ingresso);
      if (payload.Uscita !== undefined || payload.uscita !== undefined) fields["Uscita"] = norm(payload.Uscita ?? payload.uscita);
      if (payload.Presenza !== undefined || payload.presenza !== undefined) fields["Presenza"] = toBool(payload.Presenza ?? payload.presenza);

      // Operatore can be LINK or TEXT depending on base:
      // try LINK (recordId array) first if we can resolve; if Airtable rejects, retry as TEXT.
      let operatoreLink = null;
      if (operatore) {
        if (looksLikeRecordId(operatore)) operatoreLink = operatore;
        else {
          const ids = await resolveLinkedIds({ table: "COLLABORATORI", values: operatore, allowMissing: true });
          operatoreLink = ids[0] || null;
        }
      }

      async function writeWithOperatoreValue(value) {
        const f2 = { ...fields };
        if (value !== undefined) f2["Operatore"] = value;
        if (recordId) return await airtableUpdate("PRESENZE SEGRETERIA", recordId, f2);
        return await airtableCreate("PRESENZE SEGRETERIA", f2);
      }

      let out;
      try {
        if (operatoreLink) out = await writeWithOperatoreValue([operatoreLink]);
        else if (operatore) out = await writeWithOperatoreValue(operatore);
        else out = await writeWithOperatoreValue(undefined);
      } catch (e) {
        const msg = String(e?.message || "").toLowerCase();
        const isTypeError =
          msg.includes("invalid value") ||
          msg.includes("cannot parse") ||
          msg.includes("expects") ||
          msg.includes("not a valid") ||
          msg.includes("field") && msg.includes("type");
        if (operatore && operatoreLink && isTypeError) {
          out = await writeWithOperatoreValue(operatore); // fallback to text
        } else {
          throw e;
        }
      }

      return res.status(200).json({ ok: true, record: { id: out.id, fields: out.fields || {}, createdTime: out.createdTime || "" } });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

