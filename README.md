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

