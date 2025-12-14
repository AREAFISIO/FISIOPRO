export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      AIRTABLE_TOKEN,
      AIRTABLE_BASE_ID,
    } = process.env;

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: "Missing environment variables" });
    }

    const tableName = encodeURIComponent("TRATTAMENTI");
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableName}?pageSize=50`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: text });
    }

    const data = await response.json();

    const records = (data.records || []).map(r => ({
      id: r.id,
      fields: r.fields || {},
    }));

    return res.status(200).json({ records });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

