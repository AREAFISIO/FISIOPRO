xmodule.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

    // === CONFIG (attuale) ===
    const TABLE_PATIENTS = "ANAGRAFICA";
    const FIELD_NAME = "Cognome e Nome";
    const FIELD_PHONE = "Numero di telefono";
    const FIELD_EMAIL = "E-mail";

    const op = String(req.query.op || "");

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      res.status(200).json({
        ok: false,
        step: "env",
        error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID in Vercel Environment Variables",
      });
      return;
    }

    const _fetch = global.fetch;
    if (!_fetch) {
      res.status(200).json({
        ok: false,
        step: "runtime",
        error: "fetch() not available in this runtime (expected Node 18+).",
      });
      return;
    }

    const escapeAirtableString = (s) =>
      String(s ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r/g, " ")
        .replace(/\n/g, " ")
        .trim();

    const callAirtable = async (path) => {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
      const r = await _fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { ok: r.ok, httpStatus: r.status, body: json };
    };

    // ===== HEALTH =====
    if (op === "health") {
      const result = await callAirtable(`${encodeURIComponent(TABLE_PATIENTS)}?pageSize=1`);
      if (!result.ok) {
        res.status(200).json({
          ok: false,
          step: "airtable-health",
          table: TABLE_PATIENTS,
          httpStatus: result.httpStatus,
          airtable: result.body,
        });
        return;
      }
      res.status(200).json({
        ok: true,
        step: "airtable-health",
        table: TABLE_PATIENTS,
        recordsFound: result.body?.records?.length || 0,
      });
      return;
    }

    // ===== LIST: primi 10 pazienti (per debug/uso pratico) =====
    if (op === "listPatients") {
      const result = await callAirtable(`${encodeURIComponent(TABLE_PATIENTS)}?pageSize=10`);
      if (!result.ok) {
        res.status(200).json({
          ok: false,
          step: "airtable-list",
          table: TABLE_PATIENTS,
          httpStatus: result.httpStatus,
          airtable: result.body,
        });
        return;
      }

      const items = (result.body.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] ?? "",
        phone: r.fields?.[FIELD_PHONE] ?? "",
        email: r.fields?.[FIELD_EMAIL] ?? "",
      }));

      res.status(200).json({ ok: true, items });
      return;
    }

    // ===== SAMPLE: mostra i nomi campi reali del primo record =====
    if (op === "samplePatients") {
      const result = await callAirtable(`${encodeURIComponent(TABLE_PATIENTS)}?pageSize=1`);
      if (!result.ok) {
        res.status(200).json({
          ok: false,
          step: "airtable-sample",
          table: TABLE_PATIENTS,
          httpStatus: result.httpStatus,
          airtable: result.body,
        });
        return;
      }

      const first = result.body.records?.[0] || null;
      const fieldNames = first?.fields ? Object.keys(first.fields) : [];

      res.status(200).json({
        ok: true,
        table: TABLE_PATIENTS,
        firstRecordId: first?.id || null,
        fieldNames,
        firstFieldsPreview: first?.fields || null
      });
      return;
    }

    // ===== SEARCH PATIENTS =====
    if (op === "searchPatients") {
      const qRaw = String(req.query.q || "").trim();

      // se query vuota: ritorna lista
      if (!qRaw) {
        const list = await callAirtable(`${encodeURIComponent(TABLE_PATIENTS)}?pageSize=10`);
        const items = (list.body?.records || []).map((r) => ({
          id: r.id,
          name: r.fields?.[FIELD_NAME] ?? "",
          phone: r.fields?.[FIELD_PHONE] ?? "",
          email: r.fields?.[FIELD_EMAIL] ?? "",
        }));
        res.status(200).json({ ok: true, items });
        return;
      }

      const q = escapeAirtableString(qRaw);
      const qLower = escapeAirtableString(qRaw.toLowerCase());

      // SEAR
