import { ensureRes, requireRoles } from "./_auth.js";
import { norm, readJsonBody } from "./_common.js";
import {
  airtableCreate,
  airtableList,
  airtableUpdate,
  airtableUpsertByPrimary,
  escAirtableString as esc,
  resolveLinkedIds,
} from "../lib/airtableClient.js";

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "si" || s === "sì" || s === "ok";
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["front", "physio", "manager"]);
  if (!user) return;

  try {
    if (req.method === "GET") {
      const recordIdAnagrafica = norm(req.query?.recordIdAnagrafica);
      const q = norm(req.query?.q);

      let filterByFormula = "";
      if (recordIdAnagrafica) {
        const [anagraficaRecId] = await resolveLinkedIds({ table: "ANAGRAFICA", values: recordIdAnagrafica });
        filterByFormula = `FIND("${esc(anagraficaRecId)}", ARRAYJOIN({Anagrafica}))`;
      } else if (q) {
        const qq = esc(q.toLowerCase());
        filterByFormula = `OR(
          FIND(LOWER("${qq}"), LOWER({ANAGRAFICA | DATA}&"")),
          FIND(LOWER("${qq}"), LOWER({Cognome e Nome}&"")),
          FIND(LOWER("${qq}"), LOWER({CODICE FISCALE}&""))
        )`;
      }

      const { records } = await airtableList("PREVENTIVO E REGOLAMENTO", {
        filterByFormula,
        maxRecords: 500,
        sort: [{ field: "DATA ", direction: "desc" }],
        fields: [
          "ANAGRAFICA | DATA",
          "DATA ",
          "REGOLAMENTO/PREVENTIVO",
          "FILE REGOLAMENTO / PREVENTIVO",
          "URL REGOLAMENTO / PREVENTIVO",
          "REGOLAMENTO FIRMATO",
          "Anagrafica",
          "Cognome e Nome",
          "CODICE FISCALE",
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

      const payload = body.regolamento || body;
      const recordId = norm(payload.recordId || payload.id);

      const primary = norm(payload["ANAGRAFICA | DATA"] || payload.primary);
      if (!recordId && !primary) return res.status(400).json({ ok: false, error: "missing_primary" });

      const fields = {};
      if (primary) fields["ANAGRAFICA | DATA"] = primary;

      const data = norm(payload["DATA "] || payload.data);
      if (data) fields["DATA "] = data;

      const anagraficaVal = payload.Anagrafica ?? payload.anagrafica ?? payload.recordIdAnagrafica;
      if (anagraficaVal !== undefined) {
        if (anagraficaVal === null || String(anagraficaVal).trim() === "") {
          fields["Anagrafica"] = [];
        } else {
          const [anagraficaRecId] = await resolveLinkedIds({ table: "ANAGRAFICA", values: anagraficaVal });
          fields["Anagrafica"] = [anagraficaRecId];
        }
      }

      // Attachment: allow either direct Airtable attachment array, or fileUrl/filename helper.
      const att = payload["FILE REGOLAMENTO / PREVENTIVO"] ?? payload.attachments ?? payload.allegati;
      const fileUrl = norm(payload.fileUrl || payload.urlFile);
      const filename = norm(payload.filename || payload.nomeFile) || "regolamento_preventivo.pdf";
      if (att !== undefined) {
        if (Array.isArray(att)) fields["FILE REGOLAMENTO / PREVENTIVO"] = att;
        else if (att === null || String(att).trim() === "") fields["FILE REGOLAMENTO / PREVENTIVO"] = [];
      } else if (fileUrl) {
        fields["FILE REGOLAMENTO / PREVENTIVO"] = [{ url: fileUrl, filename }];
      }

      const url = norm(payload["URL REGOLAMENTO / PREVENTIVO"] || payload.url);
      if (url) fields["URL REGOLAMENTO / PREVENTIVO"] = url;

      if (payload["REGOLAMENTO FIRMATO"] !== undefined || payload.firmato !== undefined) {
        fields["REGOLAMENTO FIRMATO"] = toBool(payload["REGOLAMENTO FIRMATO"] ?? payload.firmato);
      }

      const out = recordId
        ? await airtableUpdate("PREVENTIVO E REGOLAMENTO", recordId, fields)
        : (await airtableUpsertByPrimary("PREVENTIVO E REGOLAMENTO", "ANAGRAFICA | DATA", primary, fields)).record;

      return res.status(200).json({ ok: true, record: { id: out.id, fields: out.fields || {}, createdTime: out.createdTime || "" } });
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

