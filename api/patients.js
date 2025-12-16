// api/patient.js
import crypto from "crypto";

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : "";
}

function verifySession(req) {
  const { SESSION_SECRET } = process.env;
  if (!SESSION_SECRET) return null;

  const token = getCookie(req, "fisio_session");
  if (!token) return null;

  // token formato: base64(payload).hex(hmac)
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;

  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(b64)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }

  // scadenza hard 1h
  if (!payload.exp || Date.now() > payload.exp) return null;

  return payload; // { email, role, exp, last }
}

async function airtableGetRecord({ baseId, token, tableName, recordId }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    tableName
  )}/${recordId}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Airtable GET record failed: ${res.status} ${txt}`);
  }
  return await res.json();
}

async function airtableFindAppointmentsForPatient({ baseId, token, patientId }) {
  // Serve per permessi fisio: verifico se esiste almeno 1 appuntamento con Email = fisio e Paziente contiene patientId
  const tableName = "APPUNTAMENTI";
  const formula = `FIND("${patientId}", ARRAYJOIN({Paziente}))`;

  const url =
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}` +
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&pageSize=10`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Airtable list appointments failed: ${res.status} ${txt}`);
  }
  return await res.json(); // {records: [...]}
}

export default async function handler(req, res) {
  try {
    const session = verifySession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: "Missing Airtable env vars" });
    }

    const patientId = req.query.id;
    if (!patientId) return res.status(400).json({ error: "Missing id" });

    // RBAC: se fisio, deve avere almeno un appuntamento collegato a quel paziente
    if (session.role === "Fisioterapista") {
      const list = await airtableFindAppointmentsForPatient({
        baseId: AIRTABLE_BASE_ID,
        token: AIRTABLE_TOKEN,
        patientId,
      });

      const allowed = (list.records || []).some((r) => {
        const email = (r.fields?.Email || "").toLowerCase();
        return email === (session.email || "").toLowerCase();
      });

      if (!allowed) return res.status(403).json({ error: "Forbidden" });
    }

    // Leggo record paziente
    const record = await airtableGetRecord({
      baseId: AIRTABLE_BASE_ID,
      token: AIRTABLE_TOKEN,
      tableName: "ANAGRAFICA",
      recordId: patientId,
    });

    // Ritorno solo campi utili (evitiamo leak di campi inutili)
    const f = record.fields || {};
    return res.status(200).json({
      id: record.id,
      Nome: f["Nome"] || "",
      Cognome: f["Cognome"] || "",
      Telefono: f["Telefono"] || "",
      Email: f["Email"] || "",
      "Data di nascita": f["Data di nascita"] || "",
      Note: f["Note"] || "",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
