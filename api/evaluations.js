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

    //
