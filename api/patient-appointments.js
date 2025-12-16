// api/patient-appointments.js
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

  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

async function airtableListAppointments({ baseId, token, patientId, max = 200 }) {
  const tableName = "APPUNTAMENTI";

  // filtro: appuntamenti dove Paziente contiene patientId
  const formula = `FIND("${patientId}", ARRAYJOIN({Paziente}))`;

  // ordino per data inizio desc
  const url =
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}` +
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent("Data e ora INIZIO")}` +
    `&sort%5B0%5D%5Bdirection%5D=desc` +
    `&pageSize=100`;

  let out = [];
  let offset = undefined;

  while (out.length < max) {
    const pageUrl = offset ? `${url}&offset=${encodeURIComponent(offset)}` : url;

    const res = await fetch(pageUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Airtable list failed: ${res.status} ${txt}`);
    }

    const data = await res.json();
    out = out.concat(data.records || []);
    if (!data.offset) break;
    offset = data.offset;
  }

  return out;
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

    const records = await airtableListAppointments({
      baseId: AIRTABLE_BASE_ID,
      token: AIRTABLE_TOKEN,
      patientId,
      max: 500,
    });

    // RBAC: se fisio, filtro SOLO i suoi appuntamenti
    const filtered =
      session.role === "Fisioterapista"
        ? records.filter(
            (r) =>
              (r.fields?.Email || "").toLowerCase() ===
              (session.email || "").toLowerCase()
          )
        : records;

    const mapped = filtered.map((r) => ({
      id: r.id,
      Email: r.fields?.Email || "",
      "Data e ora INIZIO": r.fields?.["Data e ora INIZIO"] || "",
      "Data e ora FINE": r.fields?.["Data e ora FINE"] || "",
      Durata: r.fields?.Durata ?? "",
    }));

    return res.status(200).json({ records: mapped });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
