/**
 * Full Airtable -> Supabase migration (raw + normalized core).
 *
 * Run:
 *   node scripts/migrate-airtable-to-supabase.js all
 *
 * Required env:
 *   AIRTABLE_TOKEN
 *   AIRTABLE_BASE_ID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
 
import { createClient } from "@supabase/supabase-js";
import { airtableList } from "../lib/airtableClient.js";
import { airtableSchema } from "../lib/airtableClient.js";
 
function norm(s) {
  const v = String(s ?? "").trim();
  return v ? v : "";
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
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
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
function firstLinkedId(fields, fieldName) {
  const v = fields?.[fieldName];
  if (Array.isArray(v) && v.length) return String(v[0] || "").trim();
  if (typeof v === "string" && v.startsWith("rec")) return v;
  return "";
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
  const maps = {
    patients: new Map(),
    collaborators: new Map(),
    services: new Map(),
    cases: new Map(),
    sales: new Map(),
    appointments: new Map(),
    erogato: new Map(),
  };
 
  async function buildMap(tableName, rows) {
    const inserted = await upsertRows(sb, tableName, rows, "airtable_id");
    for (const r of inserted) {
      if (r?.airtable_id && r?.id) maps[tableName].set(r.airtable_id, r.id);
    }
  }
 
  // COLLABORATORI
  {
    const { records } = await airtableList("COLLABORATORI", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      return { airtable_id: r.id, name: norm(f.Collaboratore || r.id), role: norm(f.Ruolo), airtable_fields: f };
    });
    console.log(`[core] collaborators: ${rows.length}`);
    await buildMap("collaborators", rows);
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
        phone: norm(f["Numero di telefono"]),
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
    await buildMap("patients", rows);
  }
 
  // PRESTAZIONI
  {
    const { records } = await airtableList("PRESTAZIONI", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      return {
        airtable_id: r.id,
        name: norm(f.Servizio || r.id),
        code: norm(f.Codice),
        price: asNumber(f["Costo Seduta singola"]),
        duration_minutes: asInt(f["Durata Singola"]),
        consumes_session: asBool(f["Consuma seduta?"]),
        is_evaluation: asBool(f["È valutazione?"]),
        is_treatment: asBool(f["È trattamento?"]),
        pays_collaborator: asBool(f["Paga collaboratore?"]),
        airtable_fields: f,
      };
    });
    console.log(`[core] services: ${rows.length}`);
    await buildMap("services", rows);
  }
 
  // CASI CLINICI
  {
    const { records } = await airtableList("CASI CLINICI", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      const p = firstLinkedId(f, "Paziente");
      const ref = firstLinkedId(f, "Fisioterapista referente");
      return {
        airtable_id: r.id,
        patient_id: maps.patients.get(p) || null,
        referente_id: maps.collaborators.get(ref) || null,
        case_code: norm(f["ID caso clinico"] || f["CASO CLINICO"]),
        status: norm(f["Stato caso"] || f.Stato),
        opened_on: asDateOnly(f["Data apertura"]),
        closed_on: asDateOnly(f["DATA CHIUSURA"]),
        notes: norm(f["Note caso"] || f.Note),
        airtable_fields: f,
      };
    });
    console.log(`[core] cases: ${rows.length}`);
    await buildMap("cases", rows);
  }
 
  // VENDITE
  {
    const { records } = await airtableList("VENDITE", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      const p = firstLinkedId(f, "Paziente");
      const c = firstLinkedId(f, "Caso clinico");
      const s = firstLinkedId(f, "LINK TO PRESTAZIONI");
      return {
        airtable_id: r.id,
        patient_id: maps.patients.get(p) || null,
        case_id: maps.cases.get(c) || null,
        service_id: maps.services.get(s) || null,
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
    await buildMap("sales", rows);
  }
 
  // APPUNTAMENTI
  {
    const { records } = await airtableList("APPUNTAMENTI", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      const p = firstLinkedId(f, "Paziente");
      const co = firstLinkedId(f, "Collaboratore");
      const sv = firstLinkedId(f, "Prestazione prevista");
      const ca = firstLinkedId(f, "Caso clinico");
      const sa = firstLinkedId(f, "Vendita collegata");
      return {
        airtable_id: r.id,
        patient_id: maps.patients.get(p) || null,
        collaborator_id: maps.collaborators.get(co) || null,
        service_id: maps.services.get(sv) || null,
        case_id: maps.cases.get(ca) || null,
        sale_id: maps.sales.get(sa) || null,
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
    await buildMap("appointments", rows);
  }
 
  // EROGATO
  {
    const { records } = await airtableList("EROGATO", { pageSize: 100 });
    const rows = (records || []).map((r) => {
      const f = r.fields || {};
      const p = firstLinkedId(f, "Paziente");
      const co = firstLinkedId(f, "Collaboratore");
      const ap = firstLinkedId(f, "Appuntamento");
      const ca = firstLinkedId(f, "Caso clinico") || firstLinkedId(f, "CASI CLINICI");
      const ev = firstLinkedId(f, "Valutazione collegata");
      return {
        airtable_id: r.id,
        patient_id: maps.patients.get(p) || null,
        collaborator_id: maps.collaborators.get(co) || null,
        appointment_id: maps.appointments.get(ap) || null,
        case_id: maps.cases.get(ca) || null,
        evaluation_airtable_link: ev || null,
        start_at: asTimestamptz(f["Data e ora INIZIO"]),
        end_at: asTimestamptz(f["Data e ora FINE"]),
        minutes: asInt(f["Minuti lavoro"]),
        economic_outcome: norm(f["Esito economico"]),
        work_type: norm(f["Tipo lavoro "] || f["Tipo lavoro (da prestazioni)"]),
        is_evaluation: asBool(f["È valutazione?"]),
        is_home: asBool(f["DOMICILIO (from Appuntamento)"]),
        status: norm(f["Stato appuntamento"]),
        airtable_fields: f,
      };
    });
    console.log(`[core] erogato: ${rows.length}`);
    const inserted = await upsertRows(sb, "erogato", rows, "airtable_id");
    for (const rr of inserted) if (rr?.airtable_id && rr?.id) maps.erogato.set(rr.airtable_id, rr.id);
  }
 
  console.log("[core] done");
}
 
async function main() {
  const mode = (process.argv[2] || "all").toLowerCase();
  if (mode === "raw") return migrateRaw();
  if (mode === "core") return migrateCore();
  if (mode === "all") {
    await migrateRaw();
    await migrateCore();
    return;
  }
  console.log("Usage: node scripts/migrate-airtable-to-supabase.js [raw|core|all]");
  process.exit(2);
}
 
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
