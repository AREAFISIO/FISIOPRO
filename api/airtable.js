import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";

function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const op = String(req.query?.op || "").trim();

    // === CONFIG (default) ===
    const TABLE_PATIENTS = process.env.AIRTABLE_PATIENTS_TABLE || "ANAGRAFICA";
    const FIELD_NAME = process.env.AIRTABLE_PATIENTS_NAME_FIELD || "Cognome e Nome";
    const FIELD_PHONE = process.env.AIRTABLE_PATIENTS_PHONE_FIELD || "Numero di telefono";
    const FIELD_EMAIL = process.env.AIRTABLE_PATIENTS_EMAIL_FIELD || "E-mail";

    const table = encodeURIComponent(TABLE_PATIENTS);

    if (op === "health") {
      const data = await airtableFetch(`${table}?pageSize=1`);
      return res.status(200).json({ ok: true, recordsFound: data?.records?.length || 0 });
    }

    if (op === "samplePatients") {
      const data = await airtableFetch(`${table}?pageSize=1`);
      const first = data.records?.[0] || null;
      const fieldNames = first?.fields ? Object.keys(first.fields) : [];
      return res.status(200).json({
        ok: true,
        table: TABLE_PATIENTS,
        firstRecordId: first?.id || null,
        fieldNames,
        firstFieldsPreview: first?.fields || null,
      });
    }

    if (op === "listPatients") {
      const data = await airtableFetch(`${table}?pageSize=10`);
      const items = (data.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] ?? "",
        phone: r.fields?.[FIELD_PHONE] ?? "",
        email: r.fields?.[FIELD_EMAIL] ?? "",
      }));
      return res.status(200).json({ ok: true, items });
    }

    if (op === "searchPatients") {
      const qRaw = String(req.query?.q || "").trim();
      if (!qRaw) {
        const data = await airtableFetch(`${table}?pageSize=10`);
        const items = (data.records || []).map((r) => ({
          id: r.id,
          name: r.fields?.[FIELD_NAME] ?? "",
          phone: r.fields?.[FIELD_PHONE] ?? "",
          email: r.fields?.[FIELD_EMAIL] ?? "",
        }));
        return res.status(200).json({ ok: true, items });
      }

      const q = escAirtableString(qRaw.toLowerCase());
      const formula = `OR(
        FIND("${q}", LOWER({${FIELD_NAME}})),
        FIND("${q}", LOWER({${FIELD_PHONE}})),
        FIND("${q}", LOWER({${FIELD_EMAIL}}))
      )`;

      const qs = new URLSearchParams({
        filterByFormula: formula,
        maxRecords: "20",
        pageSize: "20",
      });

      const data = await airtableFetch(`${table}?${qs.toString()}`);
      const items = (data.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] ?? "",
        phone: r.fields?.[FIELD_PHONE] ?? "",
        email: r.fields?.[FIELD_EMAIL] ?? "",
      }));

      return res.status(200).json({ ok: true, items });
    }

    return res.status(400).json({ ok: false, error: "unknown_op" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

