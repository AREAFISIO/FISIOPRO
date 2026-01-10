import { ensureRes, requireSession } from "./_auth.js";
import patientHandler from "./patient.js";
import { airtableList, escAirtableString } from "../lib/airtableClient.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function toSearchFormula(qRaw) {
  const q = norm(qRaw).toLowerCase();
  const qq = escAirtableString(q);
  // NOTE: Avoid lookup/rollup for critical logic; use source fields.
  // Cast empty to string via &"" so LOWER() doesn't error on blanks.
  const fields = ["Paziente", "Cognome", "Nome", "Numero di telefono"];
  const parts = fields.map((f) => `FIND(LOWER("${qq}"), LOWER({${f}}&""))`);
  return `OR(${parts.join(",")})`;
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    // Backward-compat: if callers used /api/patients?id=rec..., keep serving the patient detail.
    const recordId = norm(req.query?.recordId || req.query?.id);
    const q = norm(req.query?.q);
    if (recordId && !q) {
      // patient.js expects ?id=...
      req.query = { ...(req.query || {}), id: recordId };
      return await patientHandler(req, res);
    }

    if (!q) return res.status(200).json({ ok: true, patients: [] });

    const { records } = await airtableList("ANAGRAFICA", {
      filterByFormula: toSearchFormula(q),
      maxRecords: 50,
      fields: ["Paziente", "Cognome", "Nome", "Numero di telefono", "Record ID"],
      sort: [{ field: "Cognome", direction: "asc" }, { field: "Nome", direction: "asc" }],
    });

    const patients = (records || []).map((r) => {
      const f = r.fields || {};
      return {
        id: r.id, // Airtable recordId (always prefer this)
        recordId: r.id,
        paziente: f["Paziente"] ?? "",
        cognome: f["Cognome"] ?? "",
        nome: f["Nome"] ?? "",
        telefono: f["Numero di telefono"] ?? "",
        recordIdText: f["Record ID"] ?? "",
        fields: f,
      };
    });

    return res.status(200).json({ ok: true, patients });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}
