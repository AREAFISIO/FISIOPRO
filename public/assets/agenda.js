(() => {
  // ====== CONFIG ======
  const START_HOUR = 7;
  const END_HOUR = 21;      // ultimo slot termina alle 21:00
  const STEP_MIN = 30;      // mezze ore
  const RESOURCES = ["Fisio 1", "Fisio 2", "Fisio 3"];

  // ====== DOM ======
  const gridBody = document.getElementById("gridBody");
  const gridWrap = document.getElementById("gridWrap");
  const dayLabel = document.getElementById("dayLabel");

  const dateInput = document.getElementById("dateInput");
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnToday = document.getElementById("btnToday");
  const btnNew = document.getElementById("btnNew");

  const leftPanel = document.getElementById("leftPanel");
  const rightPanel = document.getElementById("rightPanel");
  const btnToggleLeft = document.getElementById("btnToggleLeft");
  const btnToggleRight = document.getElementById("btnToggleRight");

  const searchInput = document.getElementById("searchInput");
  const resourceSelect = document.getElementById("resourceSelect");

  const listDay = document.getElementById("listDay");

  // Modal
  const modalBack = document.getElementById("modalBack");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const btnSave = document.getElementById("btnSave");
  const btnDelete = document.getElementById("btnDelete");
  const modalTitle = document.getElementById("modalTitle");
  const saveHint = document.getElementById("saveHint");

  const mPaziente = document.getElementById("mPaziente");
  const mEmail = document.getElementById("mEmail");
  const mRisorsa = document.getElementById("mRisorsa");
  const mDurata = document.getElementById("mDurata");
  const mStart = document.getElementById("mStart");
  const mEnd = document.getElementById("mEnd");
  const mNote = document.getElementById("mNote");

  // ====== STATE ======
  let currentDate = toISODate(new Date());
  let selectedSlotKey = null;   // es: "2025-12-17|Fisio 1|07:30"
  let editingId = null;         // id appuntamento in modifica (per update)
  let dayAppointments = [];     // cache del giorno

  // ====== INIT ======
  dateInput.value = currentDate;
  updateDayLabel();

  buildGrid();
  loadAndRender();

  // ====== EVENTS ======
  btnToggleLeft.addEventListener("click", () => leftPanel.classList.toggle("isCollapsed"));
  btnToggleRight.addEventListener("click", () => rightPanel.classList.toggle("isCollapsed"));

  btnPrev.addEventListener("click", () => {
    currentDate = addDays(currentDate, -1);
    dateInput.value = currentDate;
    onDateChanged();
  });

  btnNext.addEventListener("click", () => {
    currentDate = addDays(currentDate, 1);
    dateInput.value = currentDate;
    onDateChanged();
  });

  btnToday.addEventListener("click", () => {
    currentDate = toISODate(new Date());
    dateInput.value = currentDate;
    onDateChanged();
  });

  dateInput.addEventListener("change", () => {
    currentDate = dateInput.value || toISODate(new Date());
    onDateChanged();
  });

  btnNew.addEventListener("click", () => {
    // Nuovo: se c'è slot selezionato usa quello, altrimenti 09:00 su Fisio 1
    const fallbackTime = "09:00";
    const base = selectedSlotKey ? parseSlotKey(selectedSlotKey) : { date: currentDate, resource: "Fisio 1", time: fallbackTime };
    openModalForNew(base.date, base.resource, base.time);
  });

  btnCloseModal.addEventListener("click", closeModal);
  modalBack.addEventListener("click", (e) => { if (e.target === modalBack) closeModal(); });

  btnSave.addEventListener("click", () => {
    const payload = readModal();
    const err = validate(payload);
    if (err) return showHint(err, true);

    if (editingId) {
      updateAppointment(editingId, payload);
      showHint("Aggiornato (salvato in locale).", false);
    } else {
      createAppointment(payload);
      showHint("Creato (salvato in locale).", false);
    }

    closeModal();
    loadAndRender();
  });

  btnDelete.addEventListener("click", () => {
    if (!editingId) {
      closeModal();
      return;
    }
    deleteAppointment(editingId);
    showHint("Eliminato (salvato in locale).", false);
    closeModal();
    loadAndRender();
  });

  searchInput.addEventListener("input", () => renderAll());
  resourceSelect.addEventListener("change", () => renderAll());

  // ====== GRID BUILD ======
  function buildGrid() {
    gridBody.innerHTML = "";
    selectedSlotKey = null;

    const times = buildTimes();
    times.forEach((t) => {
      const row = document.createElement("div");
      row.className = "row";

      const timeCell = document.createElement("div");
      timeCell.className = "timeCell";
      timeCell.textContent = t;
      row.appendChild(timeCell);

      RESOURCES.forEach((r) => {
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.dataset.date = currentDate;     // aggiornato in renderAll
        slot.dataset.resource = r;
        slot.dataset.time = t;

        slot.addEventListener("click", () => onSlotClick(slot));
        row.appendChild(slot);
      });

      gridBody.appendChild(row);
    });

    // Reset scroll in alto (così vedi subito 07:00)
    gridBody.scrollTop = 0;
  }

  function buildTimes() {
    const out = [];
    const totalMinutes = (END_HOUR - START_HOUR) * 60;
    for (let m = 0; m <= totalMinutes - STEP_MIN; m += STEP_MIN) {
      const hh = START_HOUR + Math.floor(m / 60);
      const mm = m % 60;
      out.push(pad2(hh) + ":" + pad2(mm));
    }
    return out;
  }

  // ====== SLOT CLICK ======
  function onSlotClick(slotEl) {
    // 1) deseleziona slot vecchio
    clearSelectedSlot();

    // 2) seleziona nuovo (diventa “grigio”)
    slotEl.classList.add("selected");
    selectedSlotKey = makeSlotKey(currentDate, slotEl.dataset.resource, slotEl.dataset.time);

    // 3) se c'è un appuntamento nello slot, apri in modifica, altrimenti apri nuovo
    const appt = findAppointmentBySlot(currentDate, slotEl.dataset.resource, slotEl.dataset.time);
    if (appt) openModalForEdit(appt);
    else openModalForNew(currentDate, slotEl.dataset.resource, slotEl.dataset.time);
  }

  function clearSelectedSlot() {
    const prev = gridBody.querySelector(".slot.selected");
    if (prev) prev.classList.remove("selected");
  }

  // ====== DATE CHANGE ======
  function onDateChanged() {
    updateDayLabel();
    buildGrid();        // rigenera slot
    loadAndRender();    // ricarica dati
  }

  function updateDayLabel() {
    const d = new Date(currentDate + "T00:00:00");
    const fmt = new Intl.DateTimeFormat("it-IT", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
    dayLabel.textContent = fmt.format(d);
  }

  // ====== DATA LAYER (locale ora; backend lo colleghiamo dopo) ======
  function storageKey(date) { return `fisioPro_agenda_${date}`; }

  function loadDayFromLocal(date) {
    try {
      const raw = localStorage.getItem(storageKey(date));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveDayToLocal(date, items) {
    localStorage.setItem(storageKey(date), JSON.stringify(items));
  }

  function createAppointment(payload) {
    const items = loadDayFromLocal(payload.date);
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "_" + Math.random().toString(16).slice(2);
    items.push({ id, ...payload });
    saveDayToLocal(payload.date, items);
  }

  function updateAppointment(id, payload) {
    // Se cambio data, devo rimuovere dalla vecchia data e inserire nella nuova
    const old = dayAppointments.find(a => a.id === id);
    if (!old) return;

    if (old.date === payload.date) {
      const items = loadDayFromLocal(payload.date).map(a => a.id === id ? { id, ...payload } : a);
      saveDayToLocal(payload.date, items);
    } else {
      // rimuovi dalla vecchia
      const oldItems = loadDayFromLocal(old.date).filter(a => a.id !== id);
      saveDayToLocal(old.date, oldItems);
      // aggiungi alla nuova
      const newItems = loadDayFromLocal(payload.date);
      newItems.push({ id, ...payload });
      saveDayToLocal(payload.date, newItems);
    }
  }

  function deleteAppointment(id) {
    const items = loadDayFromLocal(currentDate).filter(a => a.id !== id);
    saveDayToLocal(currentDate, items);
  }

  // ====== LOAD + RENDER ======
  function loadAndRender() {
    dayAppointments = loadDayFromLocal(currentDate);
    renderAll();
  }

  function renderAll() {
    // aggiorna dataset date su slot (importante dopo cambio data)
    gridBody.querySelectorAll(".slot").forEach(s => s.dataset.date = currentDate);

    // pulisci appuntamenti grafici
    gridBody.querySelectorAll(".appt").forEach(n => n.remove());

    const q = (searchInput.value || "").trim().toLowerCase();
    const resFilter = resourceSelect.value;

    const filtered = dayAppointments.filter(a => {
      if (resFilter !== "TUTTI" && a.resource !== resFilter) return false;
      if (!q) return true;
      const hay = `${a.paziente||""} ${a.email||""} ${a.note||""} ${a.resource||""}`.toLowerCase();
      return hay.includes(q);
    });

    // render su griglia
    filtered.forEach(a => {
      const startTime = a.startTime; // "HH:MM"
      const slot = findSlotEl(currentDate, a.resource, startTime);
      if (!slot) return;

      const ap = document.createElement("div");
      ap.className = "appt";
      ap.innerHTML = `
        <div class="t1">${escapeHtml(a.paziente || "Appuntamento")}</div>
        <div class="t2">${escapeHtml(a.startTime)} • ${escapeHtml(a.duration)} min</div>
      `;
      ap.addEventListener("click", (e) => {
        e.stopPropagation();
        clearSelectedSlot();
        slot.classList.add("selected");
        selectedSlotKey = makeSlotKey(currentDate, a.resource, a.startTime);
        openModalForEdit(a);
      });

      slot.appendChild(ap);
    });

    // lista destra
    renderList(filtered);
  }

  function renderList(items) {
    listDay.innerHTML = "";
    const sorted = [...items].sort((a,b) => a.startTime.localeCompare(b.startTime));

    if (sorted.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Nessun appuntamento per i filtri selezionati.";
      listDay.appendChild(empty);
      return;
    }

    sorted.forEach(a => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="a">${escapeHtml(a.startTime)} • ${escapeHtml(a.resource)}</div>
        <div class="b">${escapeHtml(a.paziente || "Appuntamento")} — ${escapeHtml(a.duration)} min</div>
      `;
      card.addEventListener("click", () => openModalForEdit(a));
      listDay.appendChild(card);
    });
  }

  function findSlotEl(date, resource, time) {
    return gridBody.querySelector(`.slot[data-date="${cssEsc(date)}"][data-resource="${cssEsc(resource)}"][data-time="${cssEsc(time)}"]`);
  }

  function findAppointmentBySlot(date, resource, time) {
    return dayAppointments.find(a => a.date === date && a.resource === resource && a.startTime === time) || null;
  }

  // ====== MODAL ======
  function openModalForNew(date, resource, time) {
    editingId = null;
    modalTitle.textContent = "Nuovo appuntamento";
    btnDelete.classList.add("hidden");

    mPaziente.value = "";
    mEmail.value = "";
    mRisorsa.value = resource;
    mDurata.value = "30";
    mNote.value = "";

    const startDT = `${date}T${time}`;
    mStart.value = startDT;
    mEnd.value = computeEndDT(startDT, 30);

    showModal();
  }

  function openModalForEdit(appt) {
    editingId = appt.id;
    modalTitle.textContent = "Dettagli appuntamento";
    btnDelete.classList.remove("hidden");

    mPaziente.value = appt.paziente || "";
    mEmail.value = appt.email || "";
    mRisorsa.value = appt.resource;
    mDurata.value = String(appt.duration);
    mNote.value = appt.note || "";

    const startDT = `${appt.date}T${appt.startTime}`;
    mStart.value = startDT;
    mEnd.value = computeEndDT(startDT, Number(appt.duration));

    showModal();
  }

  function showModal() {
    saveHint.textContent = "—";
    modalBack.classList.remove("hidden");
    modalBack.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modalBack.classList.add("hidden");
    modalBack.setAttribute("aria-hidden", "true");
  }

  // quando cambio start/durata, aggiorno end
  mStart.addEventListener("change", () => syncEnd());
  mDurata.addEventListener("change", () => syncEnd());
  function syncEnd() {
    const startDT = mStart.value;
    const dur = Number(mDurata.value || 30);
    if (startDT) mEnd.value = computeEndDT(startDT, dur);
  }

  function readModal() {
    const startDT = mStart.value; // "YYYY-MM-DDTHH:MM"
    const date = startDT.slice(0, 10);
    const startTime = startDT.slice(11, 16);
    const duration = Number(mDurata.value || 30);

    return {
      date,
      paziente: mPaziente.value.trim(),
      email: mEmail.value.trim(),
      resource: mRisorsa.value,
      duration,
      startTime,
      endDT: mEnd.value,
      note: mNote.value.trim()
    };
  }

  function validate(p) {
    if (!p.date || !p.startTime) return "Errore: data/ora inizio non valide.";
    if (!p.resource) return "Errore: risorsa mancante.";
    if (![30,60,90,120].includes(Number(p.duration))) return "Errore: durata non valida.";
    // blocco fuori range 07-21
    const [hh, mm] = p.startTime.split(":").map(Number);
    const minutesFromStart = (hh * 60 + mm) - (START_HOUR * 60);
    if (minutesFromStart < 0) return "Errore: l'orario deve iniziare dalle 07:00.";
    const endMinutes = (hh * 60 + mm) + Number(p.duration);
    if (endMinutes > END_HOUR * 60) return "Errore: l'appuntamento deve finire entro le 21:00.";
    // durata minima 30 già garantita
    return null;
  }

  function showHint(msg, isError) {
    saveHint.textContent = msg;
    saveHint.style.color = isError ? "rgba(255,214,222,.95)" : "rgba(87,211,156,.95)";
  }

  function computeEndDT(startDT, durationMin) {
    const d = new Date(startDT);
    d.setMinutes(d.getMinutes() + durationMin);
    return toDTLocal(d);
  }

  // ====== HELPERS ======
  function toISODate(d) {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  }

  function toDTLocal(d) {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    return `${y}-${m}-${day}T${hh}:${mm}`;
  }

  function addDays(isoDate, delta) {
    const d = new Date(isoDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    return toISODate(d);
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function makeSlotKey(date, resource, time) {
    return `${date}|${resource}|${time}`;
  }
  function parseSlotKey(key) {
    const [date, resource, time] = key.split("|");
    return { date, resource, time };
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // per querySelector sicuro (caratteri speciali)
  function cssEsc(s) {
    return String(s).replaceAll('"', '\\"');
  }
})();
