-- Supabase / Postgres schema for Airtable migration.
-- Goal:
-- 1) Full-fidelity raw import of ALL Airtable records (no data loss)
-- 2) Normalized "core" tables for performance (patients/cases/appointments/sales/erogato...)
--
-- Apply in Supabase SQL editor.
 
-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;
 
-- ----------------------------
-- 1) Raw import (complete dump)
-- ----------------------------
 
create table if not exists public.airtable_raw_records (
  table_name text not null,
  airtable_id text not null,
  created_time timestamptz,
  fields jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (table_name, airtable_id)
);
 
create index if not exists airtable_raw_records_table_name_idx
  on public.airtable_raw_records (table_name);
 
create index if not exists airtable_raw_records_fields_gin_idx
  on public.airtable_raw_records using gin (fields);
 
-- ----------------------------
-- 2) Normalized "core" tables
-- ----------------------------
 
create table if not exists public.collaborators (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  name text not null,
  role text,
  airtable_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
 
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  label text, -- "Paziente" primary field
  cognome text,
  nome text,
  sesso text,
  date_of_birth date,
  codice_fiscale text,
  phone text,
  email text,
  comune_nascita text,
  comune_residenza text,
  provincia_residenza text,
  indirizzo_residenza text,
  cap text,
  notes text,
  airtable_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
 
create index if not exists patients_codice_fiscale_idx on public.patients (codice_fiscale);
create index if not exists patients_email_idx on public.patients (email);
 
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  name text not null, -- "Servizio"
  code text, -- "Codice"
  price numeric,
  duration_minutes integer,
  is_evaluation boolean,
  is_treatment boolean,
  consumes_session boolean,
  pays_collaborator boolean,
  airtable_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
 
create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  patient_id uuid references public.patients(id) on delete set null,
  referente_id uuid references public.collaborators(id) on delete set null,
  case_code text, -- "ID caso clinico" (or similar)
  status text, -- "Stato caso"
  opened_on date, -- "Data apertura"
  closed_on date, -- "DATA CHIUSURA"
  notes text,
  airtable_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
 
create index if not exists cases_patient_id_idx on public.cases (patient_id);
create index if not exists cases_opened_on_idx on public.cases (opened_on);
create index if not exists cases_status_idx on public.cases (status);
 
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  patient_id uuid references public.patients(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  status text, -- "Stato vendita"
  sale_type text, -- "Tipo di vendita"
  sold_at timestamptz, -- "DATA E ORA VENDITA"
  sold_date date, -- "Data vendita"
  sessions_sold integer, -- "Sedute vendute"
  price_total numeric, -- "Prezzo totale"
  discount_price numeric, -- "PREZZO SCONTO"
  payment_method text, -- "Metodo di Pagamento 1"
  payment_status text, -- "Stato Pagamento"
  airtable_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
 
create index if not exists sales_patient_id_idx on public.sales (patient_id);
create index if not exists sales_case_id_idx on public.sales (case_id);
create index if not exists sales_sold_at_idx on public.sales (sold_at);
 
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  patient_id uuid references public.patients(id) on delete set null,
  collaborator_id uuid references public.collaborators(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,
  start_at timestamptz,
  end_at timestamptz,
  duration_minutes integer,
  status text, -- "Stato appuntamento"
  location text, -- "Sede"
  agenda_label text, -- "Voce agenda"
  is_home boolean, -- "DOMICILIO"
  economic_outcome text, -- "Esito economico"
  work_type text, -- "Tipo lavoro"
  note text,
  airtable_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
 
create index if not exists appointments_patient_id_idx on public.appointments (patient_id);
create index if not exists appointments_case_id_idx on public.appointments (case_id);
create index if not exists appointments_start_at_idx on public.appointments (start_at);
create index if not exists appointments_collaborator_id_idx on public.appointments (collaborator_id);
 
create table if not exists public.erogato (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  patient_id uuid references public.patients(id) on delete set null,
  collaborator_id uuid references public.collaborators(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  evaluation_airtable_link text, -- keep as metadata for now
  start_at timestamptz,
  end_at timestamptz,
  minutes integer,
  economic_outcome text, -- "Esito economico"
  work_type text, -- "Tipo lavoro "
  is_evaluation boolean, -- "È valutazione?"
  is_home boolean, -- "DOMICILIO (from Appuntamento)"
  status text,
  airtable_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
 
create index if not exists erogato_patient_id_idx on public.erogato (patient_id);
create index if not exists erogato_case_id_idx on public.erogato (case_id);
create index if not exists erogato_start_at_idx on public.erogato (start_at);
create index if not exists erogato_collaborator_id_idx on public.erogato (collaborator_id);
 
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  patient_id uuid references public.patients(id) on delete set null,
  collaborator_id uuid references public.collaborators(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  erogato_id uuid references public.erogato(id) on delete set null,
  evaluated_at date,
  evaluation_type text,
  outcome text,
  note text,
  airtable_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
 
create table if not exists public.treatments (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  patient_id uuid references public.patients(id) on delete set null,
  collaborator_id uuid references public.collaborators(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  erogato_id uuid references public.erogato(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,
  performed_at date,
  treatment_type text,
  note text,
  airtable_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
