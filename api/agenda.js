import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function ymdToUtcStartISO(ymd) {
  const [y, m, d] = String(ymd).split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString();
}

function addDaysUtcISO(iso, days) {
  const dt = new Date(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString();
}

function isUnknownFieldError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("unknown field name") || s.includes("unknown field names");
}

async function probeField(tableEnc, candidate) {
  const name = String(candidate || "").trim();
  if (!name) return false;
  const qs = new URLSearchParams({ pageSize: "1" });
  qs.append("fields[]", name);
  try {
    await airtableFetch(`${tableEnc}?${qs.toString()}`);
    return true;
  } catch (e) {
    if (isUnknownFieldError(e?.message)) return false;
    // Any other error should bubble up (token/base id, perms, etc.)
    throw e;
  }
}

async function resolveFieldNameByProbe(tableEnc, candidates) {
  for (const c of candidates) {
    if (await probeField(tableEnc, c)) return String(c).trim();
  }
  return "";
}

export default async function handler(req, res) {
  ensureRes(res);
  try {
    const session = requireSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });

    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const from = String(req.query?.from || "").trim();
    const to = String(req.query?.to || "").trim();
    if (!isYmd(from) || !isYmd(to)) {
      return res.status(400).json({ ok: false, error: "from/to must be YYYY-MM-DD" });
    }

    const startISO = ymdToUtcStartISO(from);
    const endExclusiveISO = addDaysUtcISO(ymdToUtcStartISO(to), 1);

    const APPTS_TABLE_NAME = process.env.AGENDA_TABLE || "APPUNTAMENTI";

    const tableEnc = encodeURIComponent(APPTS_TABLE_NAME);

    // Resolve field names by probing fields[] (works even if table is empty or fields are null).
    const FIELD_START = await resolveFieldNameByProbe(tableEnc, [
      process.env.AGENDA_START_FIELD,
      "Data e ora INIZIO",
      "Data e ora Inizio",
      "Start",
      "Inizio",
    ]);

    const FIELD_OPERATOR = await resolveFieldNameByProbe(tableEnc, [
      process.env.AGENDA_OPERATOR_FIELD,
      "Collaboratore",
      "Collaborator",
      "Operatore",
      "Operator",
    ]);

    if (!FIELD_START || !FIELD_OPERATOR) {
      return res.status(500).json({
        ok: false,
        error: "agenda_schema_mismatch",
        details: {
          table: APPTS_TABLE_NAME,
          resolved: { FIELD_START, FIELD_OPERATOR },
          tried: {
            start: [process.env.AGENDA_START_FIELD, "Data e ora INIZIO", "Data e ora Inizio", "Start", "Inizio"].filter(Boolean),
            operator: [process.env.AGENDA_OPERATOR_FIELD, "Collaboratore", "Collaborator", "Operatore", "Operator"].filter(Boolean),
          },
        },
      });
    }

    // Debug mode: /api/agenda?op=schema&from=...&to=...
    if (String(req.query?.op || "") === "schema") {
      return res.status(200).json({
        ok: true,
        table: APPTS_TABLE_NAME,
        resolved: { FIELD_START, FIELD_OPERATOR },
        note: "Field names were resolved by probing fields[] (no Airtable Meta API required).",
      });
    }

    const rangeFilter = `AND(
      OR(IS_AFTER({${FIELD_START}}, "${startISO}"), IS_SAME({${FIELD_START}}, "${startISO}")),
      IS_BEFORE({${FIELD_START}}, "${endExclusiveISO}")
    )`;

    const role = normalizeRole(session.role);
    const email = String(session.email || "").toLowerCase();

    // RBAC filter for physio:
    // Link via {Collaboratore} (linked to COLLABORATORI) using the current user's Email.
    // IMPORTANT: Do not fallback to an "Email" field on APPUNTAMENTI, since many bases don't have it
    // (and misconfigured env vars like AGENDA_EMAIL_FIELD=email can break Airtable formulas).
    let roleFilter = "TRUE()";
    if (role === "physio") {
      const collabTable = encodeURIComponent(process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI");
      const fEmail = `LOWER({Email}) = LOWER("${String(email).replace(/"/g, '\\"')}")`;
      const qsUser = new URLSearchParams({ filterByFormula: fEmail, maxRecords: "1", pageSize: "1" });
      const userData = await airtableFetch(`${collabTable}?${qsUser.toString()}`);
      const rec = userData.records?.[0] || null;
      const userRecId = rec?.id || "";

      if (userRecId) {
        // linked-record field match
        roleFilter = `FIND("${userRecId}", ARRAYJOIN({${FIELD_OPERATOR}}))`;
      } else {
        // safest fallback: no access if mapping can't be resolved
        roleFilter = "FALSE()";
      }
    }

    const qs = new URLSearchParams({
      filterByFormula: `AND(${rangeFilter}, ${roleFilter})`,
      pageSize: "100",
      "sort[0][field]": FIELD_START,
      "sort[0][direction]": "asc",
    });

    const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);

    // If Collaboratore/Operatore is a linked-record field, Airtable returns record IDs.
    // Resolve to names via COLLABORATORI table so the UI can show proper operator names.
    const operatorIds = new Set();
    for (const r of data.records || []) {
      const v = r.fields?.[FIELD_OPERATOR];
      if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x === "string" && x.startsWith("rec")) operatorIds.add(x);
        }
      }
    }

    let operatorIdToName = {};
    if (operatorIds.size) {
      const tableOps = encodeURIComponent(process.env.AIRTABLE_COLLABORATORI_TABLE || "COLLABORATORI");
      const ids = Array.from(operatorIds);

      const pickName = (fields) => {
        const f = fields || {};
        const nome = String(f.Nome || "").trim();
        const cognome = String(f.Cognome || "").trim();
        const full = [nome, cognome].filter(Boolean).join(" ").trim();
        return (
          full ||
          String(f["Cognome e Nome"] || "").trim() ||
          String(f["Nome completo"] || "").trim() ||
          String(f.Name || "").trim() ||
          String(f["Full Name"] || "").trim() ||
          ""
        );
      };

      // Chunk OR() to stay under formula limits
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        const orParts = chunk.map((id) => `RECORD_ID()="${String(id).replace(/"/g, '\\"')}"`);
        const formula = `OR(${orParts.join(",")})`;
        const qsOps = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
        const opsData = await airtableFetch(`${tableOps}?${qsOps.toString()}`);
        for (const rec of opsData.records || []) {
          const name = String(pickName(rec.fields) || "").trim();
          if (name) operatorIdToName[rec.id] = name;
        }
      }
    }

    const items = (data.records || []).map((r) => {
      const f = r.fields || {};
      const opVal = f[FIELD_OPERATOR];
      let operatorName = "";
      if (Array.isArray(opVal) && opVal.some((x) => typeof x === "string" && x.startsWith("rec"))) {
        operatorName = String(operatorIdToName[opVal[0]] || opVal[0] || "");
        f[FIELD_OPERATOR] = operatorName;
      } else if (Array.isArray(opVal)) {
        operatorName = String(opVal[0] || "");
        f[FIELD_OPERATOR] = operatorName;
      } else if (opVal) {
        operatorName = String(opVal);
      }

      const dt = String(f[FIELD_START] || "");
      return {
        id: r.id,
        datetime: dt,
        date: dt ? dt.slice(0, 10) : "",
        time: dt ? dt.slice(11, 16) : "",
        operator: operatorName,
        fields: f,
      };
    });

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

