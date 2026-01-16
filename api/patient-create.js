import crypto from "node:crypto";
import { airtableFetch, ensureRes, requireRoles } from "./_auth.js";
import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabaseServer.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function makeAirtableLikeId() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "rec";
  const bytes = crypto.randomBytes(14);
  for (let i = 0; i < 14; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

async function readJsonBody(req) {
  // Vercel può già popolare req.body; manteniamo compatibilità.
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  ensureRes(res);
  const user = requireRoles(req, res, ["physio", "front", "manager"]);
  if (!user) return;

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const body = await readJsonBody(req);
    if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

    const TABLE_PATIENTS = process.env.AIRTABLE_PATIENTS_TABLE || "ANAGRAFICA";
    const FIELD_FIRSTNAME = process.env.AIRTABLE_PATIENTS_FIRSTNAME_FIELD || "Nome";
    const FIELD_LASTNAME = process.env.AIRTABLE_PATIENTS_LASTNAME_FIELD || "Cognome";
    const FIELD_FISCAL = process.env.AIRTABLE_PATIENTS_FISCAL_FIELD || "Codice Fiscale";
    const FIELD_EMAIL = process.env.AIRTABLE_PATIENTS_EMAIL_FIELD || "Email";
    const FIELD_PHONE = process.env.AIRTABLE_PATIENTS_PHONE_FIELD || "Telefono";
    const FIELD_DOB = process.env.AIRTABLE_PATIENTS_DOB_FIELD || "Data di nascita";
    const FIELD_CHANNELS = process.env.AIRTABLE_PATIENTS_CHANNELS_FIELD || "Canali di comunicazione preferiti";

    const nome = norm(body.Nome ?? body.nome);
    const cognome = norm(body.Cognome ?? body.cognome);
    const cf = norm(body["Codice Fiscale"] ?? body.codiceFiscale ?? body.cf);
    const email = norm(body.Email ?? body.email);
    const telefono = norm(body.Telefono ?? body.telefono ?? body.cellulare);
    const dob = norm(body["Data di nascita"] ?? body.dataNascita ?? body.dob);
    const channels = body["Canali di comunicazione preferiti"] ?? body.canaliPreferiti ?? body.channels;

    if (!nome && !cognome) {
      return res.status(400).json({ ok: false, error: "missing_name", message: "Inserisci almeno Nome o Cognome." });
    }

    if (isSupabaseEnabled()) {
      const sb = getSupabaseAdmin();
      const recordId = norm(body.recordId || body.id) || makeAirtableLikeId();
      const label = [cognome, nome].filter(Boolean).join(" ").trim() || [nome, cognome].filter(Boolean).join(" ").trim();

      const airtableFields = {};
      if (label) airtableFields.Paziente = label;
      if (nome) airtableFields.Nome = nome;
      if (cognome) airtableFields.Cognome = cognome;
      if (cf) airtableFields["Codice Fiscale"] = cf;
      if (email) airtableFields.Email = email;
      if (telefono) {
        airtableFields["Numero di telefono"] = telefono;
        airtableFields.Telefono = telefono;
      }
      if (dob) airtableFields["Data di nascita"] = dob;
      if (channels && (Array.isArray(channels) ? channels.length : String(channels).trim())) {
        airtableFields["Canali di comunicazione preferiti"] = channels;
      }

      const payload = {
        airtable_id: recordId,
        label: label || null,
        cognome: cognome || null,
        nome: nome || null,
        codice_fiscale: cf || null,
        phone: telefono || null,
        email: email || null,
        date_of_birth: dob || null,
        airtable_fields: airtableFields,
      };

      const { data, error } = await sb.from("patients").insert(payload).select("airtable_id").maybeSingle();
      if (error) return res.status(500).json({ ok: false, error: `supabase_patient_insert_failed: ${error.message}` });

      return res.status(200).json({ ok: true, id: data?.airtable_id || recordId, fields: airtableFields });
    }

    const fields = {};
    if (nome) fields[FIELD_FIRSTNAME] = nome;
    if (cognome) fields[FIELD_LASTNAME] = cognome;
    if (cf) fields[FIELD_FISCAL] = cf;
    if (email) fields[FIELD_EMAIL] = email;
    if (telefono) fields[FIELD_PHONE] = telefono;
    if (dob) fields[FIELD_DOB] = dob;
    if (channels && (Array.isArray(channels) ? channels.length : String(channels).trim())) fields[FIELD_CHANNELS] = channels;

    const table = encodeURIComponent(TABLE_PATIENTS);
    const created = await airtableFetch(`${table}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });

    return res.status(200).json({ ok: true, id: created?.id, fields: created?.fields || {} });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
}

