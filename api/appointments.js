// api/appointments.js
export default async function handler(req, res) {
  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE = process.env.AIRTABLE_TABLE_APPOINTMENTS || "APPUNTAMENTI";

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID" });
    }

    // -------------------------
    // GET: lista appuntamenti
    // -------------------------
    if (req.method === "GET") {
      // opzionali: start/end (ISO) per filtrare
      const { start, end, maxRecords } = req.query;

      let filterByFormula = "";
      if (start && end) {
        // Airtable formula: record dentro intervallo
        // NB: {Data} è il campo datetime (dal tuo CSV)
        filterByFormula = `AND(
          IS_AFTER({Data}, DATETIME_PARSE("${start}")),
          IS_BEFORE({Data}, DATETIME_PARSE("${end}"))
        )`;
      }

      const params = new URLSearchParams();
      if (filterByFormula) params.set("filterByFormula", filterByFormula);
      params.set("pageSize", "100");
      if (maxRecords) params.set("maxRecords", String(maxRecords));
      params.set("sort[0][field]", "Data");
      params.set("sort[0][direction]", "asc");

      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
        TABLE
      )}?${params.toString()}`;

      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });

      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: "Airtable error", details: data });

      // Normalizzazione -> formato usato da UI
      const out = (data.records || []).map((rec) => {
        const f = rec.fields || {};

        // questi campi vengono dal tuo CSV
        const patientName =
          Array.isArray(f["Paziente"]) ? (f["Paziente"][0] || "") : (f["Paziente"] || "");

        const patientId =
          Array.isArray(f["ANAGRAFICA"]) ? (f["ANAGRAFICA"][0] || "") : (f["ANAGRAFICA"] || "");

        return {
          id: rec.id, // recordId vero di Airtable (recXXXX)
          patient_id: patientId,
          patient_name: patientName,

          start_at: f["Data"] || "",
          end_at: "",

          status: f["Stato"] || "",
          service_name: f["Prestazione"] || "",
          duration_label: f["Durata"] || "",

          therapist_name:
            Array.isArray(f["Operatore"]) ? (f["Operatore"][0] || "") : (f["Operatore"] || ""),

          location_name: "",

          internal_note: f["Nota rapida"] || "",
          patient_note: f["Note"] || "",
        };
      });

      return res.status(200).json({ appointments: out });
    }

    // -------------------------
    // PATCH: aggiorna 1 appuntamento
    // chiamata: /api/appointments?id=recXXXX
    // -------------------------
    if (req.method === "PATCH") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Missing query param: id (recordId)" });

      // body potrebbe arrivare come stringa
      let payload = req.body;
      if (typeof payload === "string") payload = JSON.parse(payload || "{}");
      if (!payload || typeof payload !== "object") payload = {};

      // Mappa campi UI -> campi Airtable (dal tuo CSV)
      const fields = {};

      if ("status" in payload) fields["Stato"] = payload.status ?? "";
      if ("service_name" in payload) fields["Prestazione"] = payload.service_name ?? "";
      if ("duration_label" in payload) fields["Durata"] = payload.duration_label ?? "";
      if ("therapist_name" in payload) fields["Operatore"] = payload.therapist_name ?? "";
      if ("internal_note" in payload) fields["Nota rapida"] = payload.internal_note ?? "";
      if ("patient_note" in payload) fields["Note"] = payload.patient_note ?? "";

      // Se non c’è niente da aggiornare
      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
        TABLE
      )}/${id}`;

      const r = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields }),
      });

      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: "Airtable error", details: data });

      // Ritorno lo stesso formato della GET
      const f = data.fields || {};
      const patientName =
        Array.isArray(f["Paziente"]) ? (f["Paziente"][0] || "") : (f["Paziente"] || "");
      const patientId =
        Array.isArray(f["ANAGRAFICA"]) ? (f["ANAGRAFICA"][0] || "") : (f["ANAGRAFICA"] || "");

      return res.status(200).json({
        id: data.id,
        patient_id: patientId,
        patient_name: patientName,

        start_at: f["Data"] || "",
        end_at: "",

        status: f["Stato"] || "",
        service_name: f["Prestazione"] || "",
        duration_label: f["Durata"] || "",
        therapist_name: Array.isArray(f["Operatore"]) ? (f["Operatore"][0] || "") : (f["Operatore"] || ""),
        location_name: "",
        internal_note: f["Nota rapida"] || "",
        patient_note: f["Note"] || "",
      });
    }

    // altri metodi non permessi
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error", details: String(e?.message || e) });
  }
}

