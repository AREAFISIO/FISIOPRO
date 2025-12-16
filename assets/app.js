// =====================
// AUTH + ROLE GUARDS
// =====================
function getToken() {
  return localStorage.getItem("token") || "";
}
function getCachedUser() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

async function api(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function ensureAuth() {
  const isLoginPage = location.pathname.endsWith("/pages/login.html");
  const token = getToken();
  if (!token) {
    if (!isLoginPage) location.href = "/pages/login.html";
    return null;
  }
  try {
    const { user } = await api("/api/auth-me");
    localStorage.setItem("user", JSON.stringify(user));
    return user;
  } catch (e) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (!isLoginPage) location.href = "/pages/login.html";
    return null;
  }
}

function roleGuard(role) {
  document.querySelectorAll("[data-role]").forEach(el => {
    const allowed = (el.getAttribute("data-role") || "")
      .split(",").map(s => s.trim()).filter(Boolean);
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

// =====================
// TABS
// =====================
function initTabs() {
  const tabs = document.querySelectorAll("[data-tabbtn]");
  if (!tabs.length) return;

  const show = (key) => {
    document.querySelectorAll("[data-tabpanel]").forEach(p => {
      p.style.display = (p.getAttribute("data-tabpanel") === key) ? "" : "none";
    });
    tabs.forEach(t => t.classList.toggle("active", t.getAttribute("data-tabbtn") === key));
  };

  const firstVisible = Array.from(tabs).find(t => t.style.display !== "none");
  if (firstVisible) show(firstVisible.getAttribute("data-tabbtn"));

  tabs.forEach(t => t.addEventListener("click", () => {
    if (t.style.display === "none") return;
    show(t.getAttribute("data-tabbtn"));
  }));
}

// =====================
// SEARCH FILTER TABLE
// =====================
function initSearch() {
  const input = document.querySelector("[data-search]");
  const table = document.querySelector("[data-table]");
  if (!input || !table) return;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    table.querySelectorAll("tbody tr").forEach(tr => {
      const text = tr.innerText.toLowerCase();
      tr.style.display = text.includes(q) ? "" : "none";
    });
  });
}

// =====================
// CASES LIST RENDER (se presente)
// =====================
function renderCasesLocalDemo() {
  const el = document.querySelector("[data-cases-tbody]");
  if (!el) return;

  const cases = JSON.parse(localStorage.getItem("cases") || "[]");
  const patients = JSON.parse(localStorage.getItem("patients") || "[]");
  const pmap = Object.fromEntries(patients.map(p => [p.id, p]));

  el.innerHTML = cases
    .sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0))
    .map(c=>{
      const p = pmap[c.patientId] || {nome:"—", cognome:"—"};
      const d = new Date(c.updatedAt || Date.now()).toLocaleString("it-IT");
      return `
        <tr style="cursor:pointer" onclick="location.href='caso-nuovo.html?id=${encodeURIComponent(c.id)}'">
          <td><div class="rowlink">${c.id}</div><div class="subcell">${d}</div></td>
          <td>${p.nome} ${p.cognome}</td>
          <td>${c.titolo || ""}</td>
          <td><span class="chip">${c.stato || "Bozza"}</span></td>
          <td>${c.note ? c.note.slice(0,60) : ""}</td>
        </tr>
      `;
    }).join("");
}

// =====================
// AGENDA (vero calendario: hover + modal)
// =====================
function isAgendaPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/agenda.html") || p.endsWith("/agenda.html");
}

function pad2(n){ return String(n).padStart(2,"0"); }

function toISODate(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function parseISODate(s){
  // s: YYYY-MM-DD
  const [y,m,d] = (s||"").split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m-1, d, 0, 0, 0, 0);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

function startOfWeekMonday(d){
  const x = new Date(d);
  const day = x.getDay(); // 0=dom
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  x.setHours(0,0,0,0);
  return x;
}

function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtTime(iso){
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("it-IT", { hour:"2-digit", minute:"2-digit" });
  } catch { return ""; }
}

function fmtDayLabel(d){
  const giorni = ["DOM","LUN","MAR","MER","GIO","VEN","SAB"];
  return `${giorni[d.getDay()]} ${d.getDate()}`;
}

function fmtMonthLabel(d){
  try {
    return d.toLocaleDateString("it-IT", { month:"long", year:"numeric" });
  } catch {
    return "Agenda";
  }
}

// ---- Hover Card DOM
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

  if (appt.status) {
    statusRow.style.display = "";
    card.querySelector("[data-hc-status]").textContent = appt.status;
  } else statusRow.style.display = "none";

  if (appt.service_name) {
    serviceRow.style.display = "";
    card.querySelector("[data-hc-service]").textContent = appt.service_name;
  } else serviceRow.style.display = "none";

  if (appt.therapist_name) {
    therRow.style.display = "";
    card.querySelector("[data-hc-ther]").textContent = appt.therapist_name;
  } else therRow.style.display = "none";

  if (appt.internal_note) {
    noteEl.style.display = "";
    noteEl.textContent = appt.internal_note;
  } else noteEl.style.display = "none";

  card.style.display = "block";
}
function hideHoverCard(card){ card.style.display = "none"; }

// ---- Modal DOM
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
          <label class="oe-field">
            <span>Stato</span>
            <input data-f-status placeholder="Es. Non ancora eseguito"/>
          </label>

          <label class="oe-field">
            <span>Prestazione</span>
            <input data-f-service placeholder="Es. FASDAC"/>
          </label>

          <label class="oe-field">
            <span>Durata</span>
            <input data-f-duration placeholder="Es. 1 ora"/>
          </label>

          <label class="oe-field">
            <span>Operatore</span>
            <input data-f-ther placeholder="Es. Andrea Franceschelli"/>
          </label>

          <label class="oe-field oe-field--wide">
            <span>Nota rapida (interna)</span>
            <textarea data-f-internal maxlength="255"></textarea>
          </label>

          <label class="oe-field oe-field--wide">
            <span>Note</span>
            <textarea data-f-patient maxlength="255"></textarea>
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

function openModal(modal, appt, onSaved) {
  modal.__current = appt;

  modal.querySelector("[data-pname]").textContent = appt.patient_name || "Paziente";
  const link = modal.querySelector("[data-plink]");
  const pid = appt.patient_id || "";
  link.href = `/pages/paziente.html?id=${encodeURIComponent(pid)}`;

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

// ---- Render calendario (8:00 - 20:00)
function minutesOfDay(d){
  return d.getHours()*60 + d.getMinutes();
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function buildTimeCol(timeColEl, startMin, endMin, stepMin){
  timeColEl.innerHTML = "";
  for (let m = startMin; m <= endMin; m += 120) {
    const hh = pad2(Math.floor(m/60));
    const mm = pad2(m%60);
    const div = document.createElement("div");
    div.textContent = `${hh}:${mm}`;
    timeColEl.appendChild(div);
  }
}

function clearDayCols(){
  document.querySelectorAll("[data-day-col]").forEach(col => col.innerHTML = "");
}

function renderAppointmentsInWeek(appointments, weekStart, hoverCard, modal, setAppointments){
  const startMin = 8*60;
  const endMin = 20*60;
  const range = endMin - startMin;

  clearDayCols();

  // piccolo aiuto: raggruppo per giorno
  appointments.forEach(appt => {
    if (!appt.start_at) return;
    const dt = new Date(appt.start_at);
    if (isNaN(dt.getTime())) return;

    // index giorno (0..6) rispetto al lunedì
    const dayIndex = Math.floor((dt.setHours(0,0,0,0) - weekStart.getTime()) / (24*60*60*1000));
    if (dayIndex < 0 || dayIndex > 6) return;

    const startDT = new Date(appt.start_at);
    const st = minutesOfDay(startDT);

    // Durata: se non abbiamo end_at, usiamo duration_label (es "1 ora" oppure "60")
    let durMin = 60;
    if (appt.end_at) {
      const endDT = new Date(appt.end_at);
      if (!isNaN(endDT.getTime())) durMin = Math.max(15, minutesOfDay(endDT) - st);
    } else if (appt.duration_label) {
      const s = String(appt.duration_label).toLowerCase();
      const n = parseInt(s.replace(/[^\d]/g,""), 10);
      if (!isNaN(n) && n > 0) {
        if (s.includes("ora")) durMin = n * 60;
        else durMin = n; // minuti
      }
    }

    // posizionamento in colonna (top/height in percent)
    const topPct = ((clamp(st, startMin, endMin) - startMin) / range) * 100;
    const endMinAppt = clamp(st + durMin, startMin, endMin);
    const heightPct = Math.max(3, ((endMinAppt - clamp(st, startMin, endMin)) / range) * 100);

    const col = document.querySelector(`[data-day-col="${dayIndex}"]`);
    if (!col) return;

    const block = document.createElement("div");
    block.className = "chip";
    block.style.position = "absolute";
    block.style.left = "10px";
    block.style.right = "10px";
    block.style.top = `calc(${topPct}% + 6px)`;
    block.style.height = `calc(${heightPct}% - 6px)`;
    block.style.display = "flex";
    block.style.flexDirection = "column";
    block.style.alignItems = "flex-start";
    block.style.justifyContent = "center";
    block.style.gap = "6px";
    block.style.cursor = "pointer";
    block.style.padding = "10px";

    // testo stile “OsteoEasy”: nome + ora + prestazione
    const t1 = document.createElement("div");
    t1.style.fontWeight = "800";
    t1.style.whiteSpace = "nowrap";
    t1.style.overflow = "hidden";
    t1.style.textOverflow = "ellipsis";
    t1.textContent = appt.patient_name || "Paziente";

    const t2 = document.createElement("div");
    t2.style.opacity = ".85";
    t2.style.fontSize = "12px";
    t2.textContent = `${fmtTime(appt.start_at)}${appt.service_name ? " • " + appt.service_name : ""}${appt.therapist_name ? " • " + appt.therapist_name : ""}`;

    block.appendChild(t1);
    block.appendChild(t2);

    // Hover
    block.addEventListener("mousemove", (e) => {
      if (modal.style.display !== "none") return;
      showHoverCard(hoverCard, appt, e.clientX, e.clientY);
    });
    block.addEventListener("mouseleave", () => hideHoverCard(hoverCard));

    // Click -> modal
    block.addEventListener("click", (e) => {
      e.preventDefault();
      hideHoverCard(hoverCard);
      openModal(modal, appt, (updated) => {
        // aggiorno lista in memoria e re-render
        const next = appointments.map(x => x.id === updated.id ? updated : x);
        setAppointments(next);
        renderAppointmentsInWeek(next, weekStart, hoverCard, modal, setAppointments);
      });
    });

    col.appendChild(block);
  });
}

async function initAgenda() {
  if (!isAgendaPage()) return;

  const mount = document.querySelector("[data-agenda-mount]");
  const timeCol = document.querySelector("[data-time-col]");
  if (!mount || !timeCol) return;

  // settimana corrente da URL (?date=YYYY-MM-DD) o oggi
  const url = new URL(location.href);
  const qDate = url.searchParams.get("date");
  const base = parseISODate(qDate) || new Date();
  const weekStart = startOfWeekMonday(base);

  // header giorni
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const head = document.querySelector(`[data-day-head="${i}"]`);
    if (head) head.textContent = fmtDayLabel(d);
  }

  const monthLabel = document.querySelector("[data-month-label]");
  if (monthLabel) monthLabel.textContent = fmtMonthLabel(weekStart);

  const weekLabel = document.querySelector("[data-week-label]");
  if (weekLabel) {
    const end = addDays(weekStart, 6);
    weekLabel.textContent = `${weekStart.getDate()}/${weekStart.getMonth()+1} - ${end.getDate()}/${end.getMonth()+1}`;
  }

  // bottoni navigazione
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

  // colonna ore
  buildTimeCol(timeCol, 8*60, 20*60, 30);

  // hover + modal globali
  const hoverCard = buildHoverCard();
  const modal = buildModal();

  // Carico appuntamenti (filtrati settimana)
  // Passo start/end all'API se la tua GET li gestisce, altrimenti li ignora e torna tutto.
  const startISO = new Date(weekStart);
  startISO.setHours(0,0,0,0);
  const endISO = new Date(addDays(weekStart, 7));
  endISO.setHours(0,0,0,0);

  let appointments = [];
  try {
    const data = await api(`/api/appointments?start=${encodeURIComponent(startISO.toISOString())}&end=${encodeURIComponent(endISO.toISOString())}`);
    appointments = data.appointments || [];
  } catch (e) {
    console.error(e);
    alert("Errore caricamento appuntamenti. Controlla /api/appointments");
    return;
  }

  const setAppointments = (arr) => { appointments = arr; };

  renderAppointmentsInWeek(appointments, weekStart, hoverCard, modal, setAppointments);
}

// =====================
// BOOT
// =====================
(async function boot() {
  const user = await ensureAuth();
  if (!user) return;

  const badge = document.querySelector("[data-user-badge]");
  if (badge) badge.textContent = `${user.name} • ${user.role}`;

  roleGuard(user.role);
  activeNav();
  initTabs();
  initSearch();
  renderCasesLocalDemo();
  await initAgenda();
})();
