/**
 * Airtable -> Supabase migration (RAW + CORE).
 *
 * Modes:
 *   node scripts/migrate-airtable-to-supabase.js raw
 *   node scripts/migrate-airtable-to-supabase.js core
 *   node scripts/migrate-airtable-to-supabase.js all
 *
 * Required env:
 *   AIRTABLE_TOKEN
 *   AIRTABLE_BASE_ID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Notes:
 * - RAW: dumps all Airtable tables (from lib/airtableSchema.json) into `airtable_raw_records` (JSONB).
 * - CORE: populates normalized tables (patients/collaborators/services/cases/appointments/erogato/...) using `airtable_id` mapping.
 * - This script is meant to be run via GitHub Actions (no local terminal required).
 */

import { createClient } from "@supabase/supabase-js";
import { airtableList, airtableSchema } from "../lib/airtableClient.js";

function norm(v) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function supabaseClient() {
  const url = envOrThrow("SUPABASE_URL");
  const key = envOrThrow("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function chunk(arr, size) {
  const out = [];
  const n = Math.max(1, Number(size) || 1);
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function upsertRows(sb, tableName, rows, onConflict) {
  if (!rows.length) return [];
  const parts = chunk(rows, 200);
  const out = [];
  for (const p of parts) {
    const { data, error } = await sb.from(tableName).upsert(p, { onConflict }).select("*");
    if (error) throw new Error(`${tableName} upsert failed: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

function asNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function asInt(v) {
  const n = asNumber(v);
  return n === null ? null : Math.trunc(n);
}

function asBool(v) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "yes", "si", "sì", "ok"].includes(s)) return true;
  if (["0", "false", "no"].includes(s)) return false;
  return null;
}

function asDateOnly(v) {
  const s = norm(v);
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function asTimestamptz(v) {
  const s = norm(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function firstLinkValue(fields, fieldName) {
  const v = fields?.[fieldName];
  if (Array.isArray(v) && v.length) return norm(v[0]);
  if (typeof v === "string") return norm(v);
  return "";
}

function keyLower(s) {
  return norm(s).toLowerCase();
}

async function migrateRaw() {
  const sb = supabaseClient();
  const tables = Object.keys(airtableSchema || {});
  if (!tables.length) throw new Error("No tables found in lib/airtableSchema.json");

  for (const t of tables) {
    console.log(`[raw] ${t} ...`);
    const { records } = await airtableList(t, { pageSize: 100 });
    const rows = (records || []).map((r) => ({
      table_name: t,
      airtable_id: r.id,
      created_time: r.createdTime ? new Date(r.createdTime).toISOString() : null,
      fields: r.fields || {},
      synced_at: new Date().toISOString(),
    }));
    await upsertRows(sb, "airtable_raw_records", rows, "table_name,airtable_id");
    console.log(`[raw] ${t}: ${rows.length}`);
  }
}

async function migrateCore() {
  const sb = supabaseClient();

  // Build lookup maps
  const maps = {
    patientsByAirtable: new Map(),
    patientsByLabel: new Map(),
    collaboratorsByAirtable: new Map(),
    collaboratorsByName: new Map(),
    servicesByAirtable: new Map(),
    casesByAirtable: new Map(),
    salesByAirtable: new Map(),
    appointmentsByAirtable: new Map(),
  };

  const upsertAndIndex = async (tableName, rows) => {
    const inserted = await upsertRows(sb, tableName, rows, "airtable_id");
    return inserted || [];
  };

  // COLLABORATORI
  {
    const { records } = await airtableList("COLLABORATORI", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      return { airtable_id: r.id, name: norm(f.Collaboratore || f.Nome || f.Name || r.id), role: norm(f.Ruolo), airtable_fields: f };
    });
    console.log(`[core] collaborators: ${rows.length}`);
    const ins = await upsertAndIndex("collaborators", rows);
    for (const c of ins) {
      if (c.airtable_id && c.id) maps.collaboratorsByAirtable.set(c.airtable_id, c.id);
      if (c.name && c.id) maps.collaboratorsByName.set(keyLower(c.name), c.id);
    }
  }

  // ANAGRAFICA
  {
    const { records } = await airtableList("ANAGRAFICA", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      return {
        airtable_id: r.id,
        label: norm(f.Paziente || f["Cognome Nome | Età"] || r.id),
        cognome: norm(f.Cognome),
        nome: norm(f.Nome),
        sesso: norm(f.Sesso),
        date_of_birth: asDateOnly(f["Data di nascita"]),
        codice_fiscale: norm(f["Codice Fiscale"] || f["CODICE FISCALE"]),
        phone: norm(f["Numero di telefono"] || f.Telefono),
        email: norm(f.Email),
        comune_nascita: norm(f["Comune di Nascita"]),
        comune_residenza: norm(f["Comune di residenza"]),
        provincia_residenza: norm(f["Provincia di residenza"]),
        indirizzo_residenza: norm(f["Indirizzo di residenza"]),
        cap: norm(f.Cap),
        notes: norm(f["Note interne"] || f.Note),
        airtable_fields: f,
      };
    });
    console.log(`[core] patients: ${rows.length}`);
    const ins = await upsertAndIndex("patients", rows);
    for (const p of ins) {
      if (p.airtable_id && p.id) maps.patientsByAirtable.set(p.airtable_id, p.id);
      if (p.label && p.id) maps.patientsByLabel.set(keyLower(p.label), p.id);
    }
  }

  // PRESTAZIONI
  {
    const { records } = await airtableList("PRESTAZIONI", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      return {
        airtable_id: r.id,
        name: norm(f.Servizio || f.Prestazione || r.id),
        code: norm(f.Codice),
        price: asNumber(f["Costo Seduta singola"] ?? f.Prezzo ?? f.Costo),
        duration_minutes: asInt(f["Durata Singola"] ?? f.Durata),
        consumes_session: asBool(f["Consuma seduta?"]),
        is_evaluation: asBool(f["È valutazione?"]),
        is_treatment: asBool(f["È trattamento?"]),
        pays_collaborator: asBool(f["Paga collaboratore?"]),
        airtable_fields: f,
      };
    });
    console.log(`[core] services: ${rows.length}`);
    const ins = await upsertAndIndex("services", rows);
    for (const s of ins) if (s.airtable_id && s.id) maps.servicesByAirtable.set(s.airtable_id, s.id);
  }

  const resolvePatientUuid = (v) => {
    const s = norm(v);
    if (!s) return null;
    if (s.startsWith("rec")) return maps.patientsByAirtable.get(s) || null;
    return maps.patientsByLabel.get(keyLower(s)) || null;
  };
  const resolveCollaboratorUuid = (v) => {
    const s = norm(v);
    if (!s) return null;
    if (s.startsWith("rec")) return maps.collaboratorsByAirtable.get(s) || null;
    return maps.collaboratorsByName.get(keyLower(s)) || null;
  };

  // CASI CLINICI
  {
    const { records } = await airtableList("CASI CLINICI", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      const paz = firstLinkValue(f, "Paziente");
      const ref = firstLinkValue(f, "Fisioterapista referente");
      return {
        airtable_id: r.id,
        patient_id: resolvePatientUuid(paz),
        referente_id: resolveCollaboratorUuid(ref),
        case_code: norm(f["ID caso clinico"] || f["CASO CLINICO"] || f["Caso Clinico"] || r.id),
        status: norm(f["Stato caso"] || f.Stato),
        opened_on: asDateOnly(f["Data apertura"] || f["Data Apertura"]),
        closed_on: asDateOnly(f["DATA CHIUSURA"]),
        notes: norm(f["Note caso"] || f.Note),
        airtable_fields: f,
      };
    });
    console.log(`[core] cases: ${rows.length}`);
    const ins = await upsertAndIndex("cases", rows);
    for (const c of ins) if (c.airtable_id && c.id) maps.casesByAirtable.set(c.airtable_id, c.id);
  }

  // VENDITE (may be empty)
  {
    let records = [];
    try {
      const res = await airtableList("VENDITE", { pageSize: 100 });
      records = res.records || [];
    } catch {
      records = [];
    }
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      const paz = firstLinkValue(f, "Paziente");
      const cas = firstLinkValue(f, "Caso clinico");
      const srv = firstLinkValue(f, "LINK TO PRESTAZIONI");
      return {
        airtable_id: r.id,
        patient_id: resolvePatientUuid(paz),
        case_id: cas && cas.startsWith("rec") ? (maps.casesByAirtable.get(cas) || null) : null,
        service_id: srv && srv.startsWith("rec") ? (maps.servicesByAirtable.get(srv) || null) : null,
        status: norm(f["Stato vendita"]),
        sale_type: norm(f["Tipo di vendita"]),
        sold_at: asTimestamptz(f["DATA E ORA VENDITA"]),
        sold_date: asDateOnly(f["Data vendita"]),
        sessions_sold: asInt(f["Sedute vendute"]),
        price_total: asNumber(f["Prezzo totale"]),
        discount_price: asNumber(f["PREZZO SCONTO"]),
        payment_method: norm(f["Metodo di Pagamento 1"] || f["Modalità di Pagamento 1"]),
        payment_status: norm(f["Stato Pagamento"]),
        airtable_fields: f,
      };
    });
    console.log(`[core] sales: ${rows.length}`);
    const ins = rows.length ? await upsertAndIndex("sales", rows) : [];
    for (const s of ins) if (s.airtable_id && s.id) maps.salesByAirtable.set(s.airtable_id, s.id);
  }

  // APPUNTAMENTI
  {
    const { records } = await airtableList("APPUNTAMENTI", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      const paz = firstLinkValue(f, "Paziente");
      const col = firstLinkValue(f, "Collaboratore");
      const srv = firstLinkValue(f, "Prestazione prevista");
      const cas = firstLinkValue(f, "Caso clinico");
      const sal = firstLinkValue(f, "Vendita collegata");

      return {
        airtable_id: r.id,
        patient_id: resolvePatientUuid(paz),
        collaborator_id: resolveCollaboratorUuid(col),
        service_id: srv && srv.startsWith("rec") ? (maps.servicesByAirtable.get(srv) || null) : null,
        case_id: cas && cas.startsWith("rec") ? (maps.casesByAirtable.get(cas) || null) : null,
        sale_id: sal && sal.startsWith("rec") ? (maps.salesByAirtable.get(sal) || null) : null,
        start_at: asTimestamptz(f["Data e ora INIZIO"]),
        end_at: asTimestamptz(f["Data e ora fine"]),
        duration_minutes: asInt(f["Durata (minuti)"]),
        status: norm(f["Stato appuntamento"]),
        location: norm(f.Sede),
        agenda_label: norm(f["Voce agenda"]),
        is_home: asBool(f["DOMICILIO"]),
        economic_outcome: norm(f["Esito economico"]),
        work_type: norm(f["Tipo lavoro"]),
        note: norm(f.Note),
        airtable_fields: f,
      };
    });
    console.log(`[core] appointments: ${rows.length}`);
    const ins = await upsertAndIndex("appointments", rows);
    for (const a of ins) if (a.airtable_id && a.id) maps.appointmentsByAirtable.set(a.airtable_id, a.id);
  }

  // EROGATO
  {
    const { records } = await airtableList("EROGATO", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      const paz = firstLinkValue(f, "Paziente");
      const col = firstLinkValue(f, "Collaboratore");
      const app = firstLinkValue(f, "Appuntamento");
      const cas = firstLinkValue(f, "Caso clinico") || firstLinkValue(f, "CASI CLINICI");
      return {
        airtable_id: r.id,
        patient_id: resolvePatientUuid(paz),
        collaborator_id: resolveCollaboratorUuid(col),
        appointment_id: app && app.startsWith("rec") ? (maps.appointmentsByAirtable.get(app) || null) : null,
        case_id: cas && cas.startsWith("rec") ? (maps.casesByAirtable.get(cas) || null) : null,
        start_at: asTimestamptz(f["Data e ora INIZIO"]),
        end_at: asTimestamptz(f["Data e ora FINE"]),
        minutes: asInt(f["Minuti lavoro"]),
        status: norm(f["Stato appuntamento"]),
        work_type: norm(f["Tipo lavoro "] || f["Tipo lavoro (da prestazioni)"]),
        is_evaluation: asBool(f["È valutazione?"]),
        is_home: asBool(f["DOMICILIO (from Appuntamento)"]),
        airtable_fields: f,
      };
    });
    console.log(`[core] erogato: ${rows.length}`);
    if (rows.length) await upsertAndIndex("erogato", rows);
  }

  console.log("[core] done");
}

async function main() {
  const mode = (process.argv[2] || "all").toLowerCase();
  if (!["raw", "core", "all"].includes(mode)) {
    console.log("Usage: node scripts/migrate-airtable-to-supabase.js [raw|core|all]");
    process.exit(2);
  }
  if (mode === "raw" || mode === "all") await migrateRaw();
  if (mode === "core" || mode === "all") await migrateCore();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

