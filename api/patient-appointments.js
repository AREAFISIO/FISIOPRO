// api/patient-appointments.js
import { ensureRes, normalizeRole, requireSession } from "./_auth.js";

function escAirtableString(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

function isUnknownFieldError(e) {
  const msg = String(e?.message || "").toLowerCase();
  return msg.includes("unknown field name") || msg.includes("unknown field names");
}

async function fetchJsonOrText(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function getCollaboratorRecordIdByEmail({ baseId, token, email }) {
  const tableName = process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI";
  const formula = `LOWER({Email}) = LOWER("${escAirtableString(email)}")`;
  const url =
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}` +
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&maxRecords=1&pageSize=1`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await fetchJsonOrText(res);
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.raw || `Airtable error ${res.status}`;
    throw new Error(msg);
  }
  return data?.records?.[0]?.id || "";
}

async function airtableListAppointments({ baseId, token, patientId, role, sessionEmail, max = 200 }) {
  const tableName = "APPUNTAMENTI";

  const FIELD_START = "Data e ora INIZIO";
  const FIELD_END = "Data e ora FINE";
  const FIELD_DUR = "Durata";

  // filtro base: appuntamenti dove Paziente contiene patientId
  const patientFilter = `FIND("${escAirtableString(patientId)}", ARRAYJOIN({Paziente}))`;

  let formula = patientFilter;
  let usedEmailField = false;

  if (role === "physio") {
    // Try schema A first (APPUNTAMENTI has {Email})
    formula = `AND(${patientFilter}, LOWER({Email}) = LOWER("${escAirtableString(sessionEmail)}"))`;
    usedEmailField = true;
  }

  const baseUrl =
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}` +
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent(FIELD_START)}` +
    `&sort%5B0%5D%5Bdirection%5D=desc` +
    `&pageSize=100` +
    `&fields[]=${encodeURIComponent("Email")}` +
    `&fields[]=${encodeURIComponent(FIELD_START)}` +
    `&fields[]=${encodeURIComponent(FIELD_END)}` +
    `&fields[]=${encodeURIComponent(FIELD_DUR)}` +
    `&fields[]=${encodeURIComponent("Paziente")}`;

  let out = [];
  let offset = undefined;

  while (out.length < max) {
    const pageUrl = offset ? `${baseUrl}&offset=${encodeURIComponent(offset)}` : baseUrl;

    const res = await fetch(pageUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const data = await fetchJsonOrText(res);
      const msg = data?.error?.message || data?.error || data?.raw || `Airtable error ${res.status}`;
      // If physio + schema A failed because {Email} doesn't exist, retry once with linked-operator schema.
      if (role === "physio" && usedEmailField && isUnknownFieldError({ message: msg })) {
        const collabRecId = await getCollaboratorRecordIdByEmail({ baseId, token, email: sessionEmail });
        if (!collabRecId) return []; // safest fallback: no access

        const candidateFields = [
          process.env.AGENDA_OPERATOR_FIELD,
          "Collaboratore",
          "Collaboratori",
          "Operatore",
          "Operator",
          "Fisioterapista",
        ].filter(Boolean);

        for (const fieldName of candidateFields) {
          const f = String(fieldName || "").trim();
          if (!f) continue;
          const formula2 = `AND(${patientFilter}, FIND("${escAirtableString(collabRecId)}", ARRAYJOIN({${f}})))`;
          const url2 =
            `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}` +
            `?filterByFormula=${encodeURIComponent(formula2)}` +
            `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent(FIELD_START)}` +
            `&sort%5B0%5D%5Bdirection%5D=desc` +
            `&pageSize=100` +
            `&fields[]=${encodeURIComponent(FIELD_START)}` +
            `&fields[]=${encodeURIComponent(FIELD_END)}` +
            `&fields[]=${encodeURIComponent(FIELD_DUR)}` +
            `&fields[]=${encodeURIComponent("Paziente")}`;

          // restart pagination with new formula
          out = [];
          offset = undefined;
          usedEmailField = false;

          while (out.length < max) {
            const pUrl = offset ? `${url2}&offset=${encodeURIComponent(offset)}` : url2;
            const rr = await fetch(pUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (!rr.ok) {
              const d2 = await fetchJsonOrText(rr);
              const msg2 = d2?.error?.message || d2?.error || d2?.raw || `Airtable error ${rr.status}`;
              if (isUnknownFieldError({ message: msg2 })) break; // wrong operator field, try next
              throw new Error(`Airtable list failed: ${rr.status} ${msg2}`);
            }
            const d2 = await rr.json();
            out = out.concat(d2.records || []);
            if (!d2.offset) break;
            offset = d2.offset;
          }

          if (out.length) return out;
        }

        return []; // couldn't resolve operator field
      }

      throw new Error(`Airtable list failed: ${res.status} ${msg}`);
    }

    const data = await res.json();
    out = out.concat(data.records || []);
    if (!data.offset) break;
    offset = data.offset;
  }

  return out;
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: "Missing Airtable env vars" });
    }

    const patientId = req.query.id;
    if (!patientId) return res.status(400).json({ error: "Missing id" });

    const role = normalizeRole(session.role);
    const sessionEmail = String(session.email || "").toLowerCase();

    const records = await airtableListAppointments({
      baseId: AIRTABLE_BASE_ID,
      token: AIRTABLE_TOKEN,
      patientId,
      role,
      sessionEmail,
      max: 500,
    });

    // NB: RBAC is applied in Airtable query when possible; we keep mapping lean.
    const mapped = records.map((r) => ({
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
