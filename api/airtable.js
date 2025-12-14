module.exports = async (req, res) => {
  // Risposte sempre JSON
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

    // Config Airtable (dal tuo CSV)
    const TABLE_PATIENTS = "ANAGRAFICA";
    const FIELD_NAME = "Cognome e Nome";
    const FIELD_PHONE = "Numero di telefono";
    const FIELD_EMAIL = "E-mail";

    const op = String(req.query.op || "");

    // Se mancano env, NON crashare: rispondi bene
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      res.status(200).json({
        ok: false,
        step: "env",
        error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID in Vercel Environment Variables",
      });
      return;
    }

    // Fetch (Node 18 lo ha nativo su Vercel; se non c’è, errore chiaro)
    const _fetch = global.fetch;
    if (!_fetch) {
      res.status(200).json({
        ok: false,
        step: "runtime",
        error: "fetch() not available in this runtime. (Vercel should run Node 18+).",
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

      if (!r.ok) {
        return { ok: false, httpStatus: r.status, airtable: json };
      }
      return { ok: true, httpStatus: r.status, airtable: json };
    };

    // ===== HEALTH: verifica token/base/tabella =====
    if (op === "health") {
      const result = await callAirtable(`${encodeURIComponent(TABLE_PATIENTS)}?pageSize=1`);
      if (!result.ok) {
        res.status(200).json({
          ok: false,
          step: "airtable-health",
          table: TABLE_PATIENTS,
          httpStatus: result.httpStatus,
          airtable: result.airtable,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        step: "airtable-health",
        table: TABLE_PATIENTS,
        recordsFound: result.airtable?.records?.length || 0,
      });
      return;
    }

    // ===== SEARCH PATIENTS =====
    if (op === "searchPatients") {
      const qRaw = String(req.query.q || "").trim();
      if (!qRaw) {
        res.status(200).json({ ok: true, items: [] });
        return;
      }

      const q = escapeAirtableString(qRaw);
      const qLower = escapeAirtableString(qRaw.toLowerCase());

      // formula su UNA riga + campi convertiti a testo con &""
      const formula =
        `OR(` +
        `SEARCH("${qLower}", LOWER({${FIELD_NAME}}&""))>0,` +
        `SEARCH("${q}", {${FIELD_PHONE}}&"")>0,` +
        `SEARCH("${qLower}", LOWER({${FIELD_EMAIL}}&""))>0` +
        `)`;

      // debug=1 per vedere la formula senza chiamare Airtable
      if (String(req.query.debug || "") === "1") {
        res.status(200).json({
          ok: true,
          debug: true,
          table: TABLE_PATIENTS,
          formula,
        });
        return;
      }

      const path =
        `${encodeURIComponent(TABLE_PATIENTS)}` +
        `?filterByFormula=${encodeURIComponent(formula)}` +
        `&pageSize=10`;

      const result = await callAirtable(path);

      if (!result.ok) {
        res.status(200).json({
          ok: false,
          step: "airtable-search",
          httpStatus: result.httpStatus,
          table: TABLE_PATIENTS,
          airtable: result.airtable,
        });
        return;
      }

      const items = (result.airtable.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] || "",
        phone: r.fields?.[FIELD_PHONE] || "",
        email: r.fields?.[FIELD_EMAIL] || "",
      }));

      res.status(200).json({ ok: true, items });
      return;
    }

    res.status(200).json({ ok: false, error: "Unknown op" });
  } catch (e) {
    // Anche qui: MAI crash, sempre JSON
    res.status(200).json({
      ok: false,
      step: "catch",
      error: e?.message || String(e),
    });
  }
};
