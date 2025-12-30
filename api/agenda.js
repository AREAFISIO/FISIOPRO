import { airtableFetch, ensureRes, normalizeRole, requireSession } from "./_auth.js";
import { memGet, memGetOrSet, memSet, setPrivateCache } from "./_common.js";

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

async function discoverFieldNamesViaMeta(tableName) {
  // Prefer Airtable Meta API (lists all fields, even if empty in records).
  // If the token doesn't have meta access, we silently fall back to record sampling.
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return [];

  const url = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(AIRTABLE_BASE_ID)}/tables`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) return [];

    const wanted = String(tableName || "").trim();
    const tables = json.tables || [];
    const t =
      tables.find((x) => String(x?.name || "") === wanted) ||
      tables.find((x) => String(x?.name || "").toLowerCase() === wanted.toLowerCase()) ||
      null;
    const fields = t?.fields || [];
    return fields.map((f) => String(f?.name || "")).filter(Boolean);
  } catch {
    return [];
  }
}

async function discoverFieldNames({ tableEnc, tableName }) {
  const viaMeta = await discoverFieldNamesViaMeta(tableName);
  if (viaMeta.length) return { fields: viaMeta, source: "meta" };

  // Fallback: pull some records and union field keys (works without Meta API).
  // Note: Airtable omits null/empty fields on each record, so we sample multiple records.
  const found = new Set();
  const seenDateTimeCounts = new Map(); // fieldName -> count of ISO-like datetime values
  const seenLinkedRecCounts = new Map(); // fieldName -> count of arrays containing rec*
  let offset = null;
  let pages = 0;
  while (pages < 10) { // up to ~1000 records; only used when schema is unknown
    pages += 1;
    const qs = new URLSearchParams({ pageSize: "100" });
    if (offset) qs.set("offset", offset);
    const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
    for (const r of data.records || []) {
      const f = r.fields || {};
      for (const [k, v] of Object.entries(f)) {
        found.add(k);
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
          seenDateTimeCounts.set(k, (seenDateTimeCounts.get(k) || 0) + 1);
        }
        if (Array.isArray(v) && v.some((x) => typeof x === "string" && x.startsWith("rec"))) {
          seenLinkedRecCounts.set(k, (seenLinkedRecCounts.get(k) || 0) + 1);
        }
      }
    }
    offset = data.offset || null;
    // Early stop if we already observed enough datetime values (good chance we found the start field)
    const totalDt = Array.from(seenDateTimeCounts.values()).reduce((a, b) => a + b, 0);
    if (totalDt >= 25) break;
    if (!offset) break;
  }
  const pickTop = (m, limit = 5) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name]) => name);
  return {
    fields: Array.from(found),
    source: "records",
    observed: {
      dateTimeFields: pickTop(seenDateTimeCounts, 8),
      linkedRecordFields: pickTop(seenLinkedRecCounts, 8),
    },
  };
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
    // Browser-side cache for rapid back/forward / refresh.
    setPrivateCache(res, 30);

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
      // Common Italian variants (Airtable field names are case-sensitive)
      "Data e Ora",
      "Data e ora INIZIO",
      "Data e Ora INIZIO",
      "Data e ora Inizio",
      "Data e Ora Inizio",
      "Data INIZIO",
      "Inizio",
      "Start",
      "Start at",
      "Inizio appuntamento",
      "DataOra Inizio",
      "DataOra INIZIO",
      "Data e ora INIZIO (manuale)",
      "Data e Ora INIZIO (manuale)",
      "Data e ora Inizio (manuale)",
      "Data e Ora Inizio (manuale)",
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

    const envDebug = {
      AGENDA_TABLE: String(process.env.AGENDA_TABLE || ""),
      AGENDA_START_FIELD: String(process.env.AGENDA_START_FIELD || ""),
      AGENDA_OPERATOR_FIELD: String(process.env.AGENDA_OPERATOR_FIELD || ""),
    };

    const schemaCacheKey = `agenda:schema:${APPTS_TABLE_NAME}:${startCandidates.join("|")}:${operatorCandidates.join("|")}`;
    const cachedSchema = memGet(schemaCacheKey);
    let FIELD_START = cachedSchema?.FIELD_START || "";
    let FIELD_OPERATOR = cachedSchema?.FIELD_OPERATOR || "";

    if (!FIELD_START || !FIELD_OPERATOR) {
      FIELD_START = await resolveFieldNameByProbe(tableEnc, startCandidates);
      FIELD_OPERATOR = await resolveFieldNameByProbe(tableEnc, operatorCandidates);
    }

    let discovered = [];
    let discoveredSource = "";
    let discoveredObserved = {};
    if (!FIELD_START || !FIELD_OPERATOR) {
      const discoveredCacheKey = `agenda:fields:${APPTS_TABLE_NAME}`;
      const cached = memGet(discoveredCacheKey) || null;
      discovered = cached?.fields || [];
      discoveredSource = cached?.source || "";
      discoveredObserved = cached?.observed || {};
      if (!discovered.length) {
        const fresh = await discoverFieldNames({ tableEnc, tableName: APPTS_TABLE_NAME });
        discovered = fresh.fields || [];
        discoveredSource = fresh.source || "";
        discoveredObserved = fresh.observed || {};
        // cache discovered fields briefly
        memSet(
          discoveredCacheKey,
          { fields: discovered, source: discoveredSource, observed: discoveredObserved },
          10 * 60_000
        );
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

    // If start wasn't found by name, try by observed ISO datetime values (record sampling).
    if (!FIELD_START) {
      const dtFields = discoveredObserved?.dateTimeFields || [];
      if (dtFields.length) FIELD_START = String(dtFields[0] || "").trim();
    }

    // If operator wasn't found by name, try by observed linked-record arrays.
    if (!FIELD_OPERATOR) {
      const linkFields = discoveredObserved?.linkedRecordFields || [];
      if (linkFields.length) FIELD_OPERATOR = String(linkFields[0] || "").trim();
    }

    const role = normalizeRole(session.role);
    // We *must* have a datetime field to filter by date range.
    // Operator field is required only for physio RBAC; for other roles we can still show agenda without operator mapping.
    if (!FIELD_START || (role === "physio" && !FIELD_OPERATOR)) {
      return res.status(500).json({
        ok: false,
        error: "agenda_schema_mismatch",
        details: {
          table: APPTS_TABLE_NAME,
          env: envDebug,
          resolved: { FIELD_START, FIELD_OPERATOR },
          tried: {
            start: startCandidates,
            operator: operatorCandidates,
          },
          discoveredSource,
          discoveredObserved,
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
        env: envDebug,
        resolved: { FIELD_START, FIELD_OPERATOR },
        note: "Field names were resolved by probing fields[] (no Airtable Meta API required).",
      });
    }

    const rangeFilter = `AND(
      OR(IS_AFTER({${FIELD_START}}, "${startISO}"), IS_SAME({${FIELD_START}}, "${startISO}")),
      IS_BEFORE({${FIELD_START}}, "${endExclusiveISO}")
    )`;

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

    const noCache = String(req.query?.nocache || "") === "1";
    const listCacheKey = `agenda:list:${APPTS_TABLE_NAME}:${FIELD_START}:${FIELD_OPERATOR}:${role}:${email}:${from}:${to}`;
    const fetchList = async () => {
      const qs = new URLSearchParams({
        filterByFormula: `AND(${rangeFilter}, ${roleFilter})`,
        pageSize: "100",
        "sort[0][field]": FIELD_START,
        "sort[0][direction]": "asc",
      });
      return await airtableFetch(`${tableEnc}?${qs.toString()}`);
    };
    const data = noCache ? await fetchList() : await memGetOrSet(listCacheKey, 15_000, fetchList);

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

