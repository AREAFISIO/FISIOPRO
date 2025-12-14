export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_PATIENTS_TABLE } = process.env;

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: "Missing environment variables: AIRTABLE_TOKEN or AIRTABLE_BASE_ID" });
    }

    // ✅ La tua tabella pazienti si chiama ANAGRAFICA (default)
    const TABLE = AIRTABLE_PATIENTS_TABLE || "ANAGRAFICA";

    // Query param utili
    const { recordId, offset } = req.query;

    const tableName = encodeURIComponent(TABLE);

    // Se passi recordId -> restituisce 1 solo record
    const url = recordId
      ? `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableName}/${encodeURIComponent(recordId)}`
      : `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableName}?pageSize=50${
          offset ? `&offset=${encodeURIComponent(offset)}` : ""
        }`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(500).json({ error: text });
    }

    const data = JSON.parse(text);

    // Se è un singolo record (GET /{table}/{recordId})
    if (data && data.id) {
      return res.status(200).json({ id: data.id, fields: data.fields || {} });
    }

    // Lista records
    const records = (data.records || []).map((r) => ({
      id: r.id,
      fields: r.fields || {},
    }));

    return res.status(200).json({
      table: TABLE,
      records,
      offset: data.offset || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Internal error" });
  }
}
