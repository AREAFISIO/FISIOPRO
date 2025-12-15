export default async function handler(req, res) {
  try {
    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID" });
    }

    const TABLE = encodeURIComponent("CASI CLINICI");

    // GET /api/cases?patientId=recXXX&active=1
    if (req.method === "GET") {
      const { patientId, active } = req.query;
      if (!patientId) return res.status(400).json({ error: "patientId is required" });

      const whereActive = active ? `, {Stato Caso}='Attivo'` : "";
      const filter = `AND({Paziente}='${patientId}'${whereActive})`;
      const url =
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE}` +
        `?filterByFormula=${encodeURIComponent(filter)}` +
        `&sort%5B0%5D%5Bfield%5D=Created%20time&sort%5B0%5D%5Bdirection%5D=desc&pageSize=1`;

      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const text = await r.text();
      if (!r.ok) return res.status(500).json({ error: text });

      const data = JSON.parse(text);
      const record = (data.records || [])[0] || null;

      return res.status(200).json({
        case: record
          ? { id: record.id, fields: record.fields || {} }
          : null,
      });
    }

    // POST /api/cases
    // body: { patientId, distretto, problema, lato }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { patientId, distretto, problema, lato } = body || {};

      if (!patientId || !distretto || !problema) {
        return res.status(400).json({ error: "patientId, distretto, problema are required" });
      }

      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE}`;
      const payload = {
        fields: {
          Paziente: [patientId],
          "Stato Caso": "Attivo",
          Distretto: distretto,
          "Problema principale": problema,
          ...(lato ? { Lato: lato } : {}),
        },
      };

      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await r.text();
      if (!r.ok) return res.status(500).json({ error: text });

      const created = JSON.parse(text);
      return res.status(201).json({ id: created.id, fields: created.fields || {} });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
