module.exports = async (req, res) => {
  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      res.status(500).json({
        ok: false,
        error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID in Vercel Environment Variables"
      });
      return;
    }

    // ====== CONFIG (TUO AIRTABLE) ======
    const TABLE_PATIENTS = "ANAGRAFICA";
    const FIELD_NAME = "Cognome e Nome";
    const FIELD_PHONE = "Numero di telefono";
    const FIELD_EMAIL = "E-mail";

    const op = String(req.query.op || "");

    // Escape robusto per formule Airtable
    const escapeAirtableString = (s) =>
      String(s ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r/g, " ")
        .replace(/\n/g, " ")
        .trim();

    // Fetch compatibile anche se Node runtime non supporta fetch nativo
    const _fetch = global.fetch || (await import("node-fetch")).default;

    const callAirtable = async (path) => {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
      const r = await _fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });

      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }

      if (!r.ok) {
        throw new Error(json?.error?.message || `Airtable error HTTP ${r.status}`);
      }
      return json;
    };

    // ====== HEALTH ======
    if (op === "health") {
      const data = await callAirtable(`${encodeURIComponent(TABLE_PATIENTS)}?pageSize=1`);
      res.status(200).json({
        ok: true,
        table: TABLE_PATIENTS,
        recordsFound: (data.records || []).length
      });
      return;
    }

    // ====== SEARCH PATIENTS ======
    if (op === "searchPatients") {
      const qRaw = String(req.query.q || "").trim();
      if (!qRaw) {
        res.status(200).json({ ok: true, items: [] });
        return;
      }

      const q = escapeAirtableString(qRaw);
      const qLower = escapeAirtableString(qRaw.toLowerCase());

      // Formula su UNA riga + campi forzati testo con &""
      const formula =
        `OR(` +
        `SEARCH("${qLower}", LOWER({${FIELD_NAME}}&""))>0,` +
        `SEARCH("${q}", {${FIELD_PHONE}}&"")>0,` +
        `SEARCH("${qLower}", LOWER({${FIELD_EMAIL}}&""))>0` +
        `)`;

      // Se chiami debug=1 ti mostro la formula (utile se Airtable si lamenta)
      if (String(req.query.debug || "") === "1") {
        res.status(200).json({ ok: true, debug: true, table: TABLE_PATIENTS, formula });
        return;
      }

      const path =
        `${encodeURIComponent(TABLE_PATIENTS)}` +
        `?filterByFormula=${encodeURIComponent(formula)}` +
        `&pageSize=10`;

      const data = await callAirtable(path);

      const items = (data.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] || "",
        phone: r.fields?.[FIELD_PHONE] || "",
        email: r.fields?.[FIELD_EMAIL] || "",
      }));

      res.status(200).json({ ok: true, items });
      return;
    }

    res.status(400).json({ ok: false, error: "Unknown op" });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
};
