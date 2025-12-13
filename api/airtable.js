export default async function handler(req, res) {
  try {
    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({
        ok: false,
        error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID"
      });
    }

    const op = req.query.op;

    // =========================
    // CONFIGURAZIONE AIRTABLE
    // =========================
    const TABLE_PATIENTS = "ANAGRAFICA";

    const FIELD_NAME = "Cognome e Nome";
    const FIELD_PHONE = "Numero di telefono";
    const FIELD_EMAIL = "E-mail";

    // =========================
    // HELPER CALL AIRTABLE
    // =========================
    async function callAirtable(path) {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        },
      });

      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!response.ok) {
        throw new Error(json?.error?.message || "Airtable API error");
      }

      return json;
    }

    // =========================
    // HEALTH CHECK
    // =========================
    if (op === "health") {
      const data = await callAirtable(
        `${encodeURIComponent(TABLE_PATIENTS)}?pageSize=1`
      );

      return res.json({
        ok: true,
        table: TABLE_PATIENTS,
        recordsFound: data.records?.length || 0,
      });
    }

    // =========================
    // SEARCH PATIENTS
    // =========================
    if (op === "searchPatients") {
      const q = (req.query.q || "").toString().trim();

      if (!q) {
        return res.json({ ok: true, items: [] });
      }

      const qLower = q.toLowerCase().replaceAll('"', '\\"');

      // ⚠️ TUTTI I CAMPI FORZATI A STRINGA CON &""
      const formula = `OR(
        FIND(LOWER("${qLower}"), LOWER({${FIELD_NAME}} & "")) > 0,
        FIND("${q}", {${FIELD_PHONE}} & "") > 0,
        FIND(LOWER("${qLower}"), LOWER({${FIELD_EMAIL}} & "")) > 0
      )`;

      const data = await callAirtable(
        `${encodeURIComponent(TABLE_PATIENTS)}?filterByFormula=${encodeURIComponent(
          formula
        )}&pageSize=10`
      );

      const items = (data.records || []).map((r) => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] || "",
        phone: r.fields?.[FIELD_PHONE] || "",
        email: r.fields?.[FIELD_EMAIL] || "",
      }));

      return res.json({
        ok: true,
        items,
      });
    }

    // =========================
    // OP NON RICONOSCIUTA
    // =========================
    return res.status(400).json({
      ok: false,
      error: "Unknown operation",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Server error",
    });
  }
}
