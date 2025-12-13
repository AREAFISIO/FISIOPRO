export default async function handler(req, res) {
  try {
    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ ok: false, error: "Missing AIRTABLE env vars" });
    }

    const op = req.query.op;

    const api = async (path) => {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });
      const txt = await r.text();
      let json;
      try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
      if (!r.ok) throw new Error(json?.error?.message || `Airtable error ${r.status}`);
      return json;
    };

    // === CONFIG BASE (DAL TUO CSV) ===
    const TABLE_PATIENTS = "ANAGRAFICA";
    const FIELD_NAME = "Cognome e Nome";
    const FIELD_PHONE = "Numero di telefono";
    const FIELD_EMAIL = "E-mail";

    // --- HEALTH (test rapido: risponde ok se Airtable è raggiungibile) ---
    if (op === "health") {
      // basta leggere 1 record per capire se API + permessi sono ok
      const patients = await api(`${encodeURIComponent(TABLE_PATIENTS)}?pageSize=1`);
      return res.json({
        ok: true,
        table: TABLE_PATIENTS,
        sample: patients?.records?.[0]?.id ? "OK" : "EMPTY",
      });
    }

    // --- SEARCH PAZIENTI ---
    if (op === "searchPatients") {
      const q = (req.query.q || "").toString().trim();
      if (!q) return res.json({ ok: true, items: [] });

      const table = encodeURIComponent(TABLE_PATIENTS);

      // Cerco su: Cognome e Nome / Numero di telefono / E-mail
      const qLower = q.toLowerCase().replaceAll('"', '\\"');

      const formula = `OR(
        FIND(LOWER("${qLower}"), LOWER({${FIELD_NAME}}&""))>0,
        FIND("${q}", {${FIELD_PHONE}}&"")>0,
        FIND(LOWER("${qLower}"), LOWER({${FIELD_EMAIL}}&""))>0
      )`;

      const data = await api(`${table}?filterByFormula=${encodeURIComponent(formula)}&pageSize=10`);
      const items = (data.records || []).map(r => ({
        id: r.id,
        name: r.fields?.[FIELD_NAME] || "",
        phone: r.fields?.[FIELD_PHONE] || "",
        email: r.fields?.[FIELD_EMAIL] || ""
      }));

      return res.json({ ok: true, items });
    }

    return res.status(400).json({ ok: false, error: "Unknown op" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

