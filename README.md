## FISIOPRO

Static HTML app in `public/` + Vercel Serverless Functions in `api/`.

### Routes

- **Login**: `/` (`public/index.html`)
- **Agenda**: `/agenda.html` (protected by cookie session)
- **Legacy links**:
  - `/pages/agenda.html` redirects to `/agenda.html`
  - `/pages/login.html` redirects to `/`
  - `/pages/index.html` routes by role (physio → agenda, else → front office)

### Environment variables (Vercel)

- **SESSION_SECRET**: HMAC secret for the `fp_session` cookie.
- **AIRTABLE_TOKEN**: Airtable API token.
- **AIRTABLE_BASE_ID**: Airtable base id.

### Airtable -> Supabase migration (full)

This repo includes a practical “full migration” path:

- **Raw import** (no data loss): all Airtable records are stored in `airtable_raw_records` (JSONB)
- **Core normalized tables**: `patients`, `cases`, `appointments`, `sales`, `erogato`, ...

#### 1) Create Supabase schema

- In Supabase SQL editor, run `supabase/schema.sql`.

#### 2) Set env vars (local)

Export:

- `AIRTABLE_TOKEN`
- `AIRTABLE_BASE_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

#### 3) Run migration

```bash
npm run migrate:airtable:all
```

You can also run steps separately:

```bash
npm run migrate:airtable:raw
npm run migrate:airtable:core
```

#### Notes

- The migration uses `lib/airtableSchema.json` to enumerate tables.
- For normalized tables we store `airtable_id` to keep a stable mapping from Airtable record ids.

Optional overrides (defaults shown in code):

- `AIRTABLE_COLLABORATORI_TABLE` (default `COLLABORATORI`)
- `AIRTABLE_RICHIESTE_TABLE` (default `RICHIESTE_ACCESSO`)
- `AGENDA_TABLE` (default `APPUNTAMENTI`)
- `AGENDA_START_FIELD` (default `Data e ora INIZIO`)
- `AGENDA_EMAIL_FIELD` (default `Email`)
- `AIRTABLE_ANAMNESI_TABLE` (default `ANAMNESI E CONSENSO`)
- `AIRTABLE_EROGATO_TABLE` (default `EROGATO`)
- `AIRTABLE_PREVENTIVI_TABLE` (default `PREVENTIVO E REGOLAMENTO`)
- `AIRTABLE_FONTI_TABLE` (default `FONTI`)
- `AIRTABLE_GRUPPI_TABLE` (default `GRUPPI`)
- `AIRTABLE_TEST_CLINICI_TABLE` (default `TEST CLINICI`)
- `AIRTABLE_ASSICURAZIONI_TABLE` (default `ASSICURAZIONI`)
- `AIRTABLE_TRATTAMENTI_TABLE` (default `TRATTAMENTI`)
- `AIRTABLE_VALUTAZIONI_TABLE` (default `VALUTAZIONI`)

### Quick sanity check

```bash
npm run check:api
```

