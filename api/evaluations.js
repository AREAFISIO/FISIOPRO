export default async function handler(req, res) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = "VALUTAZIONI";

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID" });
  }

  const baseUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET: singolo record o lista per paziente
  if (req.method === "GET") {
    const { id, patientId, offset } = req.query;

    // singola valutazione
    if (id) {
      const r = await fetch(`${baseUrl}/${id}`, { headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.status(200).json({ id: data.id, fields: data.fields || {} });
    }

    // lista per paziente
    if (!patientId) return res.status(400).json({ error: "patientId is required" });

    const safePid = patientId.toString().replace(/'/g, "\\'");
    const filterByFormula = `FIND('${safePid}', ARRAYJOIN({PAZIENTE}))`;

    const url =
      `${baseUrl}?pageSize=25` +
      (offset ? `&offset=${encodeURIComponent(offset)}` : "") +
      `&filterByFormula=${encodeURIComponent(filterByFormula)}` +
      `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent("DATA VISITA")}` +
      `&sort%5B0%5D%5Bdirection%5D=desc`;

    const r = await fetch(url, { headers });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const records = (data.records || []).map(rec => ({ id: rec.id, fields: rec.fields || {} }));
    return res.status(200).json({ records, offset: data.offset || null });
  }

  // POST: CREATE (se manca id) oppure PATCH (se c’è id)
  if (req.method === "POST") {
    const body = req.body || {};

    // CREATE
    if (!body.id && body.patientId) {
      const patientId = body.patientId;
      const nowISO = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

      const fields = {
        "PAZIENTE": [patientId],
        "DATA VISITA": body.dataVisita || nowISO,
        "PRIMA VALUTAZIONE": "",
        "ANAMNESI RECENTE": "",
        "ANAMNESI REMOTA": "",
        "DOLORE SEDE": "",
        "SCALA DOLORE NRS": "",
        "NOTE": "",
        "QUICK TEST": "",
        "SPECIAL TEST": "",
        "TEST NEUROLOGICO": ""
      };

      const r = await fetch(baseUrl, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ fields }] })
      });

      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);

      const rec = data.records?.[0];
      return res.status(200).json({ ok: true, id: rec.id, fields: rec.fields || {} });
    }

    // PATCH
    const { id, fields } = body;
    if (!id || !fields) return res.status(400).json({ error: "id and fields are required" });

    const r = await fetch(`${baseUrl}/${id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    return res.status(200).json({ ok: true, id: data.id, fields: data.fields || {} });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
