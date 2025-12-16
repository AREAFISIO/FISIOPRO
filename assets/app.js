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
  // Nasconde elementi non autorizzati: data-role="front,manager"
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
// AGENDA (Hover + Modal stile OsteoEasy)
// =====================
function isAgendaPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/agenda.html") || p.endsWith("/agenda.html");
}

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

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
  if (!card) return;
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

function hideHoverCard(card) {
  if (!card) return;
  card.style.display = "none";
}

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

function openModal(modal, appt, onSave) {
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

  modal.style.display = "flex";

  const close = () => { modal.style.display = "none"; };

  modal.querySelector("[data-close]").onclick = close;
  modal.querySelector("[data-cancel]").onclick = close;

  modal.onclick = (e) => {
    if (e.target === modal) close();
  };

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
      modal.querySelector("[data-save]").disabled = true;
      const updated = await api(`/api/appointments?id=${encodeURIComponent(a.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      toast("Salvato");
      close();
      if (typeof onSave === "function") onSave(updated);
    } catch (err) {
      console.error(err);
      alert("Errore salvataggio su Airtable. Controlla Console/Network.");
    } finally {
      modal.querySelector("[data-save]").disabled = false;
    }
  };
}

function renderAgendaUI(appointments) {
  // Provo a trovare un “punto” dove inserire la lista senza toccare HTML.
  const mount =
    document.querySelector("[data-agenda-mount]") ||
    document.querySelector("#agendaMount") ||
    document.querySelector("main") ||
    document.body;

  // Se esiste già il contenitore, non lo ricreo
  let box = mount.querySelector(".agenda-simple");
  if (!box) {
    box = document.createElement("div");
    box.className = "agenda-simple";
    box.style.padding = "12px";
    box.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
        <div style="font-weight:800; font-size:18px;">Agenda</div>
        <button class="btn" data-refresh>Ricarica</button>
      </div>
      <div data-agenda-list></div>
    `;
    mount.appendChild(box);
  }

  const list = box.querySelector("[data-agenda-list]");
  list.innerHTML = "";

  appointments.forEach(appt => {
    const row = document.createElement("div");
    row.className = "appointment";
    row.style.cursor = "pointer";
    row.style.marginBottom = "10px";
    row.style.padding = "10px";
    row.style.borderRadius = "10px";
    row.style.border = "1px solid rgba(0,0,0,.08)";
    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:12px;">
        <div style="font-weight:800;">${appt.patient_name || "Paziente"}</div>
        <div style="opacity:.8;">${fmtTime(appt.start_at)}</div>
      </div>
      <div style="opacity:.85; font-size:13px; margin-top:4px;">
        ${appt.status ? appt.status + " • " : ""}${appt.service_name || ""}${appt.therapist_name ? " • " + appt.therapist_name : ""}
      </div>
    `;

    row.__appt = appt;
    list.appendChild(row);
  });

  return box;
}

async function initAgenda() {
  if (!isAgendaPage()) return;

  const hoverCard = buildHoverCard();
  const modal = buildModal();

  let appointments = [];
  try {
    const data = await api("/api/appointments");
    appointments = data.appointments || [];
  } catch (e) {
    console.error(e);
    alert("Errore caricamento appuntamenti. Controlla /api/appointments");
    return;
  }

  const box = renderAgendaUI(appointments);

  // Hover + click stile OsteoEasy sui “blocchi” creati
  const rows = box.querySelectorAll(".appointment");
  rows.forEach(row => {
    const appt = row.__appt;

    row.addEventListener("mouseenter", () => {
      hideHoverCard(hoverCard); // pulizia
    });

    row.addEventListener("mousemove", (e) => {
      // se modale aperto, non mostra hover
      if (modal.style.display !== "none") return;
      showHoverCard(hoverCard, appt, e.clientX, e.clientY);
    });

    row.addEventListener("mouseleave", () => {
      hideHoverCard(hoverCard);
    });

    row.addEventListener("click", (e) => {
      e.preventDefault();
      hideHoverCard(hoverCard);
      openModal(modal, appt, (updated) => {
        // aggiorno in memoria e re-render
        appointments = appointments.map(x => x.id === updated.id ? updated : x);
        const newBox = renderAgendaUI(appointments);
        // re-inizializzo eventi
        // (semplice e robusto, non ti rompe nulla)
        initAgenda();
      });
    });
  });

  const refreshBtn = box.querySelector("[data-refresh]");
  if (refreshBtn) {
    refreshBtn.onclick = () => location.reload();
  }
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
