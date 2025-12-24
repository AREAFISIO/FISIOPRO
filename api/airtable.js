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
    const includeFields = String(req.query?.includeFields || "").trim() === "1";

    // === CONFIG (default) ===
    const TABLE_PATIENTS = process.env.AIRTABLE_PATIENTS_TABLE || "ANAGRAFICA";
    const FIELD_NAME = process.env.AIRTABLE_PATIENTS_NAME_FIELD || "Cognome e Nome";
    const FIELD_PHONE = process.env.AIRTABLE_PATIENTS_PHONE_FIELD || "Numero di telefono";
    const FIELD_EMAIL = process.env.AIRTABLE_PATIENTS_EMAIL_FIELD || "E-mail";
    const FIELD_FIRSTNAME = process.env.AIRTABLE_PATIENTS_FIRSTNAME_FIELD || "Nome";
    const FIELD_LASTNAME = process.env.AIRTABLE_PATIENTS_LASTNAME_FIELD || "Cognome";
    const FIELD_FISCAL = process.env.AIRTABLE_PATIENTS_FISCAL_FIELD || "Codice Fiscale";
    const FIELD_DOB = process.env.AIRTABLE_PATIENTS_DOB_FIELD || "Data di nascita";
    const FIELD_CHANNELS = process.env.AIRTABLE_PATIENTS_CHANNELS_FIELD || "Canali di comunicazione preferiti";

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
      const qs = new URLSearchParams({ pageSize: "10" });
      // limit fields for speed
      qs.append("fields[]", FIELD_NAME);
      qs.append("fields[]", FIELD_PHONE);
      qs.append("fields[]", FIELD_EMAIL);
      const data = await airtableFetch(`${table}?${qs.toString()}`);
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
        const qs0 = new URLSearchParams({ pageSize: "10" });
        qs0.append("fields[]", FIELD_NAME);
        qs0.append("fields[]", FIELD_PHONE);
        qs0.append("fields[]", FIELD_EMAIL);
        const data = await airtableFetch(`${table}?${qs0.toString()}`);
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
      qs.append("fields[]", FIELD_NAME);
      qs.append("fields[]", FIELD_PHONE);
      qs.append("fields[]", FIELD_EMAIL);

      const data = await airtableFetch(`${table}?${qs.toString()}`);
      const items = (data.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] ?? "",
        phone: r.fields?.[FIELD_PHONE] ?? "",
        email: r.fields?.[FIELD_EMAIL] ?? "",
      }));

      return res.status(200).json({ ok: true, items });
    }

    if (op === "listPatientsFull" || op === "searchPatientsFull") {
      // Nota: per evitare errori Airtable, la formula di ricerca usa solo campi “sicuri”
      // (quelli già utilizzati nel progetto / coerenti con il setup). Campi opzionali
      // (es. Codice Fiscale / Canali) vengono comunque restituiti se presenti.
      const qRaw = String(req.query?.q || "").trim();
      const q = escAirtableString(qRaw.toLowerCase());

      const maxRecords = Math.min(Number(req.query?.maxRecords || 200) || 200, 500);
      const pageSize = Math.min(Number(req.query?.pageSize || 50) || 50, 100);

      const qs = new URLSearchParams({
        maxRecords: String(maxRecords),
        pageSize: String(pageSize),
      });

      // request only the fields we actually render (big performance win)
      qs.append("fields[]", FIELD_FIRSTNAME);
      qs.append("fields[]", FIELD_LASTNAME);
      qs.append("fields[]", FIELD_NAME);
      qs.append("fields[]", FIELD_FISCAL);
      qs.append("fields[]", FIELD_EMAIL);
      qs.append("fields[]", FIELD_PHONE);
      qs.append("fields[]", FIELD_DOB);
      qs.append("fields[]", FIELD_CHANNELS);

      if (q) {
        const formula = `OR(
          FIND("${q}", LOWER({${FIELD_FIRSTNAME}})),
          FIND("${q}", LOWER({${FIELD_LASTNAME}})),
          FIND("${q}", LOWER({${FIELD_PHONE}})),
          FIND("${q}", LOWER({${FIELD_EMAIL}})),
          FIND("${q}", LOWER({${FIELD_NAME}}))
        )`;
        qs.set("filterByFormula", formula);
      }

      const data = await airtableFetch(`${table}?${qs.toString()}`);
      const items = (data.records || []).map((r) => {
        const f = r.fields || {};
        const out = {
          id: r.id,
          Nome: f[FIELD_FIRSTNAME] ?? f["Nome"] ?? "",
          Cognome: f[FIELD_LASTNAME] ?? f["Cognome"] ?? "",
          "Codice Fiscale": f[FIELD_FISCAL] ?? f["Codice Fiscale"] ?? f["Codice fiscale"] ?? "",
          Email: f[FIELD_EMAIL] ?? f["Email"] ?? f["E-mail"] ?? "",
          Telefono: f[FIELD_PHONE] ?? f["Telefono"] ?? f["Numero di telefono"] ?? "",
          "Data di nascita": f[FIELD_DOB] ?? f["Data di nascita"] ?? "",
          "Canali di comunicazione preferiti":
            f[FIELD_CHANNELS] ?? f["Canali di comunicazione preferiti"] ?? f["Canali preferiti"] ?? "",
          // fallback utile se il base ha il campo unico
          "Cognome e Nome": f[FIELD_NAME] ?? f["Cognome e Nome"] ?? "",
        };
        if (includeFields) out._fields = f;
        return out;
      });

      return res.status(200).json({ ok: true, items });
    }

    return res.status(400).json({ ok: false, error: "unknown_op" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

