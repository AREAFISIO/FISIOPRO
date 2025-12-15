async function airtableFetch({ token, baseId, table, method = "GET", body }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

export default async function handler(req, res) {
  try {
    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID" });
    }

    // POST /api/appointments
    // body: { patientId, caseId, tipo, dataInizio, collaboratore, venditaId?, prestazioneId? }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { patientId, caseId, tipo, dataInizio, collaboratore, venditaId } = body || {};

      if (!patientId || !caseId || !tipo || !dataInizio) {
        return res.status(400).json({ error: "patientId, caseId, tipo, dataInizio are required" });
      }

      // Regola: se TRATTAMENTO => serve venditaId (poi la possiamo rendere “auto-select”)
      if (tipo === "TRATTAMENTO" && !venditaId) {
        return res.status(400).json({ error: "venditaId is required for TRATTAMENTO" });
      }

      const payload = {
        fields: {
          Anagrafica: [patientId],
          "Caso clinico": [caseId],
          "Tipo Appuntamento": tipo === "VALUTAZIONE" ? "Valutazione" : "Trattamento",
          Stato: "Programmato",
          "Data e ora INIZIO": dataInizio,
          ...(collaboratore ? { Collaboratore: collaboratore } : {}),
          ...(venditaId ? { Vendita: [venditaId] } : {}),
        },
      };

      const { ok, text } = await airtableFetch({
        token: AIRTABLE_TOKEN,
        baseId: AIRTABLE_BASE_ID,
        table: "EROGATO",
        method: "POST",
        body: payload,
      });

      if (!ok) return res.status(500).json({ error: text });

      const created = JSON.parse(text);
      return res.status(201).json({ id: created.id, fields: created.fields || {} });
    }

    // PATCH /api/appointments (chiusura seduta)
    // body: { appointmentId, newStatus }  es: "Erogato"
    if (req.method === "PATCH") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { appointmentId, newStatus } = body || {};
      if (!appointmentId || !newStatus) {
        return res.status(400).json({ error: "appointmentId and newStatus are required" });
      }

      // 1) Leggi l’appuntamento
      const readUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent("EROGATO")}/${appointmentId}`;
      const rr = await fetch(readUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const rtext = await rr.text();
      if (!rr.ok) return res.status(500).json({ error: rtext });
      const appt = JSON.parse(rtext);
      const f = appt.fields || {};

      const tipo = f["Tipo Appuntamento"];
      const vendita = (f["Vendita"] || [])[0];

      // 2) Se sto mettendo Erogato e tipo=Trattamento => controllo crediti
      if (newStatus === "Erogato" && tipo === "Trattamento") {
        if (!vendita) {
          return res.status(400).json({ error: "No Vendita linked to this TRATTAMENTO" });
        }

        // Qui il controllo crediti lo facciamo in modo semplice:
        // - leggiamo la vendita
        // - contiamo quante righe EROGATO già "Erogato" sono collegate a quella vendita
        const saleUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent("VENDITE")}/${vendita}`;
        const sr = await fetch(saleUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const stext = await sr.text();
        if (!sr.ok) return res.status(500).json({ error: stext });
        const sale = JSON.parse(stext);
        const sedute = Number((sale.fields || {})["Numero sedute"] || 0);

        // count erogati sulla vendita
        const filter = `AND({Vendita}='${vendita}', {Stato}='Erogato')`;
        const countUrl =
          `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent("EROGATO")}` +
          `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;

        const cr = await fetch(countUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const ctext = await cr.text();
        if (!cr.ok) return res.status(500).json({ error: ctext });
        const cdata = JSON.parse(ctext);
        const erogate = (cdata.records || []).length;

        // se sto chiudendo questa seduta, erogate attuali + 1 non deve superare sedute
        if (erogate + 1 > sedute) {
          return res.status(409).json({
            error: "No credits left on this sale",
            details: { sedute_acquistate: sedute, sedute_gia_erogate: erogate },
          });
        }
      }

      // 3) Aggiorna lo stato dell’appuntamento
      const updatePayload = { fields: { Stato: newStatus } };
      const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent("EROGATO")}/${appointmentId}`;

      const ur = await fetch(updateUrl, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      const utext = await ur.text();
      if (!ur.ok) return res.status(500).json({ error: utext });

      const updated = JSON.parse(utext);
      return res.status(200).json({ id: updated.id, fields: updated.fields || {} });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
