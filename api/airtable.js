export default async function handler(req, res) {
  try {
    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({
        ok: false,
        error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID",
      });
    }

    // ====== CONFIG (TUO AIRTABLE) ======
    const TABLE_PATIENTS = "ANAGRAFICA";
    const FIELD_NAME = "Cognome e Nome";
    const FIELD_PHONE = "Numero di telefono";
    const FIELD_EMAIL = "E-mail";

    const op = (req.query.op || "").toString();

    // Escape robusto per stringhe dentro formule Airtable
    function escapeAirtableString(s) {
      return String(s ?? "")
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replaceAll("\n", " ")
        .replaceAll("\r", " ")
        .trim();
    }

    async function callAirtable(path) {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });

      const text = await r.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!r.ok) {
        // ritorno errore leggibile
        throw new Error(json?.error?.message || `Airtable error ${r.status}`);
      }
      return json;
    }

    // ====== HEALTH (test connessione + tabella esiste) ======
    if (op === "health") {
      const data = await callAirtable(`${encodeURIComponent(TABLE_PATIENTS)}?pageSize=1`);
      return res.json({
        ok: true,
        table: TABLE_PATIENTS,
        recordsFound: data.records?.length || 0,
      });
    }

    // ====== SEARCH PATIENTS ======
    if (op === "searchPatients") {
      const qRaw = (req.query.q || "").toString().trim();
      if (!qRaw) return res.json({ ok: true, items: [] });

      const q = escapeAirtableString(qRaw);
      const qLower = escapeAirtableString(qRaw.toLowerCase());

      // FORMULA: una sola riga, zero a-capo.
      // SEARCH() è più permissivo di FIND(), e non rompe su campi Phone se forzati a stringa.
      const formula =
        `OR(` +
        `SEARCH("${qLower}", LOWER({${FIELD_NAME}}&""))>0,` +
        `SEARCH("${q}", {${FIELD_PHONE}}&"")>0,` +
        `SEARCH("${qLower}", LOWER({${FIELD_EMAIL}}&""))>0` +
        `)`;

      const path =
        `${encodeURIComponent(TABLE_PATIENTS)}` +
        `?filterByFormula=${encodeUR
