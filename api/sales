export default async function handler(req, res) {
  try {
    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID" });
    }

    const TABLE = encodeURIComponent("VENDITE");

    // GET /api/sales?caseId=recCASE
    if (req.method === "GET") {
      const { caseId } = req.query;
      if (!caseId) return res.status(400).json({ error: "caseId is required" });

      const filter = `{Caso clinico}='${caseId}'`;
      const url =
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE}` +
        `?filterByFormula=${encodeURIComponent(filter)}` +
        `&sort%5B0%5D%5Bfield%5D=Created%20time&sort%5B0%5D%5Bdirection%5D=desc&pageSize=50`;

      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const text = await r.text();
      if (!r.ok) return res.status(500).json({ error: text });

      const data = JSON.parse(text);
      const records = (data.records || []).map((x) => ({ id: x.id, fields: x.fields || {} }));
      return res.status(200).json({ records });
    }

    // POST /api/sales
    // body: { patientId, caseId, prestazioneId, numeroSedute, statoPagamento }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { patientId, caseId, prestazioneId, numeroSedute, statoPagamento } = body || {};

      if (!patientId || !caseId || !prestazioneId || typeof numeroSedute !== "number") {
        return res.status(400).json({
          error: "patientId, caseId, prestazioneId, numeroSedute(number) are required",
        });
      }

      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE}`;
      const payload = {
        fields: {
          Paziente: [patientId],
          "Caso clinico": [caseId],
          Prestazione: [prestazioneId],
          "Numero sedute": numeroSedute,
          ...(statoPagamento ? { "Stato pagamento": statoPagamento } : {}),
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
