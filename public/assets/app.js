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

function setUserBadges(user) {
  const label = user
    ? [user.nome || "", user.roleLabel || user.role || ""].filter(Boolean).join(" • ")
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
    tr.onclick = () => location.href = `paziente.html?id=${encodeURIComponent(p.id)}`;

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
  card.querySelector("[data-hc-title]").textContent = appt.patient_name || "Paziente";
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
        <div class="oe-modal__patientline">
          <div class="oe-modal__patientname" data-pname>Paziente</div>
          <a class="oe-modal__patientlink" data-plink href="#">Apri scheda paziente</a>
        </div>

        <div class="oe-grid">
          <label class="oe-field"><span>Stato</span><input data-f-status /></label>
          <label class="oe-field"><span>Prestazione</span><input data-f-service /></label>
          <label class="oe-field"><span>Durata</span><input data-f-duration /></label>
          <label class="oe-field"><span>Operatore</span><input data-f-ther /></label>
          <label class="oe-field oe-field--wide"><span>Nota rapida (interna)</span><textarea data-f-internal maxlength="255"></textarea></label>
          <label class="oe-field oe-field--wide"><span>Note</span><textarea data-f-patient maxlength="255"></textarea></label>
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

function openModal(modal, appt, onSaved) {
  modal.__current = appt;

  modal.querySelector("[data-pname]").textContent = appt.patient_name || "Paziente";
  modal.querySelector("[data-plink]").href = `/pages/paziente.html?id=${encodeURIComponent(appt.patient_id || "")}`;

  modal.querySelector("[data-f-status]").value = appt.status || "";
  modal.querySelector("[data-f-service]").value = appt.service_name || "";
  modal.querySelector("[data-f-duration]").value = appt.duration_label || "";
  modal.querySelector("[data-f-ther]").value = appt.therapist_name || "";
  modal.querySelector("[data-f-internal]").value = appt.internal_note || "";
  modal.querySelector("[data-f-patient]").value = appt.patient_note || "";

  const close = () => { modal.style.display = "none"; };
  modal.querySelector("[data-close]").onclick = close;
  modal.querySelector("[data-cancel]").onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };

  modal.querySelector("[data-save]").onclick = async () => {
    const a = modal.__current;
    if (!a) return;

    const payload = {
      status: modal.querySelector("[data-f-status]").value,
      service_name: modal.querySelector("[data-f-service]").value,
      duration_label: modal.querySelector("[data-f-duration]").value,
      therapist_name: modal.querySelector("[data-f-ther]").value,
      internal_note: modal.querySelector("[data-f-internal]").value,
      patient_note: modal.querySelector("[data-f-patient]").value,
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
      if (typeof onSaved === "function") onSaved(updated);
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
  if (rightBtn) rightBtn.onclick = () => document.body.classList.toggle("oe-hide-right");
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
      <div class="oe-event__title">${(appt.patient_name || "Paziente")}</div>
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
        const next = appointments.map(x => x.id === updated.id ? updated : x);
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
    location.href = u.toString();
  };
  if (btnPrev) btnPrev.onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set("date", toISODate(addDays(weekStart, -7)));
    location.href = u.toString();
  };
  if (btnNext) btnNext.onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set("date", toISODate(addDays(weekStart, 7)));
    location.href = u.toString();
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

  initLogoutLinks();
  setUserBadges(user);
  roleGuard(user.role);
  activeNav();
  await initAnagrafica();
  await initAgenda();
})();
