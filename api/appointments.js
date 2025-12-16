// api/appointments.js  (COMMONJS - compatibile Vercel Functions)

module.exports = async function handler(req, res) {
  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE = process.env.AIRTABLE_TABLE_APPOINTMENTS || "APPUNTAMENTI";

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({
        error: "Missing environment variables",
        missing: {
          AIRTABLE_TOKEN: !AIRTABLE_TOKEN,
          AIRTABLE_BASE_ID: !AIRTABLE_BASE_ID,
        },
      });
    }

    // -------------------------
    // GET: lista appuntamenti
    // /api/appointments?start=ISO&end=ISO
    // -------------------------
    if (req.method === "GET") {
      const { start, end, maxRecords } = req.query || {};

      const params = new URLSearchParams();
      params.set("pageSize", "100");
      if (maxRecords) params.set("maxRecords", String(maxRecords));
      params.set("sort[0][field]", "Data");
      params.set("sort[0][direction]", "asc");

      if (start && end) {
        // IMPORTANT: niente multilinea (evita sorprese)
        const formula =
          `AND(IS_AFTER({Data}, DATETIME_PARSE("${start}")),` +
          `IS_BEFORE({Data}, DATETIME_PARSE("${end}")))`;
        params.set("filterByFormula", formula);
      }

      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?${params.toString()}`;

      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: "Airtable error (GET)", details: data });
      }

      const out = (data.records || []).map((rec) => {
        const f = rec.fields || {};

        const patientName =
          Array.isArray(f["Paziente"]) ? (f["Paziente"][0] || "") : (f["Paziente"] || "");

        const patientId =
          Array.isArray(f["ANAGRAFICA"]) ? (f["ANAGRAFICA"][0] || "") : (f["ANAGRAFICA"] || "");

        const therapist =
          Array.isArray(f["Operatore"]) ? (f["Operatore"][0] || "") : (f["Operatore"] || "");

        return {
          id: rec.id,
          patient_id: patientId,
          patient_name: patientName,
          start_at: f["Data"] || "",
          end_at: "",
          status: f["Stato"] || "",
          service_name: f["Prestazione"] || "",
          duration_label: f["Durata"] || "",
          therapist_name: therapist,
          location_name: "",
          internal_note: f["Nota rapida"] || "",
          patient_note: f["Note"] || "",
        };
      });

      return res.status(200).json({ appointments: out });
    }

    // -------------------------
    // PATCH: aggiorna 1 appuntamento
    // /api/appointments?id=recXXXX
    // -------------------------
    if (req.method === "PATCH") {
      const { id } = req.query || {};
      if (!id) return res.status(400).json({ error: "Missing query param: id (Airtable recordId)" });

      let payload = req.body;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload || "{}"); } catch { payload = {}; }
      }
      if (!payload || typeof payload !== "object") payload = {};

      const fields = {};
      if ("status" in payload) fields["Stato"] = payload.status ?? "";
      if ("service_name" in payload) fields["Prestazione"] = payload.service_name ?? "";
      if ("duration_label" in payload) fields["Durata"] = payload.duration_label ?? "";
      if ("therapist_name" in payload) fields["Operatore"] = payload.therapist_name ?? "";
      if ("internal_note" in payload) fields["Nota rapida"] = payload.internal_note ?? "";
      if ("patient_note" in payload) fields["Note"] = payload.patient_note ?? "";

      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;

      const r = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: "Airtable error (PATCH)", details: data });
      }

      const f = data.fields || {};
      const patientName =
        Array.isArray(f["Paziente"]) ? (f["Paziente"][0] || "") : (f["Paziente"] || "");
      const patientId =
        Array.isArray(f["ANAGRAFICA"]) ? (f["ANAGRAFICA"][0] || "") : (f["ANAGRAFICA"] || "");
      const therapist =
        Array.isArray(f["Operatore"]) ? (f["Operatore"][0] || "") : (f["Operatore"] || "");

      return res.status(200).json({
        id: data.id,
        patient_id: patientId,
        patient_name: patientName,
        start_at: f["Data"] || "",
        end_at: "",
        status: f["Stato"] || "",
        service_name: f["Prestazione"] || "",
        duration_label: f["Durata"] || "",
        therapist_name: therapist,
        location_name: "",
        internal_note: f["Nota rapida"] || "",
        patient_note: f["Note"] || "",
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("appointments.js crash:", e);
    return res.status(500).json({
      error: "Function crashed",
      details: String(e && (e.stack || e.message) || e),
    });
  }
};
