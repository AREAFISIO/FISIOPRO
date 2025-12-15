# FisioPro UI Style Guide (Source of Truth)

Questa guida definisce regole e vincoli di UI/UX.
Qualunque modifica grafica deve rispettare questo file.

## Regola d’oro
- NON riscrivere mai la UI “da zero”.
- Il file principale del design è: `/assets/app.css`
- Se serve cambiare stile:
  - aggiungere nuove regole SOLO in fondo a `app.css`
  - evitare modifiche “distruttive” a classi esistenti

## Font e dimensioni
- Base font: 16px
- Sidebar link: 15px
- Titolo pagina (.h1): 22px
- Titoli card (h2): 18px
- Chip/Pill: 14px
- Table header: 12px
- Testi SENZA emoticon (no emoji nella UI testuale)

## Spaziatura
- Layout standard: sidebar + main + rightbar
- Gap tra blocchi: 14px
- Padding card: 14–18px
- Toolbar/search sempre presente quando c’è una lista/tabella

## Componenti “canonici”
- Sidebar: `.sidebar` + `.nav` + `.section` + `.active`
- Card: `.card` con `.head` e `.body`
- Tabelle: `.tablewrap` + `table` con `thead` e `tbody`
- Pills/Chip: `.pill` e `.chip`
- Bottoni: `.btn` e `.btn.primary`
- Toast: `.toast`

## Colori
### Tema scuro (default)
- Sfondo: scuro (già in app.css)
- Testo: chiaro
- Bordi: sottili e trasparenti
- Accent: usare SOLO colori già definiti in app.css

### Tema chiaro Front-Office
- È consentito SOLO nelle pagine Front-Office (front-office.html e correlate)
- Sidebar light: gradient azzurro chiaro
- Card light: bianco semi-trasparente con shadow morbida
- Testo: #0b2c3d (o equivalente già usato)

## Icone
- Non usare emoticon nel testo.
- Se servono icone in futuro: usare SVG o libreria coerente (da decidere), ma non emoji.

## Ruoli e permessi (UI)
Ogni voce menu / tab / sezione deve avere `data-role`:
- physio, front, manager

Regole:
- Physio: solo Appuntamenti + Storia clinica
- Front-office: Appuntamenti + Vendite + Erogato + Assicurazioni
- Manager: tutto

La UI può nascondere, ma la sicurezza reale è in `/api/*` (403 se ruolo non autorizzato).

## Regole per chat future (da copiare quando chiedi modifiche)
Quando lavori con ChatGPT, scrivi sempre:

1) "Rispettare design/STYLEGUIDE.md"
2) "NON modificare l’impostazione grafica esistente"
3) "Se serve, aggiungi CSS SOLO in fondo a assets/app.css"
4) "Niente emoticon. Testi più grandi e puliti."

## Workflow consigliato (anti-incidenti)
- Branch stabile: `main` (production)
- Branch di test: `dev-ui` (esperimenti)
Procedura:
1) Crea branch `dev-ui`
2) Fai modifiche lì
3) Se ti piace → merge su main
4) Se non ti piace → elimina branch, main resta pulito
