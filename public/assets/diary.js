// Diary (agenda) renderer: week grid similar to OsteoEasy,
// but styled using the existing app.css tokens.
(function () {
  // build marker (helps verify cache busting)
  console.log("FISIOPRO diary build", "7e72bca");
  const root = document.querySelector("[data-diary]");
  if (!root) return;

  const gridEl = document.querySelector("[data-cal-grid]");
  const qEl = document.querySelector("[data-cal-q]");
  const rangeEl = document.querySelector("[data-cal-range]");
  const monthEl = document.querySelector("[data-cal-month]");
  const weekEl = document.querySelector("[data-cal-week]");
  const opsBar = document.querySelector("[data-ops-bar]");
  const opsDots = document.querySelector("[data-ops-dots]");
  const opsText = document.querySelector("[data-ops-text]");
  const opsBack = document.querySelector("[data-ops-back]");
  const opsList = document.querySelector("[data-ops-list]");
  const opsMulti = document.querySelector("[data-ops-multi]");
  const opsBtnClose = document.querySelector("[data-ops-close]");
  const opsBtnApply = document.querySelector("[data-ops-apply]");
  const opsBtnAll = document.querySelector("[data-ops-all]");
  const btnOpenPrefs = document.querySelector("[data-open-prefs]");
  const btnOpenOps = document.querySelector("[data-open-ops]");
  const btnOpenAvailability = document.querySelector("[data-open-availability]");
  const btnPrev = document.querySelector("[data-cal-prev]");
  const btnNext = document.querySelector("[data-cal-next]");
  const btnToday = document.querySelector("[data-cal-today]");

  const modalBack = document.querySelector("[data-cal-modal]");
  const modalTitle = document.querySelector("[data-cal-modal-title]");
  const modalBody = document.querySelector("[data-cal-modal-body]");
  const modalClose = document.querySelector("[data-cal-modal-close]");

  const START_HOUR = 8;
  const END_HOUR = 20;
  let SLOT_MIN = 30; // user preference
  const SLOT_PX = 18;

  let view = "week"; // week | workweek
  let anchorDate = new Date();
  let rawItems = [];
  let multiUser = false; // default: show only logged-in user
  let knownTherapists = [];
  let knownByEmail = new Map(); // email -> name
  let selectedTherapists = new Set();
  let draftSelected = new Set();
  let pickMode = "view"; // view | defaults

  // Preferences
  const prefsBack = document.querySelector("[data-prefs-back]");
  const prefsClose = document.querySelector("[data-prefs-close]");
  const prefsSave = document.querySelector("[data-prefs-save]");
  const prefsReset = document.querySelector("[data-prefs-reset]");
  const prefSlot = document.querySelector("[data-pref-slot]");
  const prefColor = document.querySelector("[data-pref-color]");
  const prefMulti = document.querySelector("[data-pref-multi]");
  const prefDefaultDots = document.querySelector("[data-pref-default-dots]");
  const prefPick = document.querySelector("[data-pref-pick]");
  const prefShowService = document.querySelector("[data-pref-show-service]");
  const prefDayNav = document.querySelector("[data-pref-day-nav]");
  const prefDefaultRow = document.querySelector("[data-pref-default-row]");

  let prefs = {
    slotMin: 30,
    multiUser: false,
    defaultOperators: [],
    lastViewOperators: [],
    showService: true,
    dayNav: false,
    userColor: "",
  };

  function pad2(n) { return String(n).padStart(2, "0"); }
  function toYmd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function parseYmd(s) {
    const [y, m, d] = String(s || "").split("-").map(Number);
    if (!y || !m || !d) return null;
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    return isNaN(dt.getTime()) ? null : dt;
  }
  function startOfWeekMonday(d) {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // lun=0..dom=6
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function fmtMonth(d) {
    try { return d.toLocaleDateString("it-IT", { month: "long", year: "numeric" }); }
    catch { return "Agenda"; }
  }
  function fmtWeekRange(start, days) {
    const end = addDays(start, days - 1);
    return `${pad2(start.getDate())}/${pad2(start.getMonth() + 1)} → ${pad2(end.getDate())}/${pad2(end.getMonth() + 1)}`;
  }
  function itDayLabel(d) {
    const days = ["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"];
    return days[(d.getDay() + 6) % 7];
  }

  function minutesOfDay(dt) { return dt.getHours() * 60 + dt.getMinutes(); }

  function pickField(fields, keys) {
    for (const k of keys) {
      if (fields && fields[k] != null && String(fields[k]).trim() !== "") return fields[k];
    }
    return "";
  }

  function normalizeItem(x) {
    const f = x.fields || {};
    const start = pickField(f, ["Data e ora INIZIO", "Start", "Inizio", "start_at", "StartAt"]);
    const end = pickField(f, ["Data e ora FINE", "End", "Fine", "end_at", "EndAt"]);
    let therapist = String(x.operator || "").trim() || pickField(f, ["Collaboratore", "Collaborator", "Operatore", "Operator", "Fisioterapista", "Therapist", "therapist_name", "Email"]) || "";
    // In case Operatore is still an array, normalize to a readable string.
    if (Array.isArray(therapist)) therapist = therapist.filter(Boolean).join(", ");
    // If it contains multiple names, pick the first for column placement
    if (typeof therapist === "string" && therapist.includes(",")) therapist = therapist.split(",")[0].trim();
    const service = pickField(f, ["Prestazione", "Servizio", "service_name"]) || "";
    const status = pickField(f, ["Stato", "status"]) || "";

    // patient can be link-array; attempt text variants, then fallback.
    const patient =
      pickField(f, ["Paziente (testo)", "Paziente", "Patient", "patient_name", "Nome Paziente", "Cognome e Nome"]) ||
      (Array.isArray(f.Paziente) ? `Paziente (${f.Paziente[0] || ""})` : "");

    let startAt = null;
    let endAt = null;
    try { if (start) startAt = new Date(start); } catch {}
    try { if (end) endAt = new Date(end); } catch {}

    const startOk = startAt && !isNaN(startAt.getTime());
    const endOk = endAt && !isNaN(endAt.getTime());

    return {
      id: x.id,
      fields: f,
      patient: String(patient || "").trim(),
      therapist: String(therapist || "").trim(),
      service: String(service || "").trim(),
      status: String(status || "").trim(),
      startAt: startOk ? startAt : null,
      endAt: endOk ? endAt : null,
    };
  }

  function therapistKey(name) {
    const s = String(name || "").trim();
    if (!s) return "";
    // prefer initials for chip label
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function colorForTherapist(name) {
    // deterministic pastel based on string hash
    const s = String(name || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsl(${hue} 80% 60% / 0.18)`;
  }

  function solidForTherapist(name) {
    const s = String(name || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    // user override
    const me = String(getUserName() || "");
    if (prefs.userColor && me && name === me) return prefs.userColor;
    return `hsl(${hue} 85% 62% / 0.95)`;
  }

  function getUserEmail() {
    const u = window.FP_USER || window.FP_SESSION || null;
    return String(u?.email || "").trim().toLowerCase();
  }
  function getUserName() {
    // Prefer mapping by email to COLLABORATORI name
    const email = getUserEmail();
    if (email && knownByEmail.has(email)) return knownByEmail.get(email);
    // Fallback: auth payload has only "nome"
    const u = window.FP_USER || window.FP_SESSION || null;
    return String(u?.nome || "").trim();
  }

  async function ensureUserReady() {
    // auth-guard.js sets FP_USER/FP_SESSION asynchronously; diary.js must not read prefs as "anon".
    if (getUserEmail()) return;
    try {
      const r = await fetch("/api/auth-me", { credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (data?.ok) {
        if (data.session) window.FP_SESSION = data.session;
        if (data.user) window.FP_USER = data.user;
      }
    } catch {}
  }

  function migrateAnonStorageIfNeeded() {
    const email = getUserEmail();
    if (!email) return;
    try {
      const anonPrefsKey = "fp_agenda_prefs_anon";
      const targetPrefsKey = `fp_agenda_prefs_${email}`;
      const anonAvailKey = "fp_agenda_availability_anon";
      const targetAvailKey = `fp_agenda_availability_${email}`;

      if (!localStorage.getItem(targetPrefsKey) && localStorage.getItem(anonPrefsKey)) {
        localStorage.setItem(targetPrefsKey, localStorage.getItem(anonPrefsKey));
        localStorage.removeItem(anonPrefsKey);
      }
      if (!localStorage.getItem(targetAvailKey) && localStorage.getItem(anonAvailKey)) {
        localStorage.setItem(targetAvailKey, localStorage.getItem(anonAvailKey));
        localStorage.removeItem(anonAvailKey);
      }
    } catch {}
  }

  function ensureMeSelected(setLike) {
    const me = getUserName();
    if (me) setLike.add(me);
    return setLike;
  }

  function prefsKey() {
    const email = getUserEmail() || "anon";
    return `fp_agenda_prefs_${email}`;
  }
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(prefsKey());
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") prefs = { ...prefs, ...obj };
    } catch {}
    SLOT_MIN = Number(prefs.slotMin || 30);
    if (![30, 60].includes(SLOT_MIN)) SLOT_MIN = 30;
    multiUser = Boolean(prefs.multiUser);
  }
  function savePrefs() {
    try { localStorage.setItem(prefsKey(), JSON.stringify(prefs)); } catch {}
  }
  function resetPrefs() {
    prefs = { slotMin: 30, multiUser: false, defaultOperators: [], lastViewOperators: [], showService: true, dayNav: false, userColor: "" };
    SLOT_MIN = 30;
    multiUser = false;
    savePrefs();
  }

  function syncPrefsUI() {
    if (prefSlot) prefSlot.value = String(prefs.slotMin || 30);
    if (prefMulti) prefMulti.checked = Boolean(prefs.multiUser);
    if (prefShowService) prefShowService.checked = Boolean(prefs.showService);
    if (prefDayNav) prefDayNav.checked = Boolean(prefs.dayNav);
    if (prefColor) prefColor.value = String(prefs.userColor || "#22e6c3");
    // show/hide default operators section based on multi-user
    if (prefDefaultRow) prefDefaultRow.style.display = prefs.multiUser ? "" : "none";
    renderDefaultDots();
  }
  function openPrefs() {
    if (!prefsBack) return;
    syncPrefsUI();
    prefsBack.style.display = "block";
  }
  function closePrefs() {
    if (!prefsBack) return;
    prefsBack.style.display = "none";
  }
  function renderDefaultDots() {
    if (!prefDefaultDots) return;
    prefDefaultDots.innerHTML = "";
    const names = (prefs.defaultOperators || []).slice(0, 10);
    names.forEach((n) => {
      const dot = document.createElement("div");
      dot.className = "opsDot";
      dot.style.background = solidForTherapist(n);
      dot.textContent = therapistKey(n);
      prefDefaultDots.appendChild(dot);
    });
    if (!names.length) {
      const t = document.createElement("div");
      t.className = "opsMini";
      t.textContent = "—";
      prefDefaultDots.appendChild(t);
    }
  }

  // =========================
  // Availability (weekly template, per user)
  // =========================
  const avBack = document.querySelector("[data-av-back]");
  const avClose = document.querySelector("[data-av-close]");
  const avGrid = document.querySelector("[data-av-grid]");
  const avCount = document.querySelector("[data-av-count]");
  const avTypeNon = document.querySelector("[data-av-type-non]");
  const avTypeWork = document.querySelector("[data-av-type-work]");
  const avLocation = document.querySelector("[data-av-location]");
  const avApply = document.querySelector("[data-av-apply]");

  const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  function availabilityKey() {
    const email = getUserEmail() || "anon";
    return `fp_agenda_availability_${email}`;
  }

  function emptyTemplate() {
    const t = {};
    for (const k of DOW_KEYS) t[k] = {};
    return t;
  }

  let availability = emptyTemplate(); // { mon: { "08:00": { work:true, location:"" } } ... }
  let avSelected = new Set(); // keys "dayIndex|HH:MM"
  let avIsSelecting = false;

  function loadAvailability() {
    try {
      const raw = localStorage.getItem(availabilityKey());
      if (!raw) { availability = emptyTemplate(); return; }
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") availability = { ...emptyTemplate(), ...obj };
      else availability = emptyTemplate();
    } catch {
      availability = emptyTemplate();
    }
  }

  function saveAvailability() {
    try { localStorage.setItem(availabilityKey(), JSON.stringify(availability)); } catch {}
  }

  function timeSlots() {
    const out = [];
    const totalMin = (END_HOUR - START_HOUR) * 60;
    for (let m = 0; m <= totalMin - SLOT_MIN; m += SLOT_MIN) {
      const hh = START_HOUR + Math.floor(m / 60);
      const mm = m % 60;
      out.push(`${pad2(hh)}:${pad2(mm)}`);
    }
    return out;
  }

  function avCellKey(dayIndex, time) {
    return `${dayIndex}|${time}`;
  }

  function avGet(dayIndex, time) {
    const k = DOW_KEYS[dayIndex] || "";
    if (!k) return null;
    const v = availability?.[k]?.[time];
    return v && typeof v === "object" ? v : null;
  }

  function avSetMany(keys, next) {
    for (const key of keys) {
      const [dayIndexRaw, time] = String(key).split("|");
      const dayIndex = Number(dayIndexRaw);
      const dow = DOW_KEYS[dayIndex] || "";
      if (!dow || !time) continue;
      if (!availability[dow]) availability[dow] = {};
      availability[dow][time] = { ...next };
    }
  }

  function avStyleForCell(dayIndex, time) {
    const v = avGet(dayIndex, time);
    const selected = avSelected.has(avCellKey(dayIndex, time));
    // Default: NON working (grey) unless explicitly working.
    const work = v?.work === true;
    const bg = work
      ? (prefs.userColor ? `${prefs.userColor}33` : "rgba(34,230,195,.18)")
      : "rgba(255,255,255,.10)";
    const outline = selected ? "2px solid rgba(255,255,255,.75)" : "1px solid rgba(255,255,255,.08)";
    return { bg, outline, work };
  }

  function renderAvailabilityGrid() {
    if (!avGrid) return;

    const start = startOfWeekMonday(anchorDate);
    const days = view === "workweek" ? 6 : 7;
    const times = timeSlots();

    // grid structure
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = `76px repeat(${days}, minmax(140px, 1fr))`;
    wrap.style.borderTop = "1px solid rgba(255,255,255,.10)";

    // header row
    const corner = document.createElement("div");
    corner.style.height = "54px";
    corner.style.borderRight = "1px solid rgba(255,255,255,.10)";
    corner.style.background = "rgba(255,255,255,.03)";
    wrap.appendChild(corner);

    for (let dIdx = 0; dIdx < days; dIdx++) {
      const d = addDays(start, dIdx);
      const h = document.createElement("div");
      h.style.height = "54px";
      h.style.padding = "10px 10px";
      h.style.borderRight = "1px solid rgba(255,255,255,.10)";
      h.style.background = "rgba(255,255,255,.03)";
      h.innerHTML = `<div style="font-weight:900; font-size:12px; letter-spacing:.08em; opacity:.75;">${itDayLabel(d)}</div>
                     <div style="font-weight:900; font-size:15px;">${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}</div>`;
      wrap.appendChild(h);
    }

    // body rows
    times.forEach((t) => {
      const timeCell = document.createElement("div");
      timeCell.style.height = "28px";
      timeCell.style.display = "flex";
      timeCell.style.alignItems = "center";
      timeCell.style.justifyContent = "center";
      timeCell.style.fontSize = "12px";
      timeCell.style.fontWeight = "900";
      timeCell.style.opacity = ".75";
      timeCell.style.borderRight = "1px solid rgba(255,255,255,.10)";
      timeCell.style.borderBottom = "1px solid rgba(255,255,255,.08)";
      timeCell.textContent = t;
      wrap.appendChild(timeCell);

      for (let dIdx = 0; dIdx < days; dIdx++) {
        const cell = document.createElement("div");
        cell.dataset.dayIndex = String(dIdx);
        cell.dataset.time = t;
        cell.style.height = "28px";
        cell.style.borderRight = "1px solid rgba(255,255,255,.10)";
        cell.style.borderBottom = "1px solid rgba(255,255,255,.08)";
        cell.style.cursor = "pointer";
        cell.style.userSelect = "none";

        const st = avStyleForCell(dIdx, t);
        cell.style.background = st.bg;
        cell.style.outline = st.outline;
        cell.style.outlineOffset = "-1px";

        // tooltip: show location if present
        const v = avGet(dIdx, t);
        if (v?.location) cell.title = v.location;

        cell.addEventListener("mousedown", (e) => {
          e.preventDefault();
          avIsSelecting = true;
          const key = avCellKey(dIdx, t);
          if (avSelected.has(key)) avSelected.delete(key);
          else avSelected.add(key);
          updateAvCount();
          renderAvailabilityGrid();
        });
        cell.addEventListener("mouseenter", (e) => {
          if (!avIsSelecting) return;
          e.preventDefault();
          avSelected.add(avCellKey(dIdx, t));
          updateAvCount();
          // lightweight re-render: update cell styles only would be nicer, but keep it simple
          renderAvailabilityGrid();
        });

        wrap.appendChild(cell);
      }
    });

    avGrid.innerHTML = "";
    avGrid.appendChild(wrap);
  }

  function updateAvCount() {
    if (!avCount) return;
    const n = avSelected.size;
    avCount.textContent = `${n} slot selezionat${n === 1 ? "o" : "i"}`;
  }

  function openAvailability() {
    if (!avBack) return;
    loadAvailability();
    avSelected = new Set();
    avIsSelecting = false;
    updateAvCount();
    if (avTypeWork) avTypeWork.checked = true;
    if (avTypeNon) avTypeNon.checked = false;
    if (avLocation) avLocation.value = "";
    renderAvailabilityGrid();
    avBack.style.display = "block";
  }

  function closeAvailability() {
    if (!avBack) return;
    avIsSelecting = false;
    avBack.style.display = "none";
  }

  // Stop selection when mouse released anywhere
  window.addEventListener("mouseup", () => { avIsSelecting = false; });

  function getTherapists(items) {
    return Array.from(new Set(items.map((x) => x.therapist).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
  }

  function syncOpsBar() {
    if (!opsDots || !opsText) return;
    opsDots.innerHTML = "";
    const names = Array.from(selectedTherapists);
    const shown = names.slice(0, 10);
    shown.forEach((n) => {
      const dot = document.createElement("div");
      dot.className = "opsDot";
      dot.style.background = solidForTherapist(n);
      dot.textContent = therapistKey(n) || n.slice(0, 2).toUpperCase();
      opsDots.appendChild(dot);
    });
    if (names.length > shown.length) {
      const more = document.createElement("div");
      more.className = "opsDot";
      more.style.background = "rgba(255,255,255,.14)";
      more.style.color = "rgba(255,255,255,.85)";
      more.textContent = "+" + String(names.length - shown.length);
      opsDots.appendChild(more);
    }
    opsText.textContent = names.length ? `${names.length} operatori selezionati` : "Seleziona operatori";
  }

  function openOpsMenu() {
    if (!opsBack) return;
    if (pickMode === "defaults") draftSelected = ensureMeSelected(new Set(prefs.defaultOperators || []));
    else draftSelected = ensureMeSelected(new Set(selectedTherapists));
    // When picking defaults, multi-user is implied.
    if (opsMulti) opsMulti.checked = (pickMode === "defaults") ? true : Boolean(multiUser);
    renderOpsList();
    opsBack.style.display = "block";
  }

  function closeOpsMenu() {
    if (!opsBack) return;
    opsBack.style.display = "none";
  }

  function renderOpsList() {
    if (!opsList) return;
    opsList.innerHTML = "";

    const me = getUserName();

    if (!knownTherapists.length) {
      const empty = document.createElement("div");
      empty.className = "opsRow";
      empty.innerHTML = `<div class="opsRowLeft"><div class="opsMini">Nessun operatore trovato nei dati.</div></div>`;
      opsList.appendChild(empty);
      return;
    }

    knownTherapists.forEach((name) => {
      const row = document.createElement("div");
      row.className = "opsRow";
      const isMe = Boolean(me && name === me);
      const on = isMe ? true : draftSelected.has(name);
      const check = `<div class="opsCheck ${on ? "on" : ""}">${on ? "✓" : ""}</div>`;
      row.innerHTML = `
        <div class="opsRowLeft">
          ${check}
          <div style="min-width:0;">
            <div class="opsName">${name}${isMe ? ` <span style="opacity:.75;font-weight:800;">(tu)</span>` : ""}</div>
            <div class="opsMini">${therapistKey(name) || ""}</div>
          </div>
        </div>
        <div class="opsDot" style="background:${solidForTherapist(name)}">${isMe ? "🔒" : (therapistKey(name) || "")}</div>
      `;
      row.addEventListener("click", () => {
        // Logged-in operator is always selected and cannot be deselected.
        if (isMe) return;
        if (draftSelected.has(name)) draftSelected.delete(name);
        else draftSelected.add(name);
        ensureMeSelected(draftSelected);
        renderOpsList();
      });
      opsList.appendChild(row);
    });
  }

  async function apiGet(url) {
    const r = await fetch(url, { credentials: "include" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const extra = data.details ? `\n\nDettagli: ${JSON.stringify(data.details)}` : "";
      throw new Error((data.error || ("HTTP " + r.status)) + extra);
    }
    return data;
  }

  async function load() {
    const start = startOfWeekMonday(anchorDate);
    const days = view === "workweek" ? 6 : 7;
    const from = toYmd(start);
    const to = toYmd(addDays(start, days - 1));

    if (rangeEl) rangeEl.textContent = `${from} → ${to}`;
    if (monthEl) monthEl.textContent = fmtMonth(start);
    if (weekEl) weekEl.textContent = fmtWeekRange(start, days);

    // Load known operators from COLLABORATORI (preferred),
    // then load appointments for the selected week.
    try {
      const ops = await apiGet("/api/operators");
      const items = (ops.items || []);
      const names = items.map((x) => String(x.name || "").trim()).filter(Boolean);
      if (names.length) knownTherapists = names;
      knownByEmail = new Map(items.map((x) => [String(x.email || "").trim().toLowerCase(), String(x.name || "").trim()]).filter((p) => p[0] && p[1]));
    } catch {
      // fallback to operators found in the week
    }

    const data = await apiGet(`/api/agenda?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    rawItems = (data.items || []).map(normalizeItem).filter((x) => x.startAt);
    if (!knownTherapists.length) knownTherapists = getTherapists(rawItems);

    // Default behavior:
    // - show the logged-in user's agenda only
    // - if multi-user is enabled (preference), use defaultOperators list
    if (selectedTherapists.size === 0 && knownTherapists.length) {
      const me = getUserName();
      if (!multiUser && me) {
        selectedTherapists = new Set([me]);
      } else if (multiUser && (prefs.lastViewOperators || []).length) {
        selectedTherapists = ensureMeSelected(new Set(prefs.lastViewOperators));
      } else if (multiUser && (prefs.defaultOperators || []).length) {
        selectedTherapists = ensureMeSelected(new Set(prefs.defaultOperators));
      } else if (me) {
        selectedTherapists = new Set([me]);
      } else {
        selectedTherapists = new Set([knownTherapists[0]]);
      }
    }

    // keep selection valid
    if (selectedTherapists.size === 0 && knownTherapists.length) selectedTherapists.add(knownTherapists[0]);
    // Always include current operator
    ensureMeSelected(selectedTherapists);

    syncOpsBar();
    render();
  }

  function buildGridSkeleton(start, days, ops) {
    gridEl.innerHTML = "";

    // Body columns
    const totalMin = (END_HOUR - START_HOUR) * 60;
    const totalSlots = Math.ceil(totalMin / SLOT_MIN);
    const heightPx = totalSlots * SLOT_PX;

    const colsPerDay = multiUser ? Math.max(1, ops.length) : 1;
    const totalDayCols = days * colsPerDay;

    gridEl.style.gridTemplateColumns = `64px repeat(${totalDayCols}, minmax(160px, 1fr))`;
    if (multiUser) gridEl.style.gridTemplateRows = `58px 34px ${heightPx}px`;
    else gridEl.style.gridTemplateRows = `58px ${heightPx}px`;

    // Corner (day header)
    const corner = document.createElement("div");
    corner.className = "corner";
    corner.style.gridColumn = "1";
    corner.style.gridRow = "1";
    gridEl.appendChild(corner);

    // Day headers (span operator subcolumns)
    for (let dIdx = 0; dIdx < days; dIdx++) {
      const d = addDays(start, dIdx);
      const dh = document.createElement("div");
      dh.className = "dayHead";
      const startCol = 2 + dIdx * colsPerDay;
      dh.style.gridColumn = `${startCol} / span ${colsPerDay}`;
      dh.style.gridRow = "1";
      dh.innerHTML = `<div class="d1">${itDayLabel(d)}</div><div class="d2">${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}</div>`;
      gridEl.appendChild(dh);
    }

    // Operator headers (only in multi-user)
    if (multiUser) {
      const blank = document.createElement("div");
      blank.className = "corner";
      blank.style.height = "34px";
      blank.style.gridColumn = "1";
      blank.style.gridRow = "2";
      gridEl.appendChild(blank);

      for (let dIdx = 0; dIdx < days; dIdx++) {
        for (let oIdx = 0; oIdx < colsPerDay; oIdx++) {
          const name = ops[oIdx] || "";
          const cell = document.createElement("div");
          cell.className = "dayHead";
          cell.style.height = "34px";
          cell.style.padding = "6px 10px";
          cell.style.gridRow = "2";
          cell.style.gridColumn = String(2 + dIdx * colsPerDay + oIdx);
          cell.innerHTML = `<div class="d2" style="display:flex;align-items:center;gap:8px;font-size:13px;">
            <span class="opsDot" style="width:22px;height:22px;background:${solidForTherapist(name)}">${therapistKey(name)}</span>
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9;">${name}</span>
          </div>`;
          gridEl.appendChild(cell);
        }
      }
    }

    // time column
    const timeCol = document.createElement("div");
    timeCol.className = "timeCol";
    timeCol.style.height = heightPx + "px";
    timeCol.style.gridColumn = "1";
    timeCol.style.gridRow = multiUser ? "3" : "2";
    timeCol.style.position = "sticky";
    timeCol.style.left = "0";
    timeCol.style.zIndex = "4";
    timeCol.style.background = "rgba(15,26,44,.96)";

    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const y = ((h - START_HOUR) * 60 / SLOT_MIN) * SLOT_PX;
      const tick = document.createElement("div");
      tick.className = "timeTick";
      tick.style.top = y + "px";
      tick.textContent = `${pad2(h)}:00`;
      timeCol.appendChild(tick);
    }

    gridEl.appendChild(timeCol);

    // day/operator columns
    for (let dIdx = 0; dIdx < days; dIdx++) {
      for (let oIdx = 0; oIdx < colsPerDay; oIdx++) {
        const col = document.createElement("div");
        col.className = "dayCol";
        col.dataset.dayIndex = String(dIdx);
        col.dataset.therapist = multiUser ? String(ops[oIdx] || "") : "";
        col.style.height = heightPx + "px";
        col.style.gridColumn = String(2 + dIdx * colsPerDay + oIdx);
        col.style.gridRow = multiUser ? "3" : "2";

        // grid lines
        for (let s = 0; s <= totalSlots; s++) {
          const m = s * SLOT_MIN;
          const y = s * SLOT_PX;
          const line = document.createElement("div");
          line.className = "gridLine" + ((m % 60 === 0) ? " hour" : "");
          line.style.top = y + "px";
          col.appendChild(line);
        }

        gridEl.appendChild(col);
      }
    }
  }

  function openModal(item) {
    if (!modalBack) return;
    modalTitle.textContent = item.patient || "Dettagli appuntamento";

    const lines = [];
    const st = item.startAt ? item.startAt.toLocaleString("it-IT", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    const en = item.endAt ? item.endAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
    lines.push(["Quando", st + (en ? " → " + en : "")]);
    if (item.therapist) lines.push(["Operatore", item.therapist]);
    if (item.service) lines.push(["Prestazione", item.service]);
    if (item.status) lines.push(["Stato", item.status]);

    // show a few extra raw fields (useful during mapping)
    const rawKeys = Object.keys(item.fields || {}).slice(0, 12);
    if (rawKeys.length) {
      lines.push(["Campi Airtable", rawKeys.join(", ")]);
    }

    modalBody.innerHTML = lines
      .map(([k, v]) => `<div class="fp-kv"><div class="k">${k}</div><div class="v">${String(v || "—")}</div></div>`)
      .join("");

    modalBack.style.display = "flex";
  }

  function closeModal() {
    if (!modalBack) return;
    modalBack.style.display = "none";
  }

  function render() {
    const start = startOfWeekMonday(anchorDate);
    const days = view === "workweek" ? 6 : 7;
    const ops = Array.from(selectedTherapists);

    const q = String(qEl?.value || "").trim().toLowerCase();
    const items = rawItems
      .filter((x) => {
        if (!x.startAt) return false;
        const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
        const dt0 = new Date(x.startAt.getFullYear(), x.startAt.getMonth(), x.startAt.getDate()).getTime();
        const idx = Math.round((dt0 - day0) / 86400000);
        if (idx < 0 || idx >= days) return false;
        if (selectedTherapists.size && !selectedTherapists.has(x.therapist)) return false;
        if (!q) return true;
        const hay = [x.patient, x.service, x.therapist, x.status].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .map((x) => {
        const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
        const dt0 = new Date(x.startAt.getFullYear(), x.startAt.getMonth(), x.startAt.getDate()).getTime();
        const idx = Math.round((dt0 - day0) / 86400000);
        return { ...x, _dayIndex: idx };
      });

    buildGridSkeleton(start, days, ops.length ? ops : knownTherapists.slice(0, 1));

    const cols = Array.from(document.querySelectorAll(".dayCol"));
    const startMin = START_HOUR * 60;
    const endMin = END_HOUR * 60;

    items.forEach((it) => {
      let col = null;
      if (multiUser) {
        col = cols.find((c) => c.dataset.dayIndex === String(it._dayIndex) && c.dataset.therapist === String(it.therapist || ""));
      } else {
        // first column for that day
        col = cols.find((c) => c.dataset.dayIndex === String(it._dayIndex));
      }
      if (!col) return;

      const stMin = minutesOfDay(it.startAt);
      let durMin = 30;
      if (it.endAt) {
        const endMin0 = minutesOfDay(it.endAt);
        if (endMin0 > stMin) durMin = endMin0 - stMin;
      }
      const top = ((Math.max(startMin, stMin) - startMin) / SLOT_MIN) * SLOT_PX;
      const end = Math.min(endMin, stMin + durMin);
      const height = Math.max(SLOT_PX * 2, ((end - Math.max(startMin, stMin)) / SLOT_MIN) * SLOT_PX);

      const ev = document.createElement("div");
      ev.className = "event";
      ev.style.top = top + "px";
      ev.style.height = height + "px";
      ev.style.background = colorForTherapist(it.therapist);

      const dot = `<span class="dot" style="background:${colorForTherapist(it.therapist).replace("/ 0.18", "/ 1")}"></span>`;
      const line = prefs.showService
        ? [it.service, it.status].filter(Boolean).join(" • ")
        : [it.status].filter(Boolean).join(" • ");

      ev.innerHTML = `
        <div class="t">${it.patient || "Appuntamento"}</div>
        <div class="m">${line}</div>
        <div class="b">${dot}<span>${therapistKey(it.therapist) || it.therapist || ""}</span><span style="margin-left:auto; opacity:.8;">${pad2(it.startAt.getHours())}:${pad2(it.startAt.getMinutes())}</span></div>
      `;
      ev.onclick = () => openModal(it);

      col.appendChild(ev);
    });
  }

  function setView(next) {
    view = next;
    document.querySelectorAll("[data-cal-view]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-cal-view") === view);
    });
    load().catch((e) => alert("Errore agenda: " + (e.message || e)));
  }

  // Events
  qEl?.addEventListener("input", () => render());
  btnPrev?.addEventListener("click", () => { anchorDate = addDays(anchorDate, view === "workweek" ? -6 : -7); load().catch(()=>{}); });
  btnNext?.addEventListener("click", () => { anchorDate = addDays(anchorDate, view === "workweek" ? 6 : 7); load().catch(()=>{}); });
  btnToday?.addEventListener("click", () => { anchorDate = new Date(); load().catch(()=>{}); });
  document.querySelectorAll("[data-cal-view]").forEach((el) => {
    el.addEventListener("click", () => setView(el.getAttribute("data-cal-view")));
  });

  modalClose?.addEventListener("click", closeModal);
  modalBack?.addEventListener("click", (e) => { if (e.target === modalBack) closeModal(); });

  // Operator selector
  opsBar?.addEventListener("click", () => { pickMode = "view"; openOpsMenu(); });
  opsBtnClose?.addEventListener("click", closeOpsMenu);
  opsBack?.addEventListener("click", (e) => { if (e.target === opsBack) closeOpsMenu(); });
  opsBtnAll?.addEventListener("click", () => {
    draftSelected = ensureMeSelected(new Set(knownTherapists));
    renderOpsList();
  });
  opsBtnApply?.addEventListener("click", () => {
    // Persist multi-user + selection immediately (so next login restores defaults)
    multiUser = Boolean(opsMulti?.checked);
    prefs.multiUser = multiUser;
    ensureMeSelected(draftSelected);

    if (pickMode === "defaults") {
      prefs.defaultOperators = Array.from(ensureMeSelected(draftSelected));
      // If user is setting defaults, also align lastViewOperators for convenience
      prefs.lastViewOperators = Array.from(ensureMeSelected(draftSelected));
      savePrefs();
      renderDefaultDots();
      // apply immediately if multi-user is on
      if (multiUser) selectedTherapists = new Set(prefs.defaultOperators);
    } else {
      selectedTherapists = ensureMeSelected(new Set(draftSelected));
      prefs.lastViewOperators = Array.from(ensureMeSelected(new Set(draftSelected)));
      // If multi-user is enabled, treat current selection as defaults too
      if (multiUser) {
        prefs.defaultOperators = Array.from(ensureMeSelected(new Set(draftSelected)));
        renderDefaultDots();
      }
      savePrefs();
    }
    // If multi-user is off, enforce only "me"
    if (!multiUser) {
      const me = getUserName();
      if (me) selectedTherapists = new Set([me]);
      prefs.lastViewOperators = me ? [me] : prefs.lastViewOperators;
      savePrefs();
    }
    syncOpsBar();
    closeOpsMenu();
    render();
  });
  opsMulti?.addEventListener("change", () => {
    // keep UI responsive but don't rebuild grid until Apply
  });

  // Right bar buttons
  btnOpenPrefs?.addEventListener("click", openPrefs);
  btnOpenOps?.addEventListener("click", () => { pickMode = "view"; openOpsMenu(); });
  btnOpenAvailability?.addEventListener("click", openAvailability);

  avClose?.addEventListener("click", closeAvailability);
  avBack?.addEventListener("click", (e) => { if (e.target === avBack) closeAvailability(); });
  avApply?.addEventListener("click", () => {
    const work = Boolean(avTypeWork?.checked);
    const location = work ? String(avLocation?.value || "").trim() : "";
    if (!avSelected.size) return closeAvailability();
    avSetMany(avSelected, { work, location });
    saveAvailability();
    avSelected = new Set();
    updateAvCount();
    renderAvailabilityGrid();
    closeAvailability();
  });

  // Preferences modal events
  prefsClose?.addEventListener("click", closePrefs);
  prefsBack?.addEventListener("click", (e) => { if (e.target === prefsBack) closePrefs(); });
  prefPick?.addEventListener("click", () => { pickMode = "defaults"; openOpsMenu(); });
  prefsReset?.addEventListener("click", () => { resetPrefs(); syncPrefsUI(); toast?.("Reset"); render(); });
  prefsSave?.addEventListener("click", () => {
    prefs.slotMin = Number(prefSlot?.value || 30);
    prefs.multiUser = Boolean(prefMulti?.checked);
    prefs.showService = Boolean(prefShowService?.checked);
    prefs.dayNav = Boolean(prefDayNav?.checked);
    prefs.userColor = String(prefColor?.value || "").trim();
    savePrefs();

    SLOT_MIN = Number(prefs.slotMin || 30);
    if (![30, 60].includes(SLOT_MIN)) SLOT_MIN = 30;
    multiUser = Boolean(prefs.multiUser);

    // enforce default selection logic
    if (!multiUser) {
      const me = getUserName();
      if (me) selectedTherapists = new Set([me]);
    } else if ((prefs.lastViewOperators || []).length) {
      selectedTherapists = ensureMeSelected(new Set(prefs.lastViewOperators));
    } else if ((prefs.defaultOperators || []).length) {
      selectedTherapists = ensureMeSelected(new Set(prefs.defaultOperators));
    }

    ensureMeSelected(selectedTherapists);
    syncOpsBar();
    closePrefs();
    render();
  });

  // UX: enabling multi-user should immediately ask which operators to show by default.
  prefMulti?.addEventListener("change", () => {
    if (prefDefaultRow) prefDefaultRow.style.display = prefMulti.checked ? "" : "none";

    if (!prefMulti.checked) {
      // turning off -> revert to only me
      prefs.multiUser = false;
      multiUser = false;
      const me = getUserName();
      if (me) {
        selectedTherapists = new Set([me]);
        prefs.lastViewOperators = [me];
      }
      savePrefs();
      syncOpsBar();
      render();
      return;
    }

    pickMode = "defaults";
    // Persist the toggle immediately so next login keeps it.
    prefs.multiUser = true;
    multiUser = true;
    savePrefs();
    openOpsMenu();
  });

  // Init from URL (?date=YYYY-MM-DD)
  try {
    const u = new URL(location.href);
    const d = parseYmd(u.searchParams.get("date"));
    if (d) anchorDate = d;
  } catch {}

  (async function init() {
    await ensureUserReady();
    migrateAnonStorageIfNeeded();
    loadPrefs();
    setView("week");
  })();
})();

