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

### Quick sanity check

```bash
npm run check:api
```

