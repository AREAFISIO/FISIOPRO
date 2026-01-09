import crypto from "crypto";
import { airtableFetch, ensureRes } from "./_auth.js";
import { fetchWithTimeout, norm, escAirtableString, setPrivateCache } from "./_common.js";
import { airtableListAll } from "./_airtableClient.js";

// =========================
// Fatture in Cloud (FIC) v2
// =========================
//
// - NO calls from browser to FIC: only server-side.
// - Tokens are stored in Airtable table FIC_TOKENS.
//
// ENV required:
// - FIC_CLIENT_ID
// - FIC_CLIENT_SECRET
// - FIC_REDIRECT_URI (absolute https URL to /api/fic/oauth/callback)
//
// Optional:
// - FIC_OAUTH_SCOPES (default set below)
// - FIC_API_BASE (default https://api.fattureincloud.it)
// - FIC_DEFAULT_COMPANY_ID (if multiple companies)
// - AIRTABLE_FIC_TOKENS_TABLE (default FIC_TOKENS)
// - AIRTABLE_CLIENTI_FIC_TABLE (default CLIENTI_FIC)
// - AIRTABLE_FATTURE_TABLE (default FATTURE)
//

const FIC_API_BASE = String(process.env.FIC_API_BASE || "https://api.fattureincloud.it").replace(/\/+$/, "");
const FIC_OAUTH_AUTHORIZE_URL = `${FIC_API_BASE}/oauth/authorize`;
const FIC_OAUTH_TOKEN_URL = `${FIC_API_BASE}/oauth/token`;
const FIC_USER_INFO_URL = `${FIC_API_BASE}/v2/user/info`;

const TABLE_TOKENS = process.env.AIRTABLE_FIC_TOKENS_TABLE || "FIC_TOKENS";
const TABLE_CLIENTI = process.env.AIRTABLE_CLIENTI_FIC_TABLE || "CLIENTI_FIC";
const TABLE_FATTURE = process.env.AIRTABLE_FATTURE_TABLE || "FATTURE";

function enc(x) {
  return encodeURIComponent(String(x ?? ""));
}

function nowIso() {
  return new Date().toISOString();
}

function msFromExpiresIn(expiresInSeconds) {
  const s = Number(expiresInSeconds) || 0;
  return Date.now() + Math.max(0, s) * 1000;
}

function asIsoFromMs(ms) {
  const d = new Date(Number(ms) || 0);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function mustEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) {
    const err = new Error(`missing_env_${name}`);
    err.status = 500;
    throw err;
  }
  return v;
}

export function ficOAuthScopes() {
  // Default scopes: clients + issued documents (read + write)
  const s = String(process.env.FIC_OAUTH_SCOPES || "").trim();
  if (s) return s;
  return [
    "entity.clients:r",
    "entity.clients:a",
    "issued_documents:r",
    "issued_documents:a",
  ].join(" ");
}

export function ficBuildAuthorizeUrl({ state } = {}) {
  const clientId = mustEnv("FIC_CLIENT_ID");
  const redirectUri = mustEnv("FIC_REDIRECT_URI");
  const scope = ficOAuthScopes();

  const qs = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state: String(state || ""),
  });
  return `${FIC_OAUTH_AUTHORIZE_URL}?${qs.toString()}`;
}

async function ficTokenRequest(form) {
  const clientId = mustEnv("FIC_CLIENT_ID");
  const clientSecret = mustEnv("FIC_CLIENT_SECRET");

  const timeoutMs = Number(process.env.FIC_FETCH_TIMEOUT_MS || 20_000);
  const res = await fetchWithTimeout(FIC_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...form,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  }, timeoutMs);

  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!res.ok) {
    const err = new Error(json?.error_description || json?.error || `fic_oauth_error_${res.status}`);
    err.status = 502;
    err.fic = json;
    throw err;
  }
  return json;
}

export async function ficExchangeCodeForTokens(code) {
  const redirectUri = mustEnv("FIC_REDIRECT_URI");
  return await ficTokenRequest({
    grant_type: "authorization_code",
    code: String(code || ""),
    redirect_uri: redirectUri,
  });
}

export async function ficRefreshTokens(refreshToken) {
  return await ficTokenRequest({
    grant_type: "refresh_token",
    refresh_token: String(refreshToken || ""),
  });
}

async function ficFetchJson(url, accessToken, init = {}) {
  const timeoutMs = Number(process.env.FIC_FETCH_TIMEOUT_MS || 20_000);
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  }, timeoutMs);
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(json?.error?.message || json?.message || `fic_api_error_${res.status}`);
    err.status = 502;
    err.fic = json;
    throw err;
  }
  return json;
}

export async function ficGetCompanyId(accessToken) {
  const pref = String(process.env.FIC_DEFAULT_COMPANY_ID || "").trim();
  if (pref) return pref;

  const info = await ficFetchJson(FIC_USER_INFO_URL, accessToken, { method: "GET" });
  const companies = info?.data?.companies || info?.companies || [];
  const first = companies?.[0]?.id || companies?.[0]?.company_id || "";
  if (!first) {
    const err = new Error("fic_company_not_found");
    err.status = 502;
    err.fic = info;
    throw err;
  }
  return String(first);
}

async function airtableFindOneByFormula(tableName, formula) {
  const tableEnc = enc(tableName);
  const qs = new URLSearchParams({ filterByFormula: String(formula || ""), maxRecords: "1", pageSize: "1" });
  const data = await airtableFetch(`${tableEnc}?${qs.toString()}`);
  return data?.records?.[0] || null;
}

async function airtableCreate(tableName, fields) {
  const tableEnc = enc(tableName);
  return await airtableFetch(`${tableEnc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: fields || {} }] }),
  });
}

async function airtableUpdate(tableName, recordId, fields) {
  const tableEnc = enc(tableName);
  return await airtableFetch(`${tableEnc}/${enc(recordId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: fields || {} }),
  });
}

export async function ficUpsertTokenRecord({ companyId, accessToken, refreshToken, expiresAtIso }) {
  const formula = `{Company ID}="${escAirtableString(companyId)}"`;
  const existing = await airtableFindOneByFormula(TABLE_TOKENS, formula);

  const fields = {
    "Company ID": String(companyId || ""),
    "Access Token": String(accessToken || ""),
    "Refresh Token": String(refreshToken || ""),
    "Expires At": String(expiresAtIso || ""),
    "Ultimo aggiornamento": nowIso(),
  };

  if (existing?.id) {
    await airtableUpdate(TABLE_TOKENS, existing.id, fields);
    return existing.id;
  }

  const created = await airtableCreate(TABLE_TOKENS, fields);
  return created?.records?.[0]?.id || "";
}

export async function ficGetTokenRecord({ companyId } = {}) {
  const cid = String(companyId || "").trim() || String(process.env.FIC_DEFAULT_COMPANY_ID || "").trim();
  if (cid) {
    const formula = `{Company ID}="${escAirtableString(cid)}"`;
    return await airtableFindOneByFormula(TABLE_TOKENS, formula);
  }

  // fallback: most recently updated
  const recs = await airtableListAll({
    tableName: TABLE_TOKENS,
    pageSize: 25,
    maxRecords: 25,
    sort: [{ field: "Ultimo aggiornamento", direction: "desc" }],
  });
  return recs?.[0] || null;
}

export async function ficEnsureAccessToken({ companyId } = {}) {
  const rec = await ficGetTokenRecord({ companyId });
  const f = rec?.fields || {};
  const accessToken = String(f["Access Token"] || "").trim();
  const refreshToken = String(f["Refresh Token"] || "").trim();
  const expiresAtRaw = String(f["Expires At"] || "").trim();
  const cid = String(f["Company ID"] || companyId || "").trim();

  if (!cid || !refreshToken) {
    const err = new Error("fic_not_connected");
    err.status = 409;
    throw err;
  }

  const expiresAtMs = expiresAtRaw ? new Date(expiresAtRaw).getTime() : 0;
  const isExpired = !accessToken || !expiresAtMs || Date.now() > (expiresAtMs - 60_000); // refresh 60s early
  if (!isExpired) return { companyId: cid, accessToken };

  const refreshed = await ficRefreshTokens(refreshToken);
  const newAccess = String(refreshed.access_token || "").trim();
  const newRefresh = String(refreshed.refresh_token || refreshToken).trim();
  const expMs = msFromExpiresIn(refreshed.expires_in);
  const newExpiresIso = asIsoFromMs(expMs);

  await ficUpsertTokenRecord({
    companyId: cid,
    accessToken: newAccess,
    refreshToken: newRefresh,
    expiresAtIso: newExpiresIso,
  });

  return { companyId: cid, accessToken: newAccess };
}

export async function ficApiFetch(path, { method = "GET", accessToken, jsonBody, headers } = {}) {
  const url = `${FIC_API_BASE}${String(path || "").startsWith("/") ? "" : "/"}${String(path || "")}`;
  const timeoutMs = Number(process.env.FIC_FETCH_TIMEOUT_MS || 25_000);
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(headers || {}),
    },
  };
  if (jsonBody !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(jsonBody);
  }

  const res = await fetchWithTimeout(url, init, timeoutMs);
  const ct = String(res.headers.get("content-type") || "");
  if (ct.includes("application/pdf")) return res;

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.message || `fic_api_error_${res.status}`);
    err.status = 502;
    err.fic = data;
    throw err;
  }
  return data;
}

// -------------------------
// Airtable helpers (FIC data)
// -------------------------

export async function clientiFicFindByPatientId(patientId) {
  const pid = String(patientId || "").trim();
  if (!pid) return null;
  const formula = `FIND("${escAirtableString(pid)}", ARRAYJOIN({Paziente}))`;
  return await airtableFindOneByFormula(TABLE_CLIENTI, formula);
}

export async function clientiFicListAll({ maxRecords = 500 } = {}) {
  const recs = await airtableListAll({
    tableName: TABLE_CLIENTI,
    pageSize: 100,
    maxRecords: Math.max(1, Math.min(Number(maxRecords) || 500, 5000)),
    sort: [{ field: "Ultima sincronizzazione", direction: "desc" }],
  });
  return recs || [];
}

export async function fattureListAll({ filterFormula, maxRecords = 500 } = {}) {
  const recs = await airtableListAll({
    tableName: TABLE_FATTURE,
    pageSize: 100,
    maxRecords: Math.max(1, Math.min(Number(maxRecords) || 500, 5000)),
    filterByFormula: String(filterFormula || "").trim() || undefined,
    sort: [{ field: "Data creazione", direction: "desc" }],
  });
  return recs || [];
}

export async function fattureFindByFicDocumentId(documentId) {
  const id = String(documentId || "").trim();
  if (!id) return null;
  const formula = `{FIC Document ID}="${escAirtableString(id)}"`;
  return await airtableFindOneByFormula(TABLE_FATTURE, formula);
}

export async function fattureUpsertByFicDocumentId(documentId, fields) {
  const existing = await fattureFindByFicDocumentId(documentId);
  if (existing?.id) {
    await airtableUpdate(TABLE_FATTURE, existing.id, fields);
    return existing.id;
  }
  const created = await airtableCreate(TABLE_FATTURE, { ...fields, "FIC Document ID": String(documentId || "") });
  return created?.records?.[0]?.id || "";
}

// -------------------------
// Small endpoint helpers
// -------------------------

export function json(res, status, data) {
  ensureRes(res);
  setPrivateCache(res, 0);
  res.status(status).json(data);
}

export function safeGetUser(req) {
  // Avoid importing requireRoles here to keep this module reusable;
  // endpoints will enforce roles themselves.
  return {
    email: String(req?.headers?.["x-fp-user-email"] || ""),
  };
}

export function randomState() {
  return crypto.randomBytes(18).toString("hex");
}

