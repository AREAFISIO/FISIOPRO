// =====================
// AUTH + ROLE GUARDS
// =====================
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const res = await fetch(path, { ...opts, headers, credentials: "include" });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Expose a stable, reusable client for other pages/scripts.
// (Keeps existing internal usage untouched.)
window.fpApi = api;

// Minimal reusable helper to handle loading + error states (no framework).
// Usage:
//   const data = await window.fpWithLoading({
//     loadingEl: document.querySelector("[data-loading]"),
//     errorEl: document.querySelector("[data-error]"),
//     run: () => window.fpApi("/api/contabilita?op=dashboard"),
//   });
window.fpWithLoading = async function fpWithLoading({ loadingEl, errorEl, run, loadingText = "Caricamento…" } = {}) {
  const show = (el, msg) => {
    if (!el) return;
    el.style.display = "block";
    if (msg !== undefined) el.textContent = String(msg || "");
  };
  const hide = (el) => {
    if (!el) return;
    el.style.display = "none";
  };

  hide(errorEl);
  show(loadingEl, loadingText);
  try {
    return await run();
  } catch (e) {
    const msg = String(e?.message || "Errore");
    show(errorEl, msg);
    throw e;
  } finally {
    hide(loadingEl);
  }
};

async function ensureAuth() {
  try {
    const isLoginPage = location.pathname === "/" || location.pathname.endsWith("/index.html") || location.pathname.endsWith("/pages/login.html");
    const data = (typeof window.fpAuthMe === "function")
      ? await window.fpAuthMe()
      : await api("/api/auth-me");
    if (!data?.ok) {
      if (!isLoginPage) location.href = "/";
      return null;
    }

    // already logged in and on login page -> go to agenda
    if (isLoginPage) location.href = "/pages/agenda.html";
    return data.user || data.session || null;
  } catch {
    const isLoginPage = location.pathname === "/" || location.pathname.endsWith("/index.html") || location.pathname.endsWith("/pages/login.html");
    if (!isLoginPage) location.href = "/";
    return null;
  }
}

// =====================
// THEME (Standard vs Pro)
// =====================
function fpThemeKey() {
  const email = String((window.FP_USER?.email || window.FP_SESSION?.email || "anon")).trim().toLowerCase() || "anon";
  return `fp_settings_theme_${email}`;
}
function applyTheme(theme) {
  const t = String(theme || "").trim().toLowerCase();
  const cls = t === "pro" ? "fp-theme-pro" : "fp-theme-standard";
  document.body.classList.remove("fp-theme-pro", "fp-theme-standard");
  document.body.classList.add(cls);
}
function loadTheme() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(fpThemeKey()) || "null"); } catch {}
  const t = String(s?.theme || "standard").toLowerCase();
  return t === "pro" ? "pro" : "standard";
}
function saveTheme(theme) {
  const t = String(theme || "").toLowerCase() === "pro" ? "pro" : "standard";
  try { localStorage.setItem(fpThemeKey(), JSON.stringify({ theme: t })); } catch {}
  applyTheme(t);
}

function roleGuard(role) {
  document.querySelectorAll("[data-role]").forEach(el => {
    const allowed = (el.getAttribute("data-role") || "").split(",").map(s=>s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(role)) el.style.display = "none";
  });
}

function activeNav() {
  const path = location.pathname.split("/").pop() || "";
  document.querySelectorAll("[data-nav]").forEach(a => {
    const href = (a.getAttribute("href") || "").split("/").pop();
    a.classList.toggle("active", href === path);
  });
}

function toast(msg){
  const t = document.querySelector(".toast");
  if(!t) return;
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.style.display="none", 1600);
}

function initLogoutLinks() {
  document.querySelectorAll('a[href$="login.html"], a[href$="/login.html"]').forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await fetch("/api/auth-logout", { method: "POST", credentials: "include" });
      } catch {}
      location.href = "/";
    });
  });
}

// =====================
// BRAND LOGO (from Airtable AZIENDA.Logo)
// =====================
async function initBrandLogo() {
  // Only run if the sidebar brand exists
  if (!document.querySelector(".sidebar .brand .dot")) return;

  try {
    const data = await api("/api/azienda");
    const url = String(data?.logoUrl || "").trim();
    if (!url) return;

    // Set CSS var used by .brand .dot background-image
    const safe = url.replace(/"/g, "%22");
    document.documentElement.style.setProperty("--brandLogo", `url("${safe}")`);
  } catch {
    // keep default logo
  }
}

function setUserBadges(user) {
  const fullName = user
    ? [user.nome || "", user.cognome || ""].map(s => String(s || "").trim()).filter(Boolean).join(" ")
    : "";
  const label = user
    ? [fullName || user.nome || "", user.roleLabel || user.role || ""].filter(Boolean).join(" • ")
    : "—";
  document.querySelectorAll("[data-user-badge]").forEach((el) => (el.textContent = label));
}

// =====================
// AGENDA (OsteoEasy-like)
// =====================
function isAgendaPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/agenda.html") || p.endsWith("/agenda.html");
}
function isDashboardPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/dashboard.html") || p.endsWith("/dashboard.html");
}
function pad2(n){ return String(n).padStart(2,"0"); }
function toISODate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseISODate(s){
  const [y,m,d] = (s||"").split("-").map(Number);
  if (!y||!m||!d) return null;
  const dt = new Date(y, m-1, d, 0,0,0,0);
  return isNaN(dt.getTime()) ? null : dt;
}
function startOfWeekMonday(d){
  const x = new Date(d);
  const day = x.getDay(); // 0=dom
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  x.setHours(0,0,0,0);
  return x;
}
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function fmtDay(d){
  const days = ["DOM","LUN","MAR","MER","GIO","VEN","SAB"];
  return `${days[d.getDay()]} ${d.getDate()}`;
}
function fmtMonth(d){
  try { return d.toLocaleDateString("it-IT", { month:"long", year:"numeric" }); } catch { return "Agenda"; }
}
function fmtTime(iso){
  try { const d=new Date(iso); return d.toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}); } catch { return ""; }
}
function minutesOfDay(dt){ return dt.getHours()*60 + dt.getMinutes(); }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }

// =====================
// ANAGRAFICA (Lista pazienti)
// =====================
function isAnagraficaPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/anagrafica.html") || p.endsWith("/anagrafica.html");
}

function normStr(x) {
  return String(x ?? "").trim();
}

function normalizePhone(raw) {
  const s = normStr(raw);
  if (!s) return "";
  // Mantieni + solo se è all'inizio, poi solo цифre
  const plus = s.trim().startsWith("+") ? "+" : "";
  const digits = s.replace(/[^\d]/g, "");
  return (plus + digits).trim();
}

function buildTelHref(phoneRaw) {
  const p = normalizePhone(phoneRaw);
  return p ? `tel:${p}` : "";
}

function buildWaHref(phoneRaw) {
  const p = normalizePhone(phoneRaw);
  // wa.me vuole solo numeri (senza +)
  const digits = p.replace(/[^\d]/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

// =====================
// DASHBOARD (KPI "Oggi")
// =====================
function normalizeApptType(v) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
function parseDateSafe(v) {
  const d = new Date(String(v || ""));
  return Number.isNaN(d.getTime()) ? null : d;
}
function overlapMinutesForDay(appt, dayStart, dayEnd) {
  const s = parseDateSafe(appt?.start_at);
  if (!s) return 0;

  let e = parseDateSafe(appt?.end_at);
  if (!e) {
    const raw = appt?.duration;
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (Number.isFinite(n) && n > 0) e = new Date(s.getTime() + n * 60_000);
  }
  if (!e) return 0;

  const start = s < dayStart ? dayStart : s;
  const end = e > dayEnd ? dayEnd : e;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0, Math.round(ms / 60_000));
}

async function initDashboard() {
  if (!isDashboardPage()) return;

  const valueEl = document.querySelector("[data-kpi-today]");
  const miniEl = document.querySelector("[data-kpi-today-mini]");
  if (!valueEl) return;

  valueEl.textContent = "—";
  if (miniEl) miniEl.textContent = "Caricamento…";

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  try {
    const data = await api(
      `/api/appointments?start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(dayEnd.toISOString())}`,
    );
    const appts = Array.isArray(data?.appointments) ? data.appointments : [];

    const wantedType = "appuntamento paziente";
    const filtered = appts.filter((a) => normalizeApptType(a?.appointment_type) === wantedType);

    let minutes = 0;
    for (const a of filtered) minutes += overlapMinutesForDay(a, dayStart, dayEnd);

    const slots = minutes <= 0 ? 0 : Math.ceil(minutes / 60);
    valueEl.textContent = String(slots);
    if (miniEl) miniEl.textContent = `Slot da 60' • solo "Appuntamento paziente"`;
  } catch (e) {
    console.error(e);
    if (miniEl) miniEl.textContent = "Impossibile caricare gli appuntamenti di oggi.";
  }
}

function includesChannelPref(raw, filter) {
  const s = normStr(raw).toLowerCase();
  if (!filter) return true;
  return s.includes(filter);
}

function fmtDob(dob) {
  const s = normStr(dob);
  if (!s) return "—";
  // se Airtable restituisce ISO, proviamo a formattare
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    try {
      return dt.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      return s;
    }
  }
  return s;
}

function renderPatientsTable(tbody, items, metaEl) {
  tbody.innerHTML = "";
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">Nessun paziente trovato.</td></tr>`;
    if (metaEl) metaEl.textContent = "0 risultati";
    return;
  }

  for (const p of items) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.onclick = () => {
      const href = `paziente.html?id=${encodeURIComponent(p.id)}`;
      if (typeof window.fpNavigate === "function") window.fpNavigate(href);
      else location.href = href;
    };

    const tel = p.Telefono || "";
    const telHref = buildTelHref(tel);
    const waHref = buildWaHref(tel);
    const channels = p["Canali di comunicazione preferiti"] ?? "";

    tr.innerHTML = `
      <td>${normStr(p.Nome) || "—"}</td>
      <td>${normStr(p.Cognome) || "—"}</td>
      <td>${normStr(p["Codice Fiscale"]) || "—"}</td>
      <td>${normStr(p.Email) || "—"}</td>
      <td>${normStr(tel) || "—"}</td>
      <td>${fmtDob(p["Data di nascita"])}</td>
      <td>${normStr(channels) || "—"}</td>
      <td>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <a class="btn" data-action="call" href="${telHref || "#"}" ${telHref ? "" : 'aria-disabled="true"'} style="padding:8px 10px; font-size:14px;" target="_self" rel="noreferrer">Chiama</a>
          <a class="btn primary" data-action="wa" href="${waHref || "#"}" ${waHref ? "" : 'aria-disabled="true"'} style="padding:8px 10px; font-size:14px;" target="_blank" rel="noreferrer">WhatsApp</a>
        </div>
      </td>
    `;

    // evita click riga quando clicco bottoni
    tr.querySelectorAll('a[data-action]').forEach((a) => {
      a.addEventListener("click", (e) => {
        e.stopPropagation();
        if (a.getAttribute("href") === "#") e.preventDefault();
      });
    });

    tbody.appendChild(tr);
  }

  if (metaEl) metaEl.textContent = `${items.length} risultati`;
}

async function initAnagrafica() {
  if (!isAnagraficaPage()) return;

  const searchInput = document.querySelector("[data-search]");
  const tbody = document.querySelector("[data-patients-body]");
  const metaEl = document.querySelector("[data-patients-meta]");
  const channelSel = document.querySelector("[data-filter-channel]");
  if (!tbody) return;

  let lastItems = [];
  let timer = null;

  const load = async () => {
    const q = normStr(searchInput?.value);
    const channel = normStr(channelSel?.value).toLowerCase();

    tbody.innerHTML = `<tr><td colspan="8" class="muted">Caricamento…</td></tr>`;
    try {
      const data = await api(`/api/airtable?op=searchPatientsFull&q=${encodeURIComponent(q)}`);
      const items = (data.items || []).map((x) => ({
        ...x,
        // normalizza canali come stringa per filtro
        "Canali di comunicazione preferiti": Array.isArray(x["Canali di comunicazione preferiti"])
          ? x["Canali di comunicazione preferiti"].join(", ")
          : (x["Canali di comunicazione preferiti"] ?? ""),
      }));
      lastItems = items;
      const filtered = items.filter((p) => includesChannelPref(p["Canali di comunicazione preferiti"], channel));
      renderPatientsTable(tbody, filtered, metaEl);
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="8" class="muted">Errore caricamento lista (controlla Airtable/API).</td></tr>`;
      if (metaEl) metaEl.textContent = "Errore";
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  };

  if (searchInput) searchInput.addEventListener("input", schedule);
  if (channelSel) channelSel.addEventListener("change", () => {
    const channel = normStr(channelSel.value).toLowerCase();
    const filtered = lastItems.filter((p) => includesChannelPref(p["Canali di comunicazione preferiti"], channel));
    renderPatientsTable(tbody, filtered, metaEl);
  });

  await load();
}

// Hover card
function buildHoverCard() {
  const el = document.createElement("div");
  el.className = "oe-hovercard";
  el.style.display = "none";
  el.innerHTML = `
    <div class="oe-hovercard__title" data-hc-title></div>
    <div class="oe-hovercard__row"><span class="oe-dot"></span><span data-hc-time></span></div>
    <div class="oe-hovercard__row" data-hc-status-row style="display:none;">
      <span class="oe-dot oe-dot--warn"></span><span data-hc-status></span>
    </div>
    <div class="oe-hovercard__row" data-hc-service-row style="display:none;">
      <span class="oe-ic">🏷️</span><span data-hc-service></span>
    </div>
    <div class="oe-hovercard__row" data-hc-ther-row style="display:none;">
      <span class="oe-ic">👤</span><span data-hc-ther></span>
    </div>
    <div class="oe-hovercard__note" data-hc-note style="display:none;"></div>
  `;
  document.body.appendChild(el);
  return el;
}
function showHoverCard(card, appt, x, y) {
  card.style.left = (x + 12) + "px";
  card.style.top = (y + 12) + "px";
  card.querySelector("[data-hc-title]").textContent = appt.patient_name || "";
  card.querySelector("[data-hc-time]").textContent = fmtTime(appt.start_at);

  const statusRow = card.querySelector("[data-hc-status-row]");
  const serviceRow = card.querySelector("[data-hc-service-row]");
  const therRow = card.querySelector("[data-hc-ther-row]");
  const noteEl = card.querySelector("[data-hc-note]");

  if (appt.status) { statusRow.style.display=""; card.querySelector("[data-hc-status]").textContent=appt.status; }
  else statusRow.style.display="none";

  if (appt.service_name) { serviceRow.style.display=""; card.querySelector("[data-hc-service]").textContent=appt.service_name; }
  else serviceRow.style.display="none";

  if (appt.therapist_name) { therRow.style.display=""; card.querySelector("[data-hc-ther]").textContent=appt.therapist_name; }
  else therRow.style.display="none";

  if (appt.internal_note) { noteEl.style.display=""; noteEl.textContent=appt.internal_note; }
  else noteEl.style.display="none";

  card.style.display="block";
}
function hideHoverCard(card){ card.style.display="none"; }

// Modal
function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "oe-modal__backdrop";
  wrap.style.display = "none";
  wrap.innerHTML = `
    <div class="oe-modal" role="dialog" aria-modal="true">
      <div class="oe-modal__header">
        <div class="oe-modal__title">Dettagli appuntamento</div>
        <button class="oe-modal__x" data-close aria-label="Chiudi">×</button>
      </div>

      <div class="oe-modal__body">
        <div class="oe-modal__top">
          <div class="oe-modal__topActions">
            <button class="oe-chipbtn oe-chipbtn--accent" type="button" data-action-repeat>RIPETI</button>
            <button class="oe-chipbtn" type="button" data-action-notify>NOTIFICHE</button>
            <button class="oe-chipbtn oe-chipbtn--accent2" type="button" data-action-location>LUOGO</button>
            <button class="oe-chipbtn oe-chipbtn--danger" type="button" data-action-delete>ELIMINA</button>
          </div>
          <div class="oe-modal__created" data-created></div>
        </div>

        <div class="oe-modal__patientCenter">
          <div class="oe-modal__patientnameRow">
            <div class="oe-modal__patientname" data-pname></div>
            <div class="oe-badge" data-ptag style="display:none"></div>
          </div>
          <div class="oe-modal__patientActions">
            <a class="oe-chipbtn" data-call href="#" aria-disabled="true">CHIAMA</a>
            <a class="oe-chipbtn oe-chipbtn--accent" data-wa href="#" aria-disabled="true">+39… WhatsApp</a>
            <a class="oe-chipbtn" data-email href="#" aria-disabled="true">EMAIL</a>
            <a class="oe-modal__patientlink" data-plink href="#">Apri scheda paziente</a>
          </div>
        </div>

        <div class="oe-modal__section">
          <div class="oe-modal__dt" data-datetime-label></div>
        </div>

        <div class="oe-grid oe-grid--2">
          <label class="oe-field oe-field--wide">
            <span>Esito appuntamento</span>
            <select data-f-status></select>
          </label>
        </div>

        <div class="oe-grid oe-grid--3">
          <label class="oe-field">
            <span>Voce prezzario</span>
            <select data-f-service></select>
          </label>
          <label class="oe-field">
            <span>Durata (min)</span>
            <input type="number" min="0" step="1" data-f-duration />
          </label>
          <label class="oe-field">
            <span>Agenda</span>
            <select data-f-operator></select>
          </label>
          <label class="oe-field oe-field--wide">
            <span>Luogo</span>
            <select data-f-location></select>
          </label>
        </div>

        <div class="oe-modal__checks">
          <label class="oe-check"><input type="checkbox" data-f-confirm-patient /> <span>Confermato dal paziente</span></label>
          <label class="oe-check"><input type="checkbox" data-f-confirm-platform /> <span>Conferma in InBuoneMani</span></label>
        </div>

        <div class="oe-grid oe-grid--2">
          <label class="oe-field oe-field--wide">
            <span>Note interne</span>
            <textarea data-f-quick maxlength="255"></textarea>
            <div class="oe-counter"><span data-count-internal>0</span> / 255</div>
          </label>
          <label class="oe-field oe-field--wide">
            <span>Note visibili al paziente</span>
            <textarea data-f-notes maxlength="255"></textarea>
            <div class="oe-counter"><span data-count-patient>0</span> / 255</div>
          </label>
        </div>
      </div>

      <div class="oe-modal__footer">
        <button class="oe-btn" data-cancel>Annulla</button>
        <button class="oe-btn oe-btn--primary" data-save>Chiudi</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  return wrap;
}

function setSelectOptions(selectEl, items, { placeholder = "—", allowEmpty = true } = {}) {
  if (!selectEl) return;
  const prev = selectEl.value;
  selectEl.innerHTML = "";
  if (allowEmpty) {
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholder;
    selectEl.appendChild(opt0);
  }
  (items || []).forEach((it) => {
    const opt = document.createElement("option");
    opt.value = it.id;
    opt.textContent = it.name || it.label || it.id;
    selectEl.appendChild(opt);
  });
  if (prev) selectEl.value = prev;
}

function ensureSelectHasValue(selectEl, value, label = null) {
  if (!selectEl) return;
  const v = String(value || "");
  if (!v) return;
  const exists = Array.from(selectEl.options || []).some((o) => String(o.value) === v);
  if (exists) return;
  const opt = document.createElement("option");
  opt.value = v;
  opt.textContent = label || v;
  selectEl.appendChild(opt);
}

function setMultiSelectValues(selectEl, values) {
  const want = new Set((values || []).map((x) => String(x)));
  Array.from(selectEl?.options || []).forEach((opt) => {
    opt.selected = want.has(String(opt.value));
  });
}

function getMultiSelectValues(selectEl) {
  return Array.from(selectEl?.selectedOptions || []).map((o) => String(o.value)).filter(Boolean);
}

function parseCommaList(s) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function ensureModalStaticOptions(modal) {
  if (modal.__staticOptsLoaded) return;
  modal.__staticOptsLoaded = true;

  const serviceSel = modal.querySelector("[data-f-service]");
  const operatorSel = modal.querySelector("[data-f-operator]");
  const locationSel = modal.querySelector("[data-f-location]");
  const treatmentsSel = modal.querySelector("[data-f-treatments]");
  const statusSel = modal.querySelector("[data-f-status]");

  try {
    const [ops, serv, loc, tr] = await Promise.all([
      api("/api/operators"),
      api("/api/services"),
      // Positions are stored in Airtable table "AZIENDA" (requested).
      api("/api/locations?table=AZIENDA&nameField=Sede"),
      treatmentsSel ? api("/api/treatments?activeOnly=1") : Promise.resolve({ items: [] }),
    ]);
    setSelectOptions(operatorSel, ops.items || [], { placeholder: "—" });
    setSelectOptions(serviceSel, serv.items || [], { placeholder: "—" });
    setSelectOptions(locationSel, loc.items || [], { placeholder: "—" });
    // Status is a single-select in Airtable: load choices (Meta API) or inferred values.
    try {
      const st = await api("/api/appointment-field-options?field=Stato appuntamento");
      setSelectOptions(statusSel, (st.items || []).map((x) => ({ id: x.id, name: x.name })), { placeholder: "—", allowEmpty: true });
    } catch (e) {
      console.warn("Status options not available", e);
      setSelectOptions(statusSel, [], { placeholder: "—" });
    }

    if (treatmentsSel) {
      treatmentsSel.innerHTML = "";
      (tr.items || []).forEach((it) => {
        const opt = document.createElement("option");
        opt.value = it.id;
        opt.textContent = it.name || it.id;
        treatmentsSel.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn("Modal static options not available", e);
    setSelectOptions(operatorSel, [], { placeholder: "(non disponibile)" });
    setSelectOptions(serviceSel, [], { placeholder: "(non disponibile)" });
    setSelectOptions(locationSel, [], { placeholder: "(non disponibile)" });
    setSelectOptions(statusSel, [], { placeholder: "(non disponibile)" });
    if (treatmentsSel) {
      treatmentsSel.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(non disponibile)";
      treatmentsSel.appendChild(opt);
      treatmentsSel.disabled = true;
    }
  }
}

async function loadModalPatientOptions(modal, patientId) {
  const caseSel = modal.querySelector("[data-f-case]");
  const saleSel = modal.querySelector("[data-f-sale]");
  const evalSel = modal.querySelector("[data-f-evals]");
  const erogatoSel = modal.querySelector("[data-f-erogato]");

  // This modal variant doesn't render these advanced fields.
  if (!caseSel && !saleSel && !evalSel && !erogatoSel) return;

  setSelectOptions(caseSel, [], { placeholder: "—" });
  setSelectOptions(saleSel, [], { placeholder: "—" });
  setSelectOptions(erogatoSel, [], { placeholder: "—" });
  if (evalSel) evalSel.innerHTML = "";
  if (!patientId) return;

  try {
    const [cases, sales, evals, erogato] = await Promise.all([
      api(`/api/cases?patientId=${encodeURIComponent(patientId)}`),
      api(`/api/sales?patientId=${encodeURIComponent(patientId)}`),
      api(`/api/evaluations?patientId=${encodeURIComponent(patientId)}&maxRecords=50`),
      api(`/api/erogato?patientId=${encodeURIComponent(patientId)}&maxRecords=100`),
    ]);

    setSelectOptions(
      caseSel,
      (cases.items || []).map((x) => ({ id: x.id, name: [x.data, x.titolo].filter(Boolean).join(" • ") || x.id })),
      { placeholder: "—" },
    );
    setSelectOptions(
      saleSel,
      (sales.items || []).map((x) => ({ id: x.id, name: [x.data, x.voce].filter(Boolean).join(" • ") || x.id })),
      { placeholder: "—" },
    );
    setSelectOptions(
      erogatoSel,
      (erogato.items || []).map((x) => ({ id: x.id, name: [x.data, x.prestazione].filter(Boolean).join(" • ") || x.id })),
      { placeholder: "—" },
    );

    if (evalSel) {
      evalSel.innerHTML = "";
      (evals.items || []).forEach((x) => {
        const opt = document.createElement("option");
        opt.value = x.id;
        opt.textContent = [x.data, x.tipo].filter(Boolean).join(" • ") || x.id;
        evalSel.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn("Modal patient options not available", e);
    setSelectOptions(caseSel, [], { placeholder: "(non disponibile)" });
    setSelectOptions(saleSel, [], { placeholder: "(non disponibile)" });
    setSelectOptions(erogatoSel, [], { placeholder: "(non disponibile)" });
    if (evalSel) {
      evalSel.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(non disponibile)";
      evalSel.appendChild(opt);
      evalSel.disabled = true;
    }
  }
}

async function openModal(modal, appt, onSaved) {
  modal.__current = appt;

  modal.querySelector("[data-pname]").textContent = appt.patient_name || "";
  modal.querySelector("[data-plink]").href = `/pages/paziente.html?id=${encodeURIComponent(appt.patient_id || "")}`;

  await ensureModalStaticOptions(modal);
  // Older advanced selects are still loaded (cases/erogato/etc) only if present in DOM.
  await loadModalPatientOptions(modal, appt.patient_id || "");

  // Header meta
  const createdEl = modal.querySelector("[data-created]");
  if (createdEl) {
    const ct = appt.created_at || "";
    if (ct) {
      const d = new Date(ct);
      createdEl.textContent = isNaN(d.getTime()) ? "" : `Creato il ${d.toLocaleString("it-IT")}`;
    } else {
      createdEl.textContent = "";
    }
  }

  const dtLabel = modal.querySelector("[data-datetime-label]");
  if (dtLabel) {
    const d = new Date(appt.start_at || "");
    dtLabel.textContent = isNaN(d.getTime())
      ? ""
      : d.toLocaleString("it-IT", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  // Tag pill (use appointment_type if available)
  const tagEl = modal.querySelector("[data-ptag]");
  if (tagEl) {
    const tag = String(appt.appointment_type || "").trim();
    if (tag) { tagEl.textContent = tag; tagEl.style.display = ""; }
    else { tagEl.textContent = ""; tagEl.style.display = "none"; }
  }

  // Patient contacts
  const callA = modal.querySelector("[data-call]");
  const waA = modal.querySelector("[data-wa]");
  const emailA = modal.querySelector("[data-email]");
  const setLink = (a, href, text) => {
    if (!a) return;
    a.textContent = text || a.textContent;
    a.href = href || "#";
    if (href) a.removeAttribute("aria-disabled");
    else a.setAttribute("aria-disabled", "true");
  };
  setLink(callA, "", "CHIAMA");
  setLink(waA, "", "+39… WhatsApp");
  setLink(emailA, "", "EMAIL");
  if (appt.patient_id) {
    try {
      const p = await api(`/api/patient?id=${encodeURIComponent(appt.patient_id)}`);
      const telRaw = String(p.Telefono || "").trim();
      const tel = telRaw.replace(/[^\d+]/g, "");
      const telHref = tel ? `tel:${tel}` : "";
      const waHref = tel ? `https://wa.me/${tel.replace(/^\+/, "")}` : "";
      const email = String(p.Email || "").trim();
      const emailHref = email ? `mailto:${email}` : "";
      setLink(callA, telHref, "CHIAMA");
      setLink(waA, waHref, telRaw ? `${telRaw} WhatsApp` : "+39… WhatsApp");
      setLink(emailA, emailHref, email || "EMAIL");
    } catch (e) {
      console.warn("Patient contact not available", e);
    }
  }

  const servSel = modal.querySelector("[data-f-service]");
  const opSel = modal.querySelector("[data-f-operator]");
  const locSel = modal.querySelector("[data-f-location]");
  ensureSelectHasValue(servSel, appt.service_id, appt.service_name || appt.service_id);
  ensureSelectHasValue(opSel, appt.therapist_id, appt.therapist_name || appt.therapist_id);
  ensureSelectHasValue(locSel, appt.location_id, appt.location_name || appt.location_id);
  if (servSel) servSel.value = appt.service_id || "";
  if (opSel) opSel.value = appt.therapist_id || "";
  if (locSel) locSel.value = appt.location_id || "";

  const statusSel = modal.querySelector("[data-f-status]");
  ensureSelectHasValue(statusSel, appt.status, appt.status);
  if (statusSel) statusSel.value = appt.status || "";

  const durEl = modal.querySelector("[data-f-duration]");
  if (durEl) {
    durEl.value =
      (appt.duration !== undefined && appt.duration !== null && String(appt.duration).trim() !== "")
        ? appt.duration
        : (String(appt.duration_label || "").replace(/[^\d]/g, "") || "");
  }

  modal.querySelector("[data-f-quick]").value = appt.quick_note || appt.internal_note || "";
  modal.querySelector("[data-f-notes]").value = appt.notes || appt.patient_note || "";

  const chkPatient = modal.querySelector("[data-f-confirm-patient]");
  const chkPlatform = modal.querySelector("[data-f-confirm-platform]");
  if (chkPatient) chkPatient.checked = Boolean(appt.confirmed_by_patient);
  if (chkPlatform) chkPlatform.checked = Boolean(appt.confirmed_in_platform);

  const updateCounters = () => {
    const internal = modal.querySelector("[data-f-quick]");
    const patient = modal.querySelector("[data-f-notes]");
    const ci = modal.querySelector("[data-count-internal]");
    const cp = modal.querySelector("[data-count-patient]");
    if (ci && internal) ci.textContent = String((internal.value || "").length);
    if (cp && patient) cp.textContent = String((patient.value || "").length);
  };
  const internalEl = modal.querySelector("[data-f-quick]");
  const patientEl = modal.querySelector("[data-f-notes]");
  if (internalEl) internalEl.oninput = updateCounters;
  if (patientEl) patientEl.oninput = updateCounters;
  updateCounters();

  const close = () => { modal.style.display = "none"; };
  modal.querySelector("[data-close]").onclick = close;
  modal.querySelector("[data-cancel]").onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };

  // Header actions (currently placeholders except delete/location)
  const locBtn = modal.querySelector("[data-action-location]");
  if (locBtn) locBtn.onclick = () => modal.querySelector("[data-f-location]")?.focus?.();

  const delBtn = modal.querySelector("[data-action-delete]");
  if (delBtn) delBtn.onclick = async () => {
    const a = modal.__current;
    if (!a) return;
    if (!confirm("Eliminare questo appuntamento?")) return;
    try {
      delBtn.disabled = true;
      await api(`/api/appointments?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
      toast("Eliminato");
      close();
      if (typeof onSaved === "function") onSaved({ ...a, __deleted: true });
    } catch (e) {
      console.error(e);
      alert("Errore eliminazione. Controlla Console/Network.");
    } finally {
      delBtn.disabled = false;
    }
  };

  modal.querySelector("[data-save]").onclick = async () => {
    const a = modal.__current;
    if (!a) return;

    const payload = {
      status: modal.querySelector("[data-f-status]")?.value || "",
      serviceId: modal.querySelector("[data-f-service]").value,
      collaboratoreId: modal.querySelector("[data-f-operator]").value,
      sedeId: modal.querySelector("[data-f-location]").value,
      durata: modal.querySelector("[data-f-duration]").value,
      confirmed_by_patient: Boolean(modal.querySelector("[data-f-confirm-patient]")?.checked),
      confirmed_in_platform: Boolean(modal.querySelector("[data-f-confirm-platform]")?.checked),
      notaRapida: modal.querySelector("[data-f-quick]").value,
      note: modal.querySelector("[data-f-notes]").value,
    };

    try {
      const btn = modal.querySelector("[data-save]");
      btn.disabled = true;

      const updated = await api(`/api/appointments?id=${encodeURIComponent(a.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      toast("Salvato");
      close();
      const apptUpdated = updated.appointment || updated;
      if (typeof onSaved === "function") onSaved(apptUpdated);
    } catch (err) {
      console.error(err);
      alert("Errore salvataggio su Airtable. Controlla Console/Network.");
    } finally {
      modal.querySelector("[data-save]").disabled = false;
    }
  };

  modal.style.display = "flex";
}

// Sidebars collapse
function initSidebars() {
  const leftBtn = document.querySelector("[data-toggle-left]");
  const rightBtn = document.querySelector("[data-toggle-right]");
  if (leftBtn) leftBtn.onclick = () => document.body.classList.toggle("oe-hide-left");
  if (rightBtn) rightBtn.onclick = () => document.body.classList.toggle("fp-right-expanded");
}

// =====================
// SPA NAV (persist menus, swap center only)
// =====================
function isSpaShell() {
  const app = document.querySelector(".app");
  if (!app) return false;
  return Boolean(app.querySelector(":scope > .sidebar") && app.querySelector(":scope > .main") && app.querySelector(":scope > .rightbar"));
}

function ensureGlobalTopbar() {
  if (!document.querySelector(".app")) return;

  // Create once and keep it persistent across SPA swaps, but refresh the text each route.
  let bar = document.querySelector(".fp-topbar");
  if (!bar) {
    bar = document.createElement("header");
    bar.className = "fp-topbar";
    document.body.insertBefore(bar, document.body.firstChild);
    bar.innerHTML = `
      <div class="fp-topbar__left">
        <button type="button" class="fp-iconbtn" data-toggle-left="1" aria-label="Apri/chiudi menu sinistro">
          <span class="ic">☰</span>
        </button>
        <div class="fp-topbar__logo" aria-hidden="true"></div>
        <div class="fp-topbar__brand">
          <div class="fp-topbar__title" data-fp-top-title></div>
          <div class="fp-topbar__sub" data-fp-top-sub></div>
        </div>
      </div>
      <div class="fp-topbar__right">
        <button type="button" class="fp-iconbtn" data-toggle-right="1" aria-label="Apri/chiudi menu destro">
          <span class="ic">≡</span>
        </button>
      </div>
    `;
  }

  // Pull label from left brand if available.
  const brandTitle = String(document.querySelector(".sidebar .brand .title")?.textContent || "").trim();
  const brandSub = String(document.querySelector(".sidebar .brand .sub")?.textContent || "").trim();

  const tEl = bar.querySelector("[data-fp-top-title]");
  const sEl = bar.querySelector("[data-fp-top-sub]");
  if (tEl) tEl.textContent = "FISIOPRO";
  if (sEl) sEl.textContent = brandSub || "";

  document.body.classList.add("fp-has-topbar");
  window.__FP_GLOBAL_TOPBAR_READY = true;
}

function ensureTopbarToggles() {
  // Kept for backwards compatibility; toggles now live in the global .fp-topbar.
  // No-op to avoid duplicated buttons inside the page topbar.
}

function shouldSpaHandleUrl(url) {
  try {
    const u = url instanceof URL ? url : new URL(String(url), location.href);
    if (u.origin !== location.origin) return false;
    if (!u.pathname.startsWith("/pages/")) return false;
    if (!u.pathname.endsWith(".html")) return false;
    // Logout/login should remain a full navigation (session handling).
    if (u.pathname.endsWith("/pages/login.html")) return false;
    if (u.pathname.endsWith("/pages/index.html")) return false;
    return true;
  } catch {
    return false;
  }
}

function parseOnclickLocationHref(onclickRaw) {
  const s = String(onclickRaw || "");
  const m = s.match(/location\.href\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : "";
}

async function loadHtml(url) {
  const u = url instanceof URL ? url : new URL(String(url), location.href);
  const res = await fetch(u.pathname + u.search, { credentials: "include" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text;
}

function extractPageParts(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const app = doc.querySelector(".app");
  const main = app?.querySelector(":scope > .main") || doc.querySelector("main.main") || doc.querySelector("main");
  const rightbar = app?.querySelector(":scope > .rightbar") || doc.querySelector("aside.rightbar");
  const title = String(doc.querySelector("title")?.textContent || "").trim();
  const inlineStyles = Array.from(doc.querySelectorAll("head style"))
    .map((s) => String(s.textContent || ""))
    .join("\n");
  const hasDiary = Boolean(app?.hasAttribute("data-diary"));
  const hasPatientPage = Boolean(doc.querySelector("main[data-patient-page], .main[data-patient-page]"));
  const overlays = Array.from(doc.body?.children || [])
    .filter((el) => el && el.nodeType === 1)
    .filter((el) => !el.classList.contains("app"))
    .filter((el) => el.tagName !== "SCRIPT")
    .filter((el) => !el.classList.contains("toast"))
    .map((el) => el.outerHTML)
    .join("\n");
  return { title, main, rightbar, inlineStyles, hasDiary, hasPatientPage, overlays };
}

function applyRouteStyles(cssText) {
  const id = "fp-route-style";
  const prev = document.getElementById(id);
  if (prev) prev.remove();
  const css = String(cssText || "").trim();
  if (!css) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

function bootstrapRouteStyleControl() {
  // Move existing inline <style> tags into our managed container.
  const styles = Array.from(document.querySelectorAll("head style"));
  if (!styles.length) return;
  const css = styles.map((s) => String(s.textContent || "")).join("\n");
  styles.forEach((s) => s.remove());
  applyRouteStyles(css);
}

function ensureOverlayHost() {
  let host = document.getElementById("fp-route-overlays");
  if (host) return host;
  host = document.createElement("div");
  host.id = "fp-route-overlays";
  document.body.appendChild(host);
  return host;
}

function bootstrapOverlayControl() {
  const host = ensureOverlayHost();
  const nodes = Array.from(document.body.children || [])
    .filter((el) => el && el.nodeType === 1)
    .filter((el) => el.id !== "fp-route-overlays")
    .filter((el) => !el.classList.contains("app"))
    .filter((el) => el.tagName !== "SCRIPT")
    .filter((el) => !el.classList.contains("toast"));

  if (!nodes.length) return;
  host.innerHTML = nodes.map((el) => el.outerHTML).join("\n");
  nodes.forEach((el) => el.remove());
}

function removeLegacyRightDrawer() {
  // Hard cleanup for older "white drawer" implementation.
  try { document.body.classList.remove("fp-right-open"); } catch {}
  try { document.body.classList.remove("fp-right-expanded"); } catch {}

  document.querySelectorAll(".fp-rightdetail-back, .fp-rightdetail").forEach((el) => el.remove());
  // It may have been captured inside the overlay host too.
  document.querySelectorAll("#fp-route-overlays .fp-rightdetail-back, #fp-route-overlays .fp-rightdetail").forEach((el) => el.remove());
}

async function ensureDiaryLoaded() {
  const p = location.pathname || "";
  if (!p.endsWith("/pages/agenda.html") && !p.endsWith("/agenda.html")) return;
  if (!document.querySelector("[data-diary]")) return;

  if (typeof window.fpDiaryInit === "function") {
    window.fpDiaryInit();
    return;
  }

  // If the page already includes diary.js via a <script> tag (classic load),
  // let it execute normally (it auto-inits).
  if (document.querySelector('script[src*="diary.js"]')) return;

  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    // Cache-bust diary.js to ensure UI updates propagate quickly.
    s.src = "/assets/diary.js?v=20251230-2";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("diary_load_failed"));
    document.head.appendChild(s);
  });

  if (typeof window.fpDiaryInit === "function") window.fpDiaryInit();
}

async function runRouteInits() {
  // Ensure global bar exists before wiring sidebar toggles.
  ensureGlobalTopbar();
  removeInnerMenuIcons();
  removeLegacyRightDrawer();
  normalizeRightbar();
  ensureSettingsModals();
  initSidebars();
  activeNav();
  initLogoutLinks();

  const role = String((window.FP_USER?.role || window.FP_SESSION?.role || "")).trim();
  if (role) roleGuard(role);

  await initAnagrafica();
  await initPatientPage();
  await ensureDiaryLoaded();
  await initDashboard();
}

function removeInnerMenuIcons() {
  // Remove any previously injected toggle icons inside the page topbar (Agenda/Dashboard etc).
  const scope = document.querySelector(".main .topbar") || document;
  scope.querySelectorAll(".fp-iconbtn[data-toggle-left], .fp-iconbtn[data-toggle-right]").forEach((el) => el.remove());
  // Remove empty wrapper if it was created
  scope.querySelectorAll(".fp-toprow-left").forEach((wrap) => {
    if (!wrap.querySelector(".h1") && !wrap.textContent.trim()) wrap.remove();
    // If wrapper only contains .h1, unwrap it
    const h1 = wrap.querySelector(":scope > .h1");
    if (h1 && wrap.children.length === 1) {
      wrap.parentElement?.insertBefore(h1, wrap);
      wrap.remove();
    }
  });
}

// (Right drawer removed) - rightbar itself expands/collapses.

function ensureSettingsModals() {
  // Availability
  if (!document.querySelector("[data-fp-av-back]")) {
    const back = document.createElement("div");
    back.className = "fp-set-back";
    back.setAttribute("data-fp-av-back", "1");
    back.innerHTML = `
      <div class="fp-set-panel" role="dialog" aria-modal="true">
        <div class="fp-set-head">
          <div class="fp-set-title"><span style="font-size:18px;">🕒</span> Configura la disponibilità</div>
          <button class="btn" type="button" data-fp-av-close>Chiudi</button>
        </div>
        <div class="fp-set-body">
          <div class="fp-av-top">
            <div style="font-weight:900;">Puoi selezionare più slot cliccando e trascinando la selezione</div>
          </div>
          <div class="fp-av-wrap" style="margin-top:12px;">
            <div class="fp-av-grid" data-fp-av-grid></div>
          </div>
        </div>
        <div class="fp-set-foot">
          <button class="btn" type="button" data-fp-av-reset>Reset</button>
          <button class="btn primary" type="button" data-fp-av-save>Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);
  }

  // Appointments
  if (!document.querySelector("[data-fp-appt-back]")) {
    const back = document.createElement("div");
    back.className = "fp-set-back";
    back.setAttribute("data-fp-appt-back", "1");
    back.innerHTML = `
      <div class="fp-set-panel" role="dialog" aria-modal="true">
        <div class="fp-set-head">
          <div class="fp-set-title"><span style="font-size:18px;">✅</span> Impostazioni Appuntamenti</div>
          <button class="btn" type="button" data-fp-appt-close>Chiudi</button>
        </div>
        <div class="fp-set-body">
          <div class="card" style="padding:14px;">
            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Proponi primo appuntamento a partire da</div>
                <div class="sub">Numero di giorni da oggi (default per proposta appuntamento).</div>
              </div>
              <div class="right">
                <input class="input" style="width:120px;" type="number" min="0" max="365" data-fp-appt-days />
                <div style="color:var(--muted);">giorni</div>
              </div>
            </div>

            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Sposta appuntamenti annullati in alto</div>
                <div class="sub">Mostra gli annullati come banda in alto.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="checkbox" data-fp-appt-cancelband /><span class="slider"></span></label>
              </div>
            </div>

            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Abilita modifica appuntamenti con trascinamento</div>
                <div class="sub">Consente drag&drop su agenda.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="checkbox" data-fp-appt-drag /><span class="slider"></span></label>
              </div>
            </div>

            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Considera gli appuntamenti associati da fatturare</div>
                <div class="sub">Flag utile per flussi amministrativi.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="checkbox" data-fp-appt-billing /><span class="slider"></span></label>
              </div>
            </div>

            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Mostra nome utente in fattura</div>
                <div class="sub">Usa il nome sotto come riferimento.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="checkbox" data-fp-appt-showname /><span class="slider"></span></label>
              </div>
            </div>

            <div class="fp-set-row" style="align-items:flex-start;">
              <div style="min-width:0;">
                <div class="lbl">Nome utente visualizzato</div>
                <div class="sub">Testo mostrato (max 150).</div>
              </div>
              <div class="right" style="flex-direction:column; align-items:flex-end;">
                <input class="input" style="width:min(520px, 78vw);" maxlength="150" data-fp-appt-name />
                <div style="font-size:12px; color:var(--muted);" data-fp-appt-name-count>0 / 150</div>
              </div>
            </div>

            <div class="fp-set-row" style="align-items:flex-start;">
              <div style="min-width:0;">
                <div class="lbl">Informazioni utente</div>
                <div class="sub">Note operative (opzionale).</div>
              </div>
              <div class="right" style="flex-direction:column; align-items:flex-end;">
                <textarea class="textarea" style="width:min(520px, 78vw); min-height: 90px;" maxlength="150" data-fp-appt-info></textarea>
                <div style="font-size:12px; color:var(--muted);" data-fp-appt-info-count>0 / 150</div>
              </div>
            </div>
          </div>
        </div>
        <div class="fp-set-foot">
          <button class="btn" type="button" data-fp-appt-reset>Reset</button>
          <button class="btn primary" type="button" data-fp-appt-save>Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);
  }

  // Theme
  if (!document.querySelector("[data-fp-theme-back]")) {
    const back = document.createElement("div");
    back.className = "fp-set-back";
    back.setAttribute("data-fp-theme-back", "1");
    back.innerHTML = `
      <div class="fp-set-panel" role="dialog" aria-modal="true" style="width:760px;">
        <div class="fp-set-head">
          <div class="fp-set-title"><span style="font-size:18px;">🎨</span> Tema</div>
          <button class="btn" type="button" data-fp-theme-close>Chiudi</button>
        </div>
        <div class="fp-set-body">
          <div class="card" style="padding:14px;">
            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Standard</div>
                <div class="sub">Tema attuale (baseline).</div>
              </div>
              <div class="right">
                <label class="switch"><input type="radio" name="fp_theme" value="standard" data-fp-theme-opt /><span class="slider"></span></label>
              </div>
            </div>
            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Pro (più leggibile)</div>
                <div class="sub">Superfici più chiare, contrasto migliore, bordi più definiti.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="radio" name="fp_theme" value="pro" data-fp-theme-opt /><span class="slider"></span></label>
              </div>
            </div>
          </div>
        </div>
        <div class="fp-set-foot">
          <button class="btn primary" type="button" data-fp-theme-save>Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);
  }
}

function fpSettingsKey(suffix) {
  const email = String((window.FP_USER?.email || window.FP_SESSION?.email || "anon")).trim().toLowerCase() || "anon";
  return `fp_settings_${suffix}_${email}`;
}

function openAvailabilityModal() {
  ensureSettingsModals();
  const back = document.querySelector("[data-fp-av-back]");
  if (!back) return;
  buildAvailabilityUI();
  back.style.display = "block";
}
function closeAvailabilityModal() {
  const back = document.querySelector("[data-fp-av-back]");
  if (back) back.style.display = "none";
}

function openAppointmentsModal() {
  ensureSettingsModals();
  const back = document.querySelector("[data-fp-appt-back]");
  if (!back) return;
  loadAppointmentsSettings();
  back.style.display = "block";
}
function closeAppointmentsModal() {
  const back = document.querySelector("[data-fp-appt-back]");
  if (back) back.style.display = "none";
}

function openThemeModal() {
  ensureSettingsModals();
  const back = document.querySelector("[data-fp-theme-back]");
  if (!back) return;
  const current = loadTheme();
  back.querySelectorAll("[data-fp-theme-opt]").forEach((r) => {
    r.checked = String(r.value) === current;
  });
  back.style.display = "block";
  const panel = back.querySelector(".fp-set-panel");
  const close = back.querySelector("[data-fp-theme-close]");
  const save = back.querySelector("[data-fp-theme-save]");
  close && (close.onclick = () => closeThemeModal());
  back.onclick = (e) => { if (e.target === back) closeThemeModal(); };
  save && (save.onclick = () => {
    const sel = back.querySelector("[data-fp-theme-opt]:checked");
    const val = String(sel?.value || "standard");
    saveTheme(val);
    closeThemeModal();
    toast("Salvato");
  });
}
function closeThemeModal() {
  const back = document.querySelector("[data-fp-theme-back]");
  if (back) back.style.display = "none";
}

function buildAvailabilityUI() {
  const grid = document.querySelector("[data-fp-av-grid]");
  if (!grid) return;

  const days = ["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"];

  // 30-min slots 07:00-21:00 (last start: 20:30)
  const startMin = 7 * 60;
  const endMin = 21 * 60;
  const step = 30;
  const times = [];
  for (let m = startMin; m < endMin; m += step) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    // show label only on the hour to keep the grid compact/clean
    times.push(mm === "00" ? `${hh}:00` : "");
  }

  const stateKey = fpSettingsKey("availability");
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(stateKey) || "null"); } catch {}

  // ranges kept for backwards compatibility, but not shown in UI (user requested).
  const ranges = saved?.ranges || [];

  // Operators (collaborators) list for per-therapist availability.
  // Cache in window to avoid repeated API calls as user opens/closes the modal.
  window.__FP_AV_OPERATORS = window.__FP_AV_OPERATORS || null;
  window.__FP_AV_OPERATOR_ITEMS = window.__FP_AV_OPERATOR_ITEMS || null; // [{id,name}]
  window.__FP_AV_OPNAME_TO_ID = window.__FP_AV_OPNAME_TO_ID || null; // { [name]: id }
  window.__FP_AV_OPERATORS_LOADING = window.__FP_AV_OPERATORS_LOADING || false;
  const ensureOperators = async () => {
    if (Array.isArray(window.__FP_AV_OPERATORS)) return window.__FP_AV_OPERATORS;
    if (window.__FP_AV_OPERATORS_LOADING) return [];
    window.__FP_AV_OPERATORS_LOADING = true;
    try {
      const data = await api("/api/operators");
      const items = (data.items || [])
        .map((x) => ({ id: String(x.id || "").trim(), name: String(x.name || "").trim(), color: String(x.color || "").trim() }))
        .filter((x) => x.id && x.name);
      const names = items.map((x) => x.name);
      const map = {};
      const colorByName = {};
      items.forEach((x) => { map[x.name] = x.id; });
      items.forEach((x) => { if (x.color) colorByName[x.name] = x.color; });
      window.__FP_AV_OPERATOR_ITEMS = items;
      window.__FP_AV_OPNAME_TO_ID = map;
      window.__FP_AV_OPNAME_TO_COLOR = colorByName;
      window.__FP_AV_OPERATORS = names;
      return names;
    } catch {
      window.__FP_AV_OPERATORS = [];
      window.__FP_AV_OPERATOR_ITEMS = [];
      window.__FP_AV_OPNAME_TO_ID = {};
      window.__FP_AV_OPNAME_TO_COLOR = {};
      return [];
    } finally {
      window.__FP_AV_OPERATORS_LOADING = false;
    }
  };

  // slot state model (new):
  // - saved.byTherapist: { [therapistName|DEFAULT]: { [key:"d:r"]: {status:"work"|"off", locationId?:string} } }
  // Back-compat:
  // - saved.slots => treated as DEFAULT
  // - legacy saved.on => treated as DEFAULT work
  const slotsByTherapist = (() => {
    const s = saved && typeof saved === "object" ? saved : null;
    const by = s?.byTherapist && typeof s.byTherapist === "object" ? s.byTherapist : null;
    if (by) return JSON.parse(JSON.stringify(by));
    const out = { DEFAULT: {} };
    const slots = s?.slots && typeof s.slots === "object" ? s.slots : null;
    if (slots) {
      Object.keys(slots).forEach((k) => {
        const v = slots[k];
        if (!v || typeof v !== "object") return;
        const st = String(v.status || "").toLowerCase();
        if (st !== "work" && st !== "off") return;
        out.DEFAULT[String(k)] = { status: st, locationId: String(v.locationId || "") };
      });
    } else {
      const on = Array.isArray(s?.on) ? s.on : [];
      on.forEach((k) => { out.DEFAULT[String(k)] = { status: "work", locationId: "" }; });
    }
    return out;
  })();

  const last = (() => {
    const s = saved && typeof saved === "object" ? saved : null;
    const l = s?.last && typeof s.last === "object" ? s.last : null;
    const st = String(l?.status || "work").toLowerCase();
    return {
      status: st === "off" ? "off" : "work",
      locationId: String(l?.locationId || ""),
      applyAll: Boolean(l?.applyAll ?? false),
    };
  })();

  // current therapist selection (default to lastTherapist if present)
  let currentTherapist = String(saved?.lastTherapist || window.__FP_AV_LAST_THER || "DEFAULT").trim() || "DEFAULT";
  window.__FP_AV_LAST_THER = currentTherapist;

  // Per-operator colors (shared: stored in Airtable via /api/operators.color)
  function normalizeHexColor(s) {
    const x = String(s || "").trim();
    const m = x.match(/^#([0-9a-fA-F]{6})$/);
    return m ? ("#" + m[1].toUpperCase()) : "";
  }
  function hexToRgb(hex) {
    const h = String(hex || "").trim();
    const m = h.match(/^#([0-9a-fA-F]{6})$/);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbaFromHex(hex, alpha) {
    const a = Math.max(0, Math.min(1, Number(alpha)));
    const rgb = hexToRgb(hex);
    if (!rgb) return "";
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
  }
  function hashHue(s) {
    const str = String(s || "");
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function defaultHslaForName(name, alpha) {
    const n = String(name || "").trim();
    if (!n || n === "DEFAULT") return `rgba(34,230,195,${Math.max(0, Math.min(1, Number(alpha)))})`;
    const hue = hashHue(n);
    return `hsla(${hue} 78% 58% / ${Math.max(0, Math.min(1, Number(alpha)))})`;
  }
  function operatorHexForTherapistName(name) {
    const n = String(name || "").trim();
    if (!n || n === "DEFAULT") return "";
    const cMap = window.__FP_AV_OPNAME_TO_COLOR && typeof window.__FP_AV_OPNAME_TO_COLOR === "object" ? window.__FP_AV_OPNAME_TO_COLOR : {};
    return normalizeHexColor(cMap[n]);
  }
  function workBgForTherapist(name) {
    const hex = operatorHexForTherapistName(name);
    if (hex) return rgbaFromHex(hex, 0.22) || defaultHslaForName(name, 0.22);
    return defaultHslaForName(name, 0.22);
  }
  function workOutlineForTherapist(name) {
    const hex = operatorHexForTherapistName(name);
    if (hex) return rgbaFromHex(hex, 0.40) || defaultHslaForName(name, 0.40);
    return defaultHslaForName(name, 0.40);
  }

  const ensureTherBucket = (ther) => {
    const k = String(ther || "").trim() || "DEFAULT";
    if (!slotsByTherapist[k] || typeof slotsByTherapist[k] !== "object") slotsByTherapist[k] = {};
    return slotsByTherapist[k];
  };
  const getSlotRec = (ther, key) => {
    const t = String(ther || "").trim() || "DEFAULT";
    const k = String(key || "");
    const specific = slotsByTherapist?.[t]?.[k] || null;
    if (specific) return specific;
    return slotsByTherapist?.DEFAULT?.[k] || null;
  };
  const setSlotRec = (ther, key, rec) => {
    const t = String(ther || "").trim() || "DEFAULT";
    const k = String(key || "");
    ensureTherBucket(t);
    if (!rec) delete slotsByTherapist[t][k];
    else slotsByTherapist[t][k] = rec;
  };

  // header row
  const headCells = days
    .map((d, idx) => `
      <div class="fp-av-dayhead">
        <div class="d">${d}</div>
      </div>
    `)
    .join("");

  // Top toolbar (collaborator picker)
  const top = document.querySelector(".fp-av-top");
  if (top) {
    top.innerHTML = `
      <div class="fp-av-toolbar">
        <div class="left">
          <div style="font-weight:1000;">Puoi selezionare più slot cliccando e trascinando la selezione</div>
          <div style="opacity:.75;">•</div>
          <label style="display:flex; align-items:center; gap:12px; margin-left:12px;">
            <span>Collaboratore:</span>
            <select data-av-ther style="font-size:14px;">
              <option value="DEFAULT">Tutti (default)</option>
            </select>
          </label>
        </div>
      </div>
    `;
  }

  grid.innerHTML = `
    <div class="fp-av-dayhead" style="background:rgba(0,0,0,.10); border-right:1px solid rgba(255,255,255,.08); border-bottom:1px solid rgba(255,255,255,.08);"></div>
    ${headCells}
    <div class="fp-av-timecol">
      ${times.map((t) => `<div class="fp-av-time">${t}</div>`).join("")}
    </div>
    ${days
      .map((_, dIdx) => {
        return `
          <div style="display:grid; grid-template-rows: repeat(${times.length}, 18px);">
            ${times.map((t, rIdx) => {
              const key = `${dIdx}:${rIdx}`;
              const st = getSlotRec(currentTherapist, key)?.status || "";
              const cls = st === "work" ? "work" : "";
              const style = st === "work"
                ? `style="background:${workBgForTherapist(currentTherapist)}; outline:1px solid ${workOutlineForTherapist(currentTherapist)};"`
                : "";
              return `<div class="fp-av-cell ${cls}" ${style} data-av-cell="${key}"></div>`;
            }).join("")}
          </div>
        `;
      })
      .join("")}
  `;

  // --- Editor overlay (OsteoEasy-like) ---
  const back = document.querySelector("[data-fp-av-back]");
  const panelBody = back?.querySelector(".fp-set-body");
  if (!back || !panelBody) return;

  // Clean previous editor (rebuilds)
  panelBody.querySelectorAll(".fp-av-editor").forEach((el) => el.remove());

  const editor = document.createElement("div");
  editor.className = "fp-av-editor";
  editor.style.display = "none";
  editor.innerHTML = `
    <div class="fp-av-editor__head">
      <div class="fp-av-editor__title"><span style="font-size:22px;">🕒</span> <span data-av-ed-title>0 slot selezionati</span></div>
      <button type="button" class="fp-av-editor__x" data-av-ed-x aria-label="Chiudi">×</button>
    </div>
    <div class="fp-av-editor__body">
      <div class="fp-av-editor__row">
        <div class="fp-av-editor__radio">
          <label><input type="radio" name="avStatus" value="off" data-av-ed-status /> Non lavorativo</label>
          <label><input type="radio" name="avStatus" value="work" data-av-ed-status /> Lavorativo</label>
        </div>
      </div>
      <div class="fp-av-editor__row">
        <label style="display:flex; gap:10px; align-items:center; font-weight:900;">
          <input type="checkbox" data-av-ed-all />
          <span>Applica a tutti i collaboratori</span>
        </label>
      </div>
      <div class="fp-av-editor__locs" data-av-ed-locs>
        <div class="fp-av-editor__label">Luogo di lavoro:</div>
        <div data-av-ed-loclist style="margin-top:10px;"></div>
      </div>
    </div>
    <div class="fp-av-editor__foot">
      <button type="button" class="btn" data-av-ed-cancel>Annulla</button>
      <button type="button" class="fp-av-ok" data-av-ed-ok>OK</button>
    </div>
  `;
  panelBody.appendChild(editor);

  const selKeys = new Set();
  const getCellByKey = (key) => grid.querySelector(`[data-av-cell="${String(key).replaceAll('"', '\\"')}"]`);
  const setCellVisualState = (cellEl, st) => {
    if (!cellEl) return;
    cellEl.classList.remove("work", "off", "on");
    cellEl.removeAttribute("style");
    if (st === "work") {
      cellEl.classList.add("work");
      cellEl.style.background = workBgForTherapist(currentTherapist);
      cellEl.style.outline = `1px solid ${workOutlineForTherapist(currentTherapist)}`;
    }
  };

  const clearSelection = () => {
    selKeys.forEach((k) => {
      const el = getCellByKey(k);
      if (el) el.classList.remove("sel");
    });
    selKeys.clear();
  };

  const setSelected = (cellEl, isSelected) => {
    const key = String(cellEl?.getAttribute("data-av-cell") || "");
    if (!key) return;
    cellEl.classList.toggle("sel", isSelected);
    if (isSelected) selKeys.add(key);
    else selKeys.delete(key);
  };

  const titleEl = editor.querySelector("[data-av-ed-title]");
  const locsWrap = editor.querySelector("[data-av-ed-locs]");
  const locList = editor.querySelector("[data-av-ed-loclist]");
  const statusInputs = Array.from(editor.querySelectorAll("[data-av-ed-status]"));
  const btnX = editor.querySelector("[data-av-ed-x]");
  const btnCancel = editor.querySelector("[data-av-ed-cancel]");
  const btnOk = editor.querySelector("[data-av-ed-ok]");
  const chkAll = editor.querySelector("[data-av-ed-all]");

  let editorStatus = last.status;     // "work" | "off"
  let editorLocId = last.locationId;  // string (optional)
  let editorApplyAll = Boolean(last.applyAll);
  let locations = null;              // loaded lazily
  let locationsLoading = false;

  const renderEditorTitle = () => {
    const n = selKeys.size;
    if (titleEl) titleEl.textContent = `${n} slot selezionat${n === 1 ? "o" : "i"}`;
  };

  const renderLocButtons = () => {
    if (!locList) return;
    locList.innerHTML = "";

    const disabled = editorStatus !== "work";
    const wrapCls = disabled ? "isDisabled" : "";

    if (!locationsLoading && !locations) {
      // fetch once
      locationsLoading = true;
      locList.innerHTML = `<div style="color:rgba(0,0,0,.55); font-weight:800;">Caricamento sedi…</div>`;
      // Requested: availability "Luogo di lavoro" must come from AZIENDA primary field "Sede".
      api("/api/locations?table=AZIENDA&nameField=Sede")
        .then((data) => {
          const items = Array.isArray(data?.items) ? data.items : [];
          locations = items.map((x) => ({ id: String(x.id || x.ID || x.sedeId || ""), name: String(x.name || x.nome || x.label || x.id || "") }))
            .filter((x) => x.id && x.name);
        })
        .catch(() => { locations = []; })
        .finally(() => { locationsLoading = false; renderLocButtons(); });
      return;
    }

    if (locationsLoading) {
      locList.innerHTML = `<div style="color:rgba(0,0,0,.55); font-weight:800;">Caricamento sedi…</div>`;
      return;
    }

    if (!locations || locations.length === 0) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `fp-av-locbtn isDisabled`;
      b.textContent = "Sedi non disponibili";
      locList.appendChild(b);
      return;
    }

    // If no location selected yet, preselect first one (only in work mode).
    if (editorStatus === "work" && !editorLocId) editorLocId = locations[0].id;

    locations.forEach((loc) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `fp-av-locbtn ${wrapCls} ${editorLocId === loc.id ? "isSelected" : ""}`.trim();
      btn.innerHTML = `
        <span>${loc.name}</span>
        <span style="font-weight:900; opacity:${editorLocId === loc.id ? "1" : ".0"};">✓</span>
      `;
      btn.onclick = () => {
        if (editorStatus !== "work") return;
        editorLocId = loc.id;
        renderLocButtons();
      };
      locList.appendChild(btn);
    });
  };

  const syncEditorControls = () => {
    statusInputs.forEach((inp) => {
      inp.checked = String(inp.value) === editorStatus;
    });
    if (chkAll) chkAll.checked = editorApplyAll;
    if (locsWrap) locsWrap.style.display = editorStatus === "work" ? "" : "none";
    renderLocButtons();
  };

  const openEditor = () => {
    renderEditorTitle();
    syncEditorControls();
    editor.style.display = "block";
  };
  const closeEditor = () => {
    editor.style.display = "none";
  };

  btnX && (btnX.onclick = () => { closeEditor(); });
  btnCancel && (btnCancel.onclick = () => { clearSelection(); closeEditor(); });
  statusInputs.forEach((inp) => {
    inp.addEventListener("change", () => {
      editorStatus = String(inp.value) === "off" ? "off" : "work";
      syncEditorControls();
    });
  });
  chkAll && chkAll.addEventListener("change", () => {
    editorApplyAll = Boolean(chkAll.checked);
  });

  btnOk && (btnOk.onclick = () => {
    // Apply to all selected slots
    const applyTo = (therList) => {
      selKeys.forEach((key) => {
        therList.forEach((ther) => {
          if (editorStatus === "off") setSlotRec(ther, key, { status: "off", locationId: "" });
          else setSlotRec(ther, key, { status: "work", locationId: String(editorLocId || "") });
        });
        // update visuals for current therapist only
        setCellVisualState(getCellByKey(key), editorStatus);
      });
    };
    if (editorApplyAll) {
      const ops = Array.isArray(window.__FP_AV_OPERATORS) ? window.__FP_AV_OPERATORS : [];
      const all = ["DEFAULT", ...ops];
      applyTo(all);
    } else {
      applyTo([currentTherapist]);
    }
    // persist last choices for next selection
    last.status = editorStatus;
    last.locationId = String(editorLocId || "");
    last.applyAll = Boolean(editorApplyAll);
    clearSelection();
    closeEditor();
  });

  // --- Selection interactions (drag selects, does not toggle state) ---
  let dragging = false;
  let dragMode = "add"; // "add" | "remove"

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    if (selKeys.size > 0) openEditor();
    else closeEditor();
  };

  // avoid stacking listeners on rebuild
  if (window.__FP_AV_MOUSEUP) {
    try { window.removeEventListener("mouseup", window.__FP_AV_MOUSEUP); } catch {}
  }
  window.__FP_AV_MOUSEUP = onMouseUp;
  window.addEventListener("mouseup", window.__FP_AV_MOUSEUP);

  grid.querySelectorAll("[data-av-cell]").forEach((c) => {
    c.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // plain drag: replace selection; with modifiers, add to existing selection
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (!additive) clearSelection();
      dragging = true;
      dragMode = c.classList.contains("sel") ? "remove" : "add";
      setSelected(c, dragMode === "add");
    });
    c.addEventListener("mouseenter", () => {
      if (!dragging) return;
      setSelected(c, dragMode === "add");
    });
  });

  // Escape closes editor + clears selection
  const onKeyDown = (e) => {
    if (e.key !== "Escape") return;
    clearSelection();
    closeEditor();
  };
  if (window.__FP_AV_KEYDOWN) {
    try { window.removeEventListener("keydown", window.__FP_AV_KEYDOWN); } catch {}
  }
  window.__FP_AV_KEYDOWN = onKeyDown;
  window.addEventListener("keydown", window.__FP_AV_KEYDOWN);

  // If Agenda "colori collaboratori" change, refresh availability UI (if open).
  const onAgendaPrefsChanged = () => {
    try {
      const b = document.querySelector("[data-fp-av-back]");
      if (b && b.style.display === "block") buildAvailabilityUI();
    } catch {}
  };
  if (window.__FP_AV_AGENDA_PREFS) {
    try { window.removeEventListener("fpAgendaPrefsChanged", window.__FP_AV_AGENDA_PREFS); } catch {}
  }
  window.__FP_AV_AGENDA_PREFS = onAgendaPrefsChanged;
  window.addEventListener("fpAgendaPrefsChanged", window.__FP_AV_AGENDA_PREFS);

  // wire modal controls
  const close = back.querySelector("[data-fp-av-close]");
  const reset = back.querySelector("[data-fp-av-reset]");
  const save = back.querySelector("[data-fp-av-save]");

  close && (close.onclick = () => { clearSelection(); closeEditor(); closeAvailabilityModal(); });
  back.onclick = (e) => {
    if (e.target !== back) return;
    clearSelection();
    closeEditor();
    closeAvailabilityModal();
  };
  reset && (reset.onclick = () => {
    localStorage.removeItem(stateKey);
    try { window.dispatchEvent(new CustomEvent("fpAvailabilityChanged")); } catch {}
    buildAvailabilityUI();
  });
  save && (save.onclick = () => {
    const nextRanges = Array.isArray(ranges) ? ranges : [];
    try {
      localStorage.setItem(stateKey, JSON.stringify({ ranges: nextRanges, byTherapist: slotsByTherapist, last, lastTherapist: currentTherapist }));
    } catch {}
    clearSelection();
    closeEditor();
    closeAvailabilityModal();
    toast("Salvato");
    try { window.dispatchEvent(new CustomEvent("fpAvailabilityChanged")); } catch {}
  });

  // Fill collaborator selector once operators load (async)
  (async () => {
    const sel = top?.querySelector?.("[data-av-ther]");
    if (!sel) return;
    sel.value = currentTherapist;
    const ops = await ensureOperators();
    // rebuild options (keep current selection)
    const cur = String(sel.value || currentTherapist || "DEFAULT");
    sel.innerHTML = `<option value="DEFAULT">Tutti (default)</option>` + ops.map((n) => `<option value="${String(n).replaceAll('"', "&quot;")}">${String(n).replaceAll("<", "&lt;")}</option>`).join("");
    sel.value = cur;
    currentTherapist = String(sel.value || "DEFAULT");
    window.__FP_AV_LAST_THER = currentTherapist;
    // refresh cell classes for current therapist
    grid.querySelectorAll("[data-av-cell]").forEach((c) => {
      const key = String(c.getAttribute("data-av-cell") || "");
      const st = getSlotRec(currentTherapist, key)?.status || "";
      setCellVisualState(c, st === "work" ? "work" : "");
    });
    sel.onchange = () => {
      currentTherapist = String(sel.value || "DEFAULT");
      window.__FP_AV_LAST_THER = currentTherapist;
      clearSelection();
      closeEditor();
      grid.querySelectorAll("[data-av-cell]").forEach((c) => {
        const key = String(c.getAttribute("data-av-cell") || "");
        const st = getSlotRec(currentTherapist, key)?.status || "";
        setCellVisualState(c, st === "work" ? "work" : "");
      });
    };
  })();
}

function loadAppointmentsSettings() {
  const key = fpSettingsKey("appointments");
  let s = null;
  try { s = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
  const obj = s && typeof s === "object" ? s : {};

  const back = document.querySelector("[data-fp-appt-back]");
  if (!back) return;
  const panel = back.querySelector(".fp-set-panel");
  if (!panel) return;

  const days = panel.querySelector("[data-fp-appt-days]");
  const cancelband = panel.querySelector("[data-fp-appt-cancelband]");
  const drag = panel.querySelector("[data-fp-appt-drag]");
  const billing = panel.querySelector("[data-fp-appt-billing]");
  const showname = panel.querySelector("[data-fp-appt-showname]");
  const name = panel.querySelector("[data-fp-appt-name]");
  const info = panel.querySelector("[data-fp-appt-info]");
  const nameCount = panel.querySelector("[data-fp-appt-name-count]");
  const infoCount = panel.querySelector("[data-fp-appt-info-count]");

  if (days) days.value = String(obj.days ?? 7);
  if (cancelband) cancelband.checked = Boolean(obj.cancelband ?? true);
  if (drag) drag.checked = Boolean(obj.drag ?? true);
  if (billing) billing.checked = Boolean(obj.billing ?? true);
  if (showname) showname.checked = Boolean(obj.showname ?? false);
  if (name) name.value = String(obj.name ?? "");
  if (info) info.value = String(obj.info ?? "");

  const syncCounts = () => {
    if (nameCount) nameCount.textContent = `${String(name?.value || "").length} / 150`;
    if (infoCount) infoCount.textContent = `${String(info?.value || "").length} / 150`;
  };
  name?.addEventListener("input", syncCounts);
  info?.addEventListener("input", syncCounts);
  syncCounts();

  const close = panel.querySelector("[data-fp-appt-close]");
  const reset = panel.querySelector("[data-fp-appt-reset]");
  const save = panel.querySelector("[data-fp-appt-save]");
  close && (close.onclick = closeAppointmentsModal);
  back.onclick = (e) => { if (e.target === back) closeAppointmentsModal(); };
  reset && (reset.onclick = () => {
    localStorage.removeItem(key);
    loadAppointmentsSettings();
    try { window.dispatchEvent(new CustomEvent("fpAppointmentsSettingsChanged")); } catch {}
  });
  save && (save.onclick = () => {
    const next = {
      days: Number(days?.value || 0),
      cancelband: Boolean(cancelband?.checked),
      drag: Boolean(drag?.checked),
      billing: Boolean(billing?.checked),
      showname: Boolean(showname?.checked),
      name: String(name?.value || "").trim(),
      info: String(info?.value || "").trim(),
    };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
    closeAppointmentsModal();
    toast("Salvato");
    try { window.dispatchEvent(new CustomEvent("fpAppointmentsSettingsChanged")); } catch {}
  });
}

function isAgendaNow() {
  return Boolean(document.querySelector("[data-diary]")) || (location.pathname || "").endsWith("/pages/agenda.html");
}

function normalizeRightbar() {
  const rb = document.querySelector(".app > .rightbar");
  if (!rb) return;

  const isAgenda = isAgendaNow();

  rb.className = "rightbar fp-rbar";
  rb.innerHTML = `
    <button class="rbBtn" ${isAgenda ? 'data-open-prefs' : ""} title="Impostazioni Agenda">
      <span class="rbIcon">⚙️</span>
      <span class="rbLabel">Impostazioni Agenda</span>
    </button>
    <button class="rbBtn" data-open-availability title="Impostazioni Disponibilità">
      <span class="rbIcon">🕒</span>
      <span class="rbLabel">Impostazioni Disponibilità</span>
    </button>
    <button class="rbBtn" data-open-appointments title="Impostazioni Appuntamenti">
      <span class="rbIcon">✅</span>
      <span class="rbLabel">Impostazioni Appuntamenti</span>
    </button>
    <button class="rbBtn" data-open-theme title="Tema">
      <span class="rbIcon">🎨</span>
      <span class="rbLabel">Tema</span>
    </button>
  `;
}

async function swapCenterTo(url, opts = {}) {
  const replace = Boolean(opts.replace);
  const u = url instanceof URL ? url : new URL(String(url), location.href);

  // Only swap if we are in the layout shell.
  if (!isSpaShell()) {
    if (replace) location.replace(u.toString());
    else location.href = u.toString();
    return;
  }

  // Avoid parallel navigations.
  if (window.__FP_SPA_INFLIGHT) return;
  window.__FP_SPA_INFLIGHT = true;

  try {
    const html = await loadHtml(u);
    const { title, main, rightbar, inlineStyles, hasDiary, hasPatientPage, overlays } = extractPageParts(html);

    // Apply route-specific styles (from <head><style>…</style>).
    applyRouteStyles(inlineStyles);

    const curMain = document.querySelector(".app > .main");
    const curRight = document.querySelector(".app > .rightbar");
    const curApp = document.querySelector(".app");
    if (!curMain || !curRight) throw new Error("spa_shell_missing");

    // Sync per-page flags that scripts rely on.
    if (curApp) {
      if (hasDiary) curApp.setAttribute("data-diary", "");
      else curApp.removeAttribute("data-diary");
    }
    if (hasPatientPage) curMain.setAttribute("data-patient-page", "");
    else curMain.removeAttribute("data-patient-page");

    // Swap non-menu overlays (modals, backdrops, etc.)
    ensureOverlayHost().innerHTML = String(overlays || "");

    if (main) curMain.innerHTML = main.innerHTML;
    else curMain.innerHTML = `<section class="card"><div class="body">Pagina non supportata.</div></section>`;

    if (rightbar) {
      curRight.className = rightbar.className;
      curRight.innerHTML = rightbar.innerHTML;
    } else {
      curRight.className = "rightbar";
      curRight.innerHTML = "";
    }

    if (title) document.title = title;

    if (replace) history.replaceState({ fpSpa: 1 }, "", u.pathname + u.search);
    else history.pushState({ fpSpa: 1 }, "", u.pathname + u.search);

    await runRouteInits();
  } finally {
    window.__FP_SPA_INFLIGHT = false;
  }
}

function setupSpaRouter() {
  if (window.__FP_SPA_ROUTER_READY) return;
  window.__FP_SPA_ROUTER_READY = true;

  bootstrapRouteStyleControl();
  bootstrapOverlayControl();

  // Public helper for code that wants SPA navigation.
  window.fpNavigate = (href, opts = {}) => {
    const u = new URL(String(href), location.href);
    if (!shouldSpaHandleUrl(u)) {
      location.href = u.toString();
      return;
    }
    swapCenterTo(u, opts).catch(() => (location.href = u.toString()));
  };

  try { history.replaceState({ fpSpa: 1 }, "", location.pathname + location.search); } catch {}

  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const a = e.target?.closest?.("a[href]");
      if (a) {
        const href = a.getAttribute("href") || "";
        if (!href || href.startsWith("#")) return;
        const u = new URL(href, location.href);
        if (!shouldSpaHandleUrl(u)) return;
        e.preventDefault();
        swapCenterTo(u).catch(() => (location.href = u.toString()));
        return;
      }

      const openRight = e.target?.closest?.("[data-open-right-detail]");
      if (openRight) {
        e.preventDefault();
        document.body.classList.toggle("fp-right-expanded");
        return;
      }

      const openAvail = e.target?.closest?.("[data-open-availability]");
      if (openAvail) {
        e.preventDefault();
        openAvailabilityModal();
        return;
      }

      const openAppt = e.target?.closest?.("[data-open-appointments]");
      if (openAppt) {
        e.preventDefault();
        openAppointmentsModal();
        return;
      }

      const openTheme = e.target?.closest?.("[data-open-theme]");
      if (openTheme) {
        e.preventDefault();
        openThemeModal();
        return;
      }

      const btn = e.target?.closest?.("button[onclick]");
      if (btn) {
        const href = parseOnclickLocationHref(btn.getAttribute("onclick"));
        if (!href) return;
        const u = new URL(href, location.href);
        if (!shouldSpaHandleUrl(u)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        swapCenterTo(u).catch(() => (location.href = u.toString()));
      }
    },
    true,
  );

  window.addEventListener("popstate", () => {
    if (!shouldSpaHandleUrl(location.href)) return;
    swapCenterTo(location.href, { replace: true }).catch(() => (location.href = location.href));
  });
}

// =====================
// PAZIENTE (Scheda paziente) - within shell
// =====================
function isPatientPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/paziente.html") || p.endsWith("/paziente.html");
}

function fmtItDateTime(iso) {
  const s = normStr(iso);
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  try {
    return d.toLocaleString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s;
  }
}

async function initPatientPage() {
  if (!isPatientPage()) return;
  const root = document.querySelector("[data-patient-page]");
  if (!root) return;
  if (root.dataset.fpInited === "1") return;
  root.dataset.fpInited = "1";

  const url = new URL(location.href);
  const id = url.searchParams.get("id");

  const statusEl = document.querySelector("[data-patient-status]");
  const errEl = document.querySelector("[data-patient-error]");
  const rowsEl = document.querySelector("[data-patient-appt-rows]");

  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.style.display = "block";
    statusEl.textContent = msg;
  };
  const setError = (msg) => {
    if (!errEl) return;
    errEl.style.display = "block";
    errEl.textContent = msg;
  };

  const backBtn = document.querySelector("[data-patient-back]");
  if (backBtn) {
    backBtn.onclick = () => {
      if (history.length > 1) history.back();
      else if (typeof window.fpNavigate === "function") window.fpNavigate("/pages/anagrafica.html");
      else location.href = "/pages/anagrafica.html";
    };
  }

  if (!id) {
    setError("Manca id paziente nell’URL.");
    if (statusEl) statusEl.style.display = "none";
    return;
  }

  try {
    setStatus("Caricamento…");

    const p = await api("/api/patient?id=" + encodeURIComponent(id));
    const fullName = [p.Nome, p.Cognome].filter(Boolean).join(" ").trim();
    const titleEl = document.querySelector("[data-patient-title]");
    if (titleEl) titleEl.textContent = fullName ? ("Scheda: " + fullName) : "Scheda paziente";

    const setText = (sel, val) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = normStr(val) || "—";
    };
    setText("[data-patient-nome]", p.Nome);
    setText("[data-patient-cognome]", p.Cognome);
    setText("[data-patient-tel]", p.Telefono || p["Telefono"]);
    setText("[data-patient-email]", p.Email || p["Email"]);
    setText("[data-patient-dob]", p["Data di nascita"]);
    setText("[data-patient-note]", p.Note);

    setStatus("Carico storico appuntamenti…");
    const a = await api("/api/patient-appointments?id=" + encodeURIComponent(id));
    const recs = a.records || [];

    if (rowsEl) {
      rowsEl.innerHTML = "";
      if (!recs.length) {
        rowsEl.innerHTML = `<tr><td colspan="4" class="muted">Nessun appuntamento trovato.</td></tr>`;
      } else {
        for (const r of recs) {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${fmtItDateTime(r["Data e ora INIZIO"])}</td>
            <td>${fmtItDateTime(r["Data e ora FINE"])}</td>
            <td>${normStr(r.Durata) || "—"}</td>
            <td>${normStr(r.Email) || "—"}</td>
          `;
          rowsEl.appendChild(tr);
        }
      }
    }

    if (statusEl) {
      statusEl.textContent = "OK";
      setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 600);
    }
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.style.display = "none";
    setError(e.message || "Errore");
  }
}

function buildTimeUI(timeCol, linesEl, startMin, endMin, slotMin, slotPx) {
  timeCol.innerHTML = "";
  linesEl.innerHTML = "";

  const totalSlots = Math.ceil((endMin - startMin) / slotMin);
  const heightPx = totalSlots * slotPx;

  timeCol.style.height = heightPx + "px";
  linesEl.style.height = heightPx + "px";

  // labels ogni ora
  for (let m = startMin; m <= endMin; m += 60) {
    const hh = pad2(Math.floor(m/60));
    const mm = pad2(m%60);
    const label = document.createElement("div");
    label.className = "oe-time";
    label.style.top = ((m - startMin) / slotMin) * slotPx + "px";
    label.textContent = `${hh}:${mm}`;
    timeCol.appendChild(label);
  }

  // linee slot
  for (let i = 0; i <= totalSlots; i++) {
    const y = i * slotPx;
    const line = document.createElement("div");
    line.className = "oe-line";
    line.style.top = y + "px";
    linesEl.appendChild(line);
  }

  return heightPx;
}

function clearCols() {
  document.querySelectorAll("[data-day-col]").forEach(col => col.innerHTML = "");
}

function renderWeek(appointments, weekStart, hoverCard, modal, setAppointments) {
  const startMin = 8*60;
  const endMin = 20*60;
  const slotMin = 15;
  const slotPx = 18;

  const timeCol = document.querySelector("[data-time-col]");
  const linesEl = document.querySelector("[data-time-lines]");
  const grid = document.querySelector(".oe-cal__grid");
  if (!timeCol || !linesEl || !grid) return;

  const heightPx = buildTimeUI(timeCol, linesEl, startMin, endMin, slotMin, slotPx);

  // altezza colonne
  document.querySelectorAll("[data-day-col]").forEach(col => {
    col.style.height = heightPx + "px";
  });

  clearCols();

  appointments.forEach(appt => {
    if (!appt.start_at) return;
    const dt = new Date(appt.start_at);
    if (isNaN(dt.getTime())) return;

    const day0 = new Date(weekStart);
    const dayIndex = Math.floor((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() - day0.getTime()) / 86400000);
    if (dayIndex < 0 || dayIndex > 6) return;

    const st = minutesOfDay(new Date(appt.start_at));
    let durMin = 60;

    if (appt.end_at) {
      const endDT = new Date(appt.end_at);
      if (!isNaN(endDT.getTime())) durMin = Math.max(15, minutesOfDay(endDT) - st);
    } else if (appt.duration_label) {
      const s = String(appt.duration_label).toLowerCase();
      const n = parseInt(s.replace(/[^\d]/g,""), 10);
      if (!isNaN(n) && n > 0) durMin = s.includes("ora") ? n*60 : n;
    }

    const top = ((clamp(st, startMin, endMin) - startMin) / slotMin) * slotPx;
    const endM = clamp(st + durMin, startMin, endMin);
    const height = Math.max(slotPx*2, ((endM - clamp(st, startMin, endMin)) / slotMin) * slotPx);

    const col = document.querySelector(`[data-day-col="${dayIndex}"]`);
    if (!col) return;

    const ev = document.createElement("div");
    ev.className = "oe-event";
    ev.style.top = top + "px";
    ev.style.height = height + "px";

    ev.innerHTML = `
      <div class="oe-event__title">${(appt.patient_name || "")}</div>
      <div class="oe-event__meta">${fmtTime(appt.start_at)}${appt.service_name ? " • " + appt.service_name : ""}${appt.therapist_name ? " • " + appt.therapist_name : ""}</div>
    `;

    ev.addEventListener("mousemove", (e) => {
      if (modal.style.display !== "none") return;
      showHoverCard(hoverCard, appt, e.clientX, e.clientY);
    });
    ev.addEventListener("mouseleave", () => hideHoverCard(hoverCard));
    ev.addEventListener("click", (e) => {
      e.preventDefault();
      hideHoverCard(hoverCard);
      openModal(modal, appt, (updated) => {
        const next = updated && updated.__deleted
          ? appointments.filter(x => x.id !== updated.id)
          : appointments.map(x => x.id === updated.id ? updated : x);
        setAppointments(next);
        renderWeek(next, weekStart, hoverCard, modal, setAppointments);
      });
    });

    col.appendChild(ev);
  });
}

async function initAgenda() {
  if (!isAgendaPage()) return;

  initSidebars();

  const mount = document.querySelector("[data-agenda-mount]");
  if (!mount) return;

  const url = new URL(location.href);
  const qDate = url.searchParams.get("date");
  const base = parseISODate(qDate) || new Date();
  const weekStart = startOfWeekMonday(base);

  // header giorni
  for (let i=0;i<7;i++){
    const d = addDays(weekStart, i);
    const el = document.querySelector(`[data-day-head="${i}"]`);
    if (el) el.textContent = fmtDay(d);
  }

  const monthLabel = document.querySelector("[data-month-label]");
  if (monthLabel) monthLabel.textContent = fmtMonth(weekStart);

  const weekLabel = document.querySelector("[data-week-label]");
  if (weekLabel) {
    const end = addDays(weekStart, 6);
    weekLabel.textContent = `${weekStart.getDate()}/${weekStart.getMonth()+1} - ${end.getDate()}/${end.getMonth()+1}`;
  }

  // nav week
  const btnToday = document.querySelector("[data-agenda-today]");
  const btnPrev = document.querySelector("[data-agenda-prev]");
  const btnNext = document.querySelector("[data-agenda-next]");

  if (btnToday) btnToday.onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set("date", toISODate(new Date()));
    if (typeof window.fpNavigate === "function") window.fpNavigate(u.toString(), { replace: true });
    else location.href = u.toString();
  };
  if (btnPrev) btnPrev.onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set("date", toISODate(addDays(weekStart, -7)));
    if (typeof window.fpNavigate === "function") window.fpNavigate(u.toString(), { replace: true });
    else location.href = u.toString();
  };
  if (btnNext) btnNext.onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set("date", toISODate(addDays(weekStart, 7)));
    if (typeof window.fpNavigate === "function") window.fpNavigate(u.toString(), { replace: true });
    else location.href = u.toString();
  };

  const hoverCard = buildHoverCard();
  const modal = buildModal();

  const startISO = new Date(weekStart); startISO.setHours(0,0,0,0);
  const endISO = new Date(addDays(weekStart, 7)); endISO.setHours(0,0,0,0);

  let appointments = [];
  try {
    const data = await api(`/api/appointments?start=${encodeURIComponent(startISO.toISOString())}&end=${encodeURIComponent(endISO.toISOString())}`);
    appointments = data.appointments || [];
  } catch (e) {
    console.error(e);
    alert("Errore caricamento appuntamenti: controlla /api/appointments");
    return;
  }

  const setAppointments = (arr) => { appointments = arr; };
  renderWeek(appointments, weekStart, hoverCard, modal, setAppointments);
}

// =====================
// BOOT
// =====================
(async function boot() {
  const user = await ensureAuth();
  if (!user) return;

  // SPA router: keep left/right menus mounted, swap only center content.
  setupSpaRouter();

  // Apply theme ASAP after auth (per-user).
  try { applyTheme(loadTheme()); } catch {}

  initLogoutLinks();
  // Non-blocking: load logo from Airtable if configured.
  initBrandLogo();
  setUserBadges(user);
  roleGuard(user.role);
  activeNav();
  await runRouteInits();
})();
