import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";
import { memGet, memSet } from "./_common.js";

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

function scoreField(name, keywords) {
  const n = String(name || "").toLowerCase();
  let score = 0;
  for (const k of keywords) {
    const kk = String(k || "").toLowerCase();
    if (!kk) continue;
    if (n === kk) score += 100;
    else if (n.includes(kk)) score += 10;
  }
  // prefer longer, more specific names when tied
  score += Math.min(5, Math.floor(n.length / 10));
  return score;
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

async function discoverFieldNames(tableEnc) {
  // Pull some records and union field keys (works without Meta API).
  // Note: Airtable omits null/empty fields on each record, so we sample multiple records.
  const found = new Set();
  let offset = null;
  let pages = 0;
  while (pages < 3) { // up to ~300 records worst-case, but typically far less
    pages += 1;
    const qs = new URLSearchParams({ pageSize: "100" });
    if (offset) qs.set("offset", offset);
    const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
    for (const r of data.records || []) {
      const f = r.fields || {};
      for (const k of Object.keys(f)) found.add(k);
    }
    offset = data.offset || null;
    if (!offset) break;
  }
  return Array.from(found);
}

function resolveFieldNameHeuristic(fieldNames, keywords) {
  let best = "";
  let bestScore = -1;
  for (const name of fieldNames || []) {
    const s = scoreField(name, keywords);
    if (s > bestScore) {
      bestScore = s;
      best = name;
    }
  }
  // require at least some match (avoid picking random field)
  return bestScore >= 10 ? best : "";
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

    // Resolve field names:
    // 1) probe explicit candidates (fast if you know exact names)
    // 2) if still missing, discover field names by sampling records and use heuristics
    const startCandidates = [
      process.env.AGENDA_START_FIELD,
      "Data e ora INIZIO",
      "Data e ora Inizio",
      "Data INIZIO",
      "Inizio",
      "Start",
      "Start at",
    ].filter(Boolean);

    const operatorCandidates = [
      process.env.AGENDA_OPERATOR_FIELD,
      "Collaboratore",
      "Collaboratori",
      "Collaborator",
      "Operatore",
      "Operator",
      "Fisioterapista",
    ].filter(Boolean);

    const schemaCacheKey = `agenda:schema:${APPTS_TABLE_NAME}:${startCandidates.join("|")}:${operatorCandidates.join("|")}`;
    const cachedSchema = memGet(schemaCacheKey);
    let FIELD_START = cachedSchema?.FIELD_START || "";
    let FIELD_OPERATOR = cachedSchema?.FIELD_OPERATOR || "";

    if (!FIELD_START || !FIELD_OPERATOR) {
      FIELD_START = await resolveFieldNameByProbe(tableEnc, startCandidates);
      FIELD_OPERATOR = await resolveFieldNameByProbe(tableEnc, operatorCandidates);
    }

    let discovered = [];
    if (!FIELD_START || !FIELD_OPERATOR) {
      const discoveredCacheKey = `agenda:fields:${APPTS_TABLE_NAME}`;
      discovered = memGet(discoveredCacheKey) || [];
      if (!discovered.length) {
        discovered = await discoverFieldNames(tableEnc);
        // cache discovered fields briefly
        memSet(discoveredCacheKey, discovered, 10 * 60_000);
      }
      if (!FIELD_START) {
        FIELD_START =
          resolveFieldNameHeuristic(discovered, ["data e ora inizio", "inizio", "start", "inizio appuntamento"]) ||
          "";
      }
      if (!FIELD_OPERATOR) {
        FIELD_OPERATOR =
          resolveFieldNameHeuristic(discovered, ["collaboratore", "collaboratori", "operatore", "operator", "fisioterapista"]) ||
          "";
      }
    }

    if (!FIELD_START || !FIELD_OPERATOR) {
      return res.status(500).json({
        ok: false,
        error: "agenda_schema_mismatch",
        details: {
          table: APPTS_TABLE_NAME,
          resolved: { FIELD_START, FIELD_OPERATOR },
          tried: {
            start: startCandidates,
            operator: operatorCandidates,
          },
          discoveredFields: discovered,
        },
      });
    }

    // cache schema resolution (warm instance)
    memSet(schemaCacheKey, { FIELD_START, FIELD_OPERATOR }, 60 * 60_000);

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
      const emailKey = `collabIdByEmail:${String(email)}`;
      let userRecId = memGet(emailKey) || "";
      if (!userRecId) {
        const qsUser = new URLSearchParams({ filterByFormula: fEmail, maxRecords: "1", pageSize: "1" });
        const userData = await airtableFetch(`${collabTable}?${qsUser.toString()}`);
        const rec = userData.records?.[0] || null;
        userRecId = rec?.id || "";
        if (userRecId) memSet(emailKey, userRecId, 10 * 60_000);
      }

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

