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

  const START_HOUR = 7;
  const END_HOUR = 21;
  let SLOT_MIN = 30; // user preference
  let SLOT_PX = 18;  // computed to fill visible height
  const NON_WORK_BG = "rgba(255,255,255,.10)"; // must match base grid background

  let view = "week"; // week | workweek
  let anchorDate = new Date();
  let rawItems = [];
  let multiUser = false; // default: show only logged-in user
  let knownTherapists = [];
  let knownByEmail = new Map(); // email -> name
  let knownEmailByName = new Map(); // name -> email
  let knownTherapistId = new Map(); // name -> collaborator record id
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
    const location = pickField(f, ["Luogo appuntamento", "Sede", "Luogo", "Location", "location_name"]) || "";

    // patient can be link-array; attempt text variants, then fallback.
    const patient =
      pickField(f, ["Paziente (testo)", "Paziente", "Patient", "patient_name", "Nome Paziente", "Cognome e Nome"]) ||
      (Array.isArray(f.Paziente) ? `Paziente (${f.Paziente[0] || ""})` : "");
    const patientId =
      Array.isArray(f.Paziente) && f.Paziente.length && typeof f.Paziente[0] === "string"
        ? String(f.Paziente[0])
        : "";

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
      patientId,
      therapist: String(therapist || "").trim(),
      service: String(service || "").trim(),
      status: String(status || "").trim(),
      location: String(location || "").trim(),
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
    const assigned = assignedColorForTherapist(name);
    if (assigned) return assigned;
    const s = String(name || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsl(${hue} 85% 62% / 0.95)`;
  }

  function alphaFromSolid(solid, alpha) {
    const a = Math.max(0, Math.min(1, Number(alpha)));
    const s = String(solid || "").trim();
    if (!s) return "";
    if (s.startsWith("#") && s.length === 7) {
      const hex = Math.round(a * 255).toString(16).padStart(2, "0");
      return `${s}${hex}`;
    }
    // hsl(... / X) -> replace alpha
    if (s.startsWith("hsl(") && s.includes("/")) {
      return s.replace(/\/\s*([0-9.]+)\s*\)/, `/ ${a})`);
    }
    // fallback: keep original (browser will ignore alpha conversion)
    return s;
  }

  function workAvailabilityBgForTherapist(name) {
    // Working availability should match operator dot color (with alpha).
    const solid = solidForTherapist(name);
    const tinted = alphaFromSolid(solid, 0.18);
    return tinted || colorForTherapist(name);
  }

  function assignedColorForTherapist(name) {
    const n = String(name || "").trim();
    if (!n) return "";
    const me = String(getUserName() || "").trim();
    if (prefs.userColor && me && n === me) return String(prefs.userColor).trim();

    const email = String(knownEmailByName.get(n) || "").trim().toLowerCase();
    if (!email) return "";
    try {
      const raw = localStorage.getItem(`fp_agenda_prefs_${email}`);
      if (!raw) return "";
      const obj = JSON.parse(raw);
      const c = String(obj?.userColor || "").trim();
      return c || "";
    } catch {
      return "";
    }
  }

  function bgForTherapist(name) {
    // Backward compat: keep using appointment tint in places that used bgForTherapist.
    const solid = solidForTherapist(name);
    const tinted = alphaFromSolid(solid, 0.22);
    return tinted || colorForTherapist(name);
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
  const AV_DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6]; // LUN..DOM (year-round template)

  function availabilityKey() {
    const email = getUserEmail() || "anon";
    return `fp_agenda_availability_${email}`;
  }

  function availabilityKeyForEmail(email) {
    const e = String(email || "").trim().toLowerCase() || "anon";
    return `fp_agenda_availability_${e}`;
  }

  function loadAvailabilityForEmail(email) {
    try {
      const raw = localStorage.getItem(availabilityKeyForEmail(email));
      if (!raw) return emptyTemplate();
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") return { ...emptyTemplate(), ...obj };
      return emptyTemplate();
    } catch {
      return emptyTemplate();
    }
  }

  function emptyTemplate() {
    const t = {};
    for (const k of DOW_KEYS) t[k] = {};
    return t;
  }

  let availability = emptyTemplate(); // { mon: { "08:00": { work:true, location:"" } } ... }
  let avSelected = new Set(); // keys "dayIndex|HH:MM" (touched in this session)
  let avPending = new Map();  // key -> { work:boolean, location:string } (preview + will be saved on OK)
  let avIsSelecting = false;
  let avLastKey = "";
  let avTimesCache = [];
  let avTimeIndex = new Map(); // "HH:MM" -> idx
  let avCellEls = new Map();   // "dayIndex|HH:MM" -> HTMLElement

  function cloneAvailability(src) {
    try {
      // structuredClone is supported in modern browsers; fallback to JSON.
      return (typeof structuredClone === "function") ? structuredClone(src) : JSON.parse(JSON.stringify(src));
    } catch {
      return emptyTemplate();
    }
  }

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

  function avGetEffective(dayIndex, time) {
    const key = avCellKey(dayIndex, time);
    if (avPending.has(key)) return avPending.get(key);
    return avGet(dayIndex, time);
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
    const v = avGetEffective(dayIndex, time);
    const key = avCellKey(dayIndex, time);
    const selected = avSelected.has(key);
    const has = Boolean(v);
    const work = v?.work === true;
    const non = v?.work === false;
    const bg = has
      ? (work
          ? workAvailabilityBgForTherapist(getUserName())
          : (non ? NON_WORK_BG : "transparent"))
      : "transparent";
    const outline = selected ? "2px solid rgba(255,255,255,.75)" : "1px solid rgba(255,255,255,.08)";
    return { bg, outline, work, has };
  }

  function currentAvChoice() {
    const work = Boolean(avTypeWork?.checked);
    const location = work ? String(avLocation?.value || "").trim() : "";
    return { work, location };
  }

  function applyPendingToCell(dayIndex, time) {
    const dow = DOW_KEYS[dayIndex] || "";
    if (!dow) return;
    const key = avCellKey(dayIndex, time);
    const next = currentAvChoice();
    avPending.set(key, { work: next.work, location: next.location });
    avSelected.add(key);
  }

  function paintAvailabilityCell(key) {
    const el = avCellEls.get(key);
    if (!el) return;
    const [dayIndexRaw, time] = String(key).split("|");
    const dayIndex = Number(dayIndexRaw);
    const st = avStyleForCell(dayIndex, time);
    el.style.background = st.bg;
    el.style.outline = st.outline;
    el.style.outlineOffset = "-1px";
    const v = avGetEffective(dayIndex, time);
    el.title = v?.location ? v.location : "";
  }

  function applyPendingKey(key) {
    const [dayIndexRaw, time] = String(key).split("|");
    const dayIndex = Number(dayIndexRaw);
    if (!Number.isFinite(dayIndex) || !time) return;
    applyPendingToCell(dayIndex, time);
    paintAvailabilityCell(key);
  }

  function keyFromPointerEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest?.('[data-day-index][data-time]');
    if (!cell) return "";
    const dayIndex = Number(cell.dataset.dayIndex);
    const time = String(cell.dataset.time || "");
    if (!Number.isFinite(dayIndex) || !time) return "";
    if (!AV_DAY_INDEXES.includes(dayIndex)) return "";
    return avCellKey(dayIndex, time);
  }

  const avGridWrap = document.querySelector("[data-av-gridwrap]");

  function renderAvailabilityGrid() {
    if (!avGrid) return;
    const times = timeSlots();
    avTimesCache = times;
    avTimeIndex = new Map(times.map((t, idx) => [t, idx]));
    avCellEls = new Map();

    // Fill visible height in the availability modal as well
    const wrapH = avGridWrap ? avGridWrap.clientHeight : 520;
    const headerPx = 54;
    const availH = Math.max(220, wrapH - headerPx);
    const rowH = Math.max(16, Math.min(44, availH / times.length));

    // grid structure
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = `76px repeat(${AV_DAY_INDEXES.length}, minmax(140px, 1fr))`;
    wrap.style.borderTop = "1px solid rgba(255,255,255,.10)";
    wrap.style.touchAction = "none"; // prevent scroll during drag on touchpads/touch

    // header row
    const corner = document.createElement("div");
    corner.style.height = "54px";
    corner.style.borderRight = "1px solid rgba(255,255,255,.10)";
    corner.style.background = "rgba(255,255,255,.03)";
    wrap.appendChild(corner);

    AV_DAY_INDEXES.forEach((dayIndex) => {
      const h = document.createElement("div");
      h.style.height = "54px";
      h.style.padding = "10px 10px";
      h.style.borderRight = "1px solid rgba(255,255,255,.10)";
      h.style.background = "rgba(255,255,255,.03)";
      const labels = ["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"];
      h.innerHTML = `<div style="font-weight:900; font-size:12px; letter-spacing:.08em; opacity:.75;">${labels[dayIndex] || ""}</div>`;
      wrap.appendChild(h);
    });

    // body rows
    times.forEach((t) => {
      const timeCell = document.createElement("div");
      timeCell.style.height = rowH + "px";
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

      AV_DAY_INDEXES.forEach((dayIndex) => {
        const cell = document.createElement("div");
        cell.dataset.dayIndex = String(dayIndex);
        cell.dataset.time = t;
        cell.style.height = rowH + "px";
        cell.style.borderRight = "1px solid rgba(255,255,255,.10)";
        cell.style.borderBottom = "1px solid rgba(255,255,255,.08)";
        cell.style.cursor = "pointer";
        cell.style.userSelect = "none";

        const st = avStyleForCell(dayIndex, t);
        cell.style.background = st.bg;
        cell.style.outline = st.outline;
        cell.style.outlineOffset = "-1px";

        // tooltip: show location if present
        const v = avGetEffective(dayIndex, t);
        if (v?.location) cell.title = v.location;

        avCellEls.set(avCellKey(dayIndex, t), cell);

        wrap.appendChild(cell);
      });
    });

    // Pointer-based selection to avoid "skipping" cells on fast drags
    wrap.onpointerdown = (e) => {
      const key = keyFromPointerEvent(e);
      if (!key) return;
      e.preventDefault();
      avIsSelecting = true;
      avLastKey = "";
      try { wrap.setPointerCapture(e.pointerId); } catch {}
      applyPendingKey(key);
      avLastKey = key;
      updateAvCount();
    };
    wrap.onpointermove = (e) => {
      if (!avIsSelecting) return;
      const key = keyFromPointerEvent(e);
      if (!key || key === avLastKey) return;

      // Fill intermediate slots if we jumped over some (same day)
      const [d0, t0] = String(avLastKey || "").split("|");
      const [d1, t1] = String(key).split("|");
      const day0 = Number(d0);
      const day1 = Number(d1);
      const i0 = avTimeIndex.get(t0);
      const i1 = avTimeIndex.get(t1);
      if (Number.isFinite(day0) && Number.isFinite(day1) && day0 === day1 && i0 != null && i1 != null) {
        const lo = Math.min(i0, i1);
        const hi = Math.max(i0, i1);
        for (let i = lo; i <= hi; i++) {
          const tt = avTimesCache[i];
          if (!tt) continue;
          applyPendingKey(avCellKey(day1, tt));
        }
      } else {
        applyPendingKey(key);
      }

      avLastKey = key;
      updateAvCount();
    };
    wrap.onpointerup = () => { avIsSelecting = false; avLastKey = ""; };
    wrap.onlostpointercapture = () => { avIsSelecting = false; avLastKey = ""; };

    avGrid.innerHTML = "";
    avGrid.appendChild(wrap);
  }

  function updateAvCount() {
    if (!avCount) return;
    const n = avPending.size;
    avCount.textContent = `${n} slot selezionat${n === 1 ? "o" : "i"}`;
  }

  function openAvailability() {
    if (!avBack) return;
    loadAvailability();
    // start from current saved availability but allow preview changes before OK
    // (pending changes live in avPending)
    void cloneAvailability(availability); // ensure clone helper is loaded (no-op)
    avSelected = new Set();
    avPending = new Map();
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
      knownTherapistId = new Map(items.map((x) => [String(x.name || "").trim(), String(x.id || "").trim()]).filter((p) => p[0] && p[1]));
      knownByEmail = new Map(items.map((x) => [String(x.email || "").trim().toLowerCase(), String(x.name || "").trim()]).filter((p) => p[0] && p[1]));
      knownEmailByName = new Map(items.map((x) => [String(x.name || "").trim(), String(x.email || "").trim().toLowerCase()]).filter((p) => p[0] && p[1]));
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
    // Make the time range fill the visible vertical space
    const outer = gridEl.parentElement; // .calGridOuter
    const outerH = outer ? outer.clientHeight : 640;
    const headerH = multiUser ? (58 + 34) : 58;
    const availH = Math.max(220, outerH - headerH);
    SLOT_PX = availH / totalSlots;
    const heightPx = totalSlots * SLOT_PX;

    const colsPerDay = multiUser ? Math.max(1, ops.length) : 1;
    const totalDayCols = days * colsPerDay;

    // Fit all columns in one viewport: shrink columns as operators grow
    gridEl.style.gridTemplateColumns = `64px repeat(${totalDayCols}, minmax(0, 1fr))`;
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
          // Only dot with initials (no full name); full name in tooltip
          cell.title = name;
          cell.style.display = "grid";
          cell.style.placeItems = "center";
          // dark divider between days (not between operators)
          const isDayBoundary = (oIdx === colsPerDay - 1) && (dIdx < days - 1);
          if (isDayBoundary) cell.style.boxShadow = "inset -2px 0 0 rgba(0,0,0,.45)";
          cell.innerHTML = `<span class="opsDot" style="width:22px;height:22px;background:${solidForTherapist(name)}">${therapistKey(name)}</span>`;
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
      const y0 = ((h - START_HOUR) * 60 / SLOT_MIN) * SLOT_PX;
      // Keep last label (END_HOUR) fully visible (avoid bottom clipping)
      const y = (h === END_HOUR) ? Math.max(0, heightPx - 14) : y0;
      const tick = document.createElement("div");
      tick.className = "timeTick";
      tick.style.top = y + "px";
      tick.textContent = `${pad2(h)}:00`;
      timeCol.appendChild(tick);
    }

    gridEl.appendChild(timeCol);

    // Availability (per operator column, using each operator's saved color)
    const me = getUserName();
    const meEmail = getUserEmail();
    const availTimes = timeSlots();

    // day/operator columns
    for (let dIdx = 0; dIdx < days; dIdx++) {
      for (let oIdx = 0; oIdx < colsPerDay; oIdx++) {
        const col = document.createElement("div");
        col.className = "dayCol";
        col.dataset.dayIndex = String(dIdx);
        const colTher = multiUser ? String(ops[oIdx] || "") : String(me || "");
        col.dataset.therapist = multiUser ? colTher : "";
        col.style.height = heightPx + "px";
        col.style.gridColumn = String(2 + dIdx * colsPerDay + oIdx);
        col.style.gridRow = multiUser ? "3" : "2";
        col.style.position = "relative";

        // dark divider between days (not between operators)
        const isDayBoundary = (oIdx === colsPerDay - 1) && (dIdx < days - 1);
        if (isDayBoundary) col.style.boxShadow = "inset -2px 0 0 rgba(0,0,0,.45)";

        const layer = document.createElement("div");
        layer.style.position = "absolute";
        layer.style.inset = "0";
        layer.style.zIndex = "0";
        layer.style.pointerEvents = "none";

        const dow = DOW_KEYS[dIdx] || "";
        const colEmail = colTher ? String(knownEmailByName.get(colTher) || "").trim().toLowerCase() : "";
        const avail = loadAvailabilityForEmail(colEmail || meEmail);
        const map = (dow && avail && avail[dow]) ? avail[dow] : null;
        if (map) {
          availTimes.forEach((t, idx) => {
            const v = map[t];
            if (!v) return;
            const work = v.work === true;
            const non = v.work === false;
            // NOTE: base grid background is already NON_WORK_BG, so don't double-tint non-working.
            const bg = work ? workAvailabilityBgForTherapist(colTher || me) : (non ? "transparent" : "transparent");
            if (bg === "transparent") return;

            const block = document.createElement("div");
            block.style.position = "absolute";
            block.style.left = "0";
            block.style.right = "0";
            block.style.top = (idx * SLOT_PX) + "px";
            block.style.height = SLOT_PX + "px";
            block.style.background = bg;
            layer.appendChild(block);
          });
        }

        col.appendChild(layer);

        // grid lines
        for (let s = 0; s <= totalSlots; s++) {
          const m = s * SLOT_MIN;
          // Keep last line visible (avoid bottom clipping)
          const y = Math.min(heightPx - 1, s * SLOT_PX);
          const line = document.createElement("div");
          line.className = "gridLine" + ((m % 60 === 0) ? " hour" : "");
          line.style.top = y + "px";
          line.style.zIndex = "1";
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

    const byId = new Map(items.map((x) => [String(x.id), x]));

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
      ev.dataset.itemId = String(it.id || "");
      ev.style.top = top + "px";
      ev.style.height = height + "px";
      ev.style.background = bgForTherapist(it.therapist);
      ev.style.zIndex = "2";

      const dot = `<span class="dot" style="background:${solidForTherapist(it.therapist)}"></span>`;
      const line = prefs.showService
        ? [it.service, it.status].filter(Boolean).join(" • ")
        : [it.status].filter(Boolean).join(" • ");

      ev.innerHTML = `
        <div class="t">${it.patient || "Appuntamento"}</div>
        <div class="m">${line}</div>
        <div class="b">${dot}<span>${therapistKey(it.therapist) || it.therapist || ""}</span><span style="margin-left:auto; opacity:.8;">${pad2(it.startAt.getHours())}:${pad2(it.startAt.getMinutes())}</span></div>
      `;
      ev.onclick = (e) => {
        e.stopPropagation();
        openDetailsModal(it);
      };

      col.appendChild(ev);
    });

    // Slot hover + click to create
    ensureSlotUx({ weekStart: start, days, byId, items });
  }

  // ========= Hover preview (slot + appointment) =========
  const hoverCard = (function buildHoverCard() {
    const el = document.createElement("div");
    el.className = "oe-hovercard";
    el.style.display = "none";
    el.innerHTML = `
      <div class="oe-hovercard__title" data-hc-title></div>
      <div class="oe-hovercard__row" data-hc-time-row><span class="oe-dot"></span><span data-hc-time></span></div>
      <div class="oe-hovercard__row" data-hc-service-row style="display:none;">
        <span class="oe-ic">🏷️</span><span data-hc-service></span>
      </div>
      <div class="oe-hovercard__row" data-hc-ther-row style="display:none;">
        <span class="oe-ic">👤</span><span data-hc-ther></span>
      </div>
      <div class="oe-hovercard__row" data-hc-status-row style="display:none;">
        <span class="oe-dot oe-dot--warn"></span><span data-hc-status></span>
      </div>
      <div class="oe-hovercard__row" data-hc-loc-row style="display:none;">
        <span class="oe-ic">📍</span><span data-hc-loc></span>
      </div>
      <div class="oe-hovercard__note" data-hc-note style="display:none;"></div>
    `;
    document.body.appendChild(el);
    return el;
  })();

  function showHover(x, y, data) {
    hoverCard.style.left = (x + 12) + "px";
    hoverCard.style.top = (y + 12) + "px";
    hoverCard.querySelector("[data-hc-title]").textContent = data.title || "";
    const timeRow = hoverCard.querySelector("[data-hc-time-row]");
    if (data.time) {
      timeRow.style.display = "";
      hoverCard.querySelector("[data-hc-time]").textContent = data.time || "";
    } else {
      timeRow.style.display = "none";
      hoverCard.querySelector("[data-hc-time]").textContent = "";
    }

    const statusRow = hoverCard.querySelector("[data-hc-status-row]");
    const serviceRow = hoverCard.querySelector("[data-hc-service-row]");
    const therRow = hoverCard.querySelector("[data-hc-ther-row]");
    const locRow = hoverCard.querySelector("[data-hc-loc-row]");
    const noteEl = hoverCard.querySelector("[data-hc-note]");

    if (data.status) { statusRow.style.display=""; hoverCard.querySelector("[data-hc-status]").textContent = data.status; }
    else statusRow.style.display="none";
    if (data.service) { serviceRow.style.display=""; hoverCard.querySelector("[data-hc-service]").textContent = data.service; }
    else serviceRow.style.display="none";
    if (data.therapist) { therRow.style.display=""; hoverCard.querySelector("[data-hc-ther]").textContent = data.therapist; }
    else therRow.style.display="none";
    if (data.location) { locRow.style.display=""; hoverCard.querySelector("[data-hc-loc]").textContent = data.location; }
    else locRow.style.display="none";
    if (data.note) { noteEl.style.display=""; noteEl.textContent = data.note; }
    else noteEl.style.display="none";

    hoverCard.style.display = "block";
  }

  function hideHover() {
    hoverCard.style.display = "none";
  }

  // ========= Create appointment modal (dark, gestionale style) =========
  const createModal = (function buildCreateModal() {
    const wrap = document.createElement("div");
    wrap.className = "prefsBack";
    wrap.style.display = "none";
    wrap.style.zIndex = "120";
    wrap.innerHTML = `
      <div class="prefsPanel" role="dialog" aria-modal="true" style="width: 1100px; max-width: 96vw;">
        <div class="prefsHead">
          <div class="prefsTitle"><span style="font-size:18px;">🗓️</span> Nuovo appuntamento</div>
          <button class="btn" data-cm-close>Chiudi</button>
        </div>
        <div class="prefsBody">
          <div class="prefsSub" data-cm-sub style="margin-top:0; margin-bottom:14px;">—</div>

          <div class="formgrid">
            <div class="field">
              <label>Tipologia</label>
              <select class="select" data-cm-type style="height:44px; font-size:16px; padding: 10px 12px;">
                <option value="Appuntamento paziente">Appuntamento paziente</option>
                <option value="Visita ortopedica">Visita ortopedica</option>
                <option value="Altro">Altro</option>
              </select>
            </div>

            <div class="field" style="position:relative;">
              <label>Paziente</label>
              <input class="input" data-cm-patient placeholder="Cerca paziente..." autocomplete="off" />
              <div data-cm-patient-results style="position:absolute; left:0; right:0; top: 72px; z-index: 5; display:none; border:1px solid rgba(255,255,255,.12); border-radius: 12px; background: rgba(15,26,44,.98); overflow:hidden;"></div>
            </div>

            <div class="field">
              <label>Luogo appuntamento</label>
              <input class="input" data-cm-location placeholder="Es. SEDE DI BOLOGNA" />
            </div>

            <div class="field" style="grid-column:1/-1;">
              <label>Voce prezzario</label>
              <input class="input" data-cm-service placeholder="Es. SEDUTA DI FISIOTERAPIA" />
            </div>

            <div class="field">
              <label>Durata</label>
              <select class="select" data-cm-duration style="height:44px; font-size:16px; padding: 10px 12px;">
                <option value="30">30 minuti</option>
                <option value="60">60 minuti</option>
                <option value="90">90 minuti</option>
                <option value="120">120 minuti</option>
              </select>
            </div>

            <div class="field">
              <label>Agenda</label>
              <select class="select" data-cm-operator style="height:44px; font-size:16px; padding: 10px 12px;"></select>
            </div>

            <div class="field">
              <label>Conferme</label>
              <div style="display:flex; flex-direction:column; gap:10px; padding: 10px 0;">
                <label style="display:flex; gap:10px; align-items:center; color: rgba(255,255,255,.85);">
                  <input type="checkbox" data-cm-conf-pat />
                  <span>Confermato dal paziente</span>
                </label>
                <label style="display:flex; gap:10px; align-items:center; color: rgba(255,255,255,.85);">
                  <input type="checkbox" data-cm-conf-plat />
                  <span>Conferma in piattaforma</span>
                </label>
              </div>
            </div>

            <div class="field" style="grid-column:1/-1;">
              <label>Note interne</label>
              <textarea class="textarea" data-cm-internal maxlength="255"></textarea>
            </div>
            <div class="field" style="grid-column:1/-1;">
              <label>Note visibili al paziente</label>
              <textarea class="textarea" data-cm-patient-note maxlength="255"></textarea>
            </div>
          </div>
        </div>
        <div class="prefsFoot">
          <button class="btn" data-cm-cancel>Annulla</button>
          <button class="btn primary" data-cm-save>Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    return wrap;
  })();

  let cmState = { startIso: "", dayLabel: "", timeLabel: "", patientId: "", patientName: "" };

  function closeCreateModal() {
    createModal.style.display = "none";
  }

  async function saveCreateModal() {
    const type = createModal.querySelector("[data-cm-type]").value;
    const duration = Number(createModal.querySelector("[data-cm-duration]").value || 30);
    const location = String(createModal.querySelector("[data-cm-location]").value || "").trim();
    const service_name = String(createModal.querySelector("[data-cm-service]").value || "").trim();
    const operatorName = createModal.querySelector("[data-cm-operator]").value;
    const operatorId = knownTherapistId.get(operatorName) || "";
    const internal_note = String(createModal.querySelector("[data-cm-internal]").value || "").trim();
    const patient_note = String(createModal.querySelector("[data-cm-patient-note]").value || "").trim();
    const confirmed_by_patient = Boolean(createModal.querySelector("[data-cm-conf-pat]").checked);
    const confirmed_in_platform = Boolean(createModal.querySelector("[data-cm-conf-plat]").checked);

    if (!cmState.startIso) return alert("Orario non valido.");
    if (!cmState.patientId) return alert("Seleziona un paziente.");
    if (!operatorName) return alert("Seleziona un operatore.");

    const btn = createModal.querySelector("[data-cm-save]");
    btn.disabled = true;
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_at: cmState.startIso,
          duration_min: duration,
          patient_id: cmState.patientId,
          operator_id: operatorId,
          operator_name: operatorName,
          location_name: location,
          type,
          service_name,
          confirmed_by_patient,
          confirmed_in_platform,
          internal_note,
          patient_note,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Errore creazione appuntamento");
      toast?.("Salvato");
      closeCreateModal();
      await load();
    } catch (e) {
      console.error(e);
      alert("Errore salvataggio appuntamento. Controlla Console/Network.");
    } finally {
      btn.disabled = false;
    }
  }

  function openCreateModal({ dateObj, timeStr, therapistName }) {
    const sub = createModal.querySelector("[data-cm-sub]");
    const opSel = createModal.querySelector("[data-cm-operator]");

    // Local datetime -> ISO
    const ymd = toYmd(dateObj);
    const startLocal = new Date(`${ymd}T${timeStr}:00`);
    cmState = { startIso: startLocal.toISOString(), dayLabel: ymd, timeLabel: timeStr, patientId: "", patientName: "" };

    const fmt = new Intl.DateTimeFormat("it-IT", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" });
    sub.textContent = `${fmt.format(dateObj)} ${timeStr}`;

    // default location from operator's availability template (if any)
    const dow = DOW_KEYS[(dateObj.getDay() + 6) % 7] || ""; // mon..sun
    const email = therapistName ? String(knownEmailByName.get(therapistName) || "").trim().toLowerCase() : getUserEmail();
    const avail = loadAvailabilityForEmail(email);
    const av = dow ? avail?.[dow]?.[timeStr] : null;
    createModal.querySelector("[data-cm-location]").value = av?.location || "";

    // operator options
    opSel.innerHTML = "";
    const names = knownTherapists.slice();
    names.forEach((n) => {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      opSel.appendChild(o);
    });
    const me = getUserName();
    opSel.value = therapistName || (me && names.includes(me) ? me : (names[0] || ""));

    // reset patient fields
    const pIn = createModal.querySelector("[data-cm-patient]");
    pIn.value = "";
    createModal.querySelector("[data-cm-internal]").value = "";
    createModal.querySelector("[data-cm-patient-note]").value = "";
    createModal.querySelector("[data-cm-service]").value = "";
    createModal.querySelector("[data-cm-conf-pat]").checked = false;
    createModal.querySelector("[data-cm-conf-plat]").checked = false;

    createModal.style.display = "block";
  }

  // Patient search dropdown
  let patientTimer = null;
  async function searchPatients(q) {
    const url = `/api/airtable?op=searchPatients&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { credentials: "include" });
    const data = await r.json().catch(() => ({}));
    return data?.items || [];
  }

  function bindCreateModalEvents() {
    createModal.querySelector("[data-cm-close]").onclick = closeCreateModal;
    createModal.querySelector("[data-cm-cancel]").onclick = closeCreateModal;
    createModal.onclick = (e) => { if (e.target === createModal) closeCreateModal(); };
    createModal.querySelector("[data-cm-save]").onclick = saveCreateModal;

    const pIn = createModal.querySelector("[data-cm-patient]");
    const results = createModal.querySelector("[data-cm-patient-results]");

    function hideResults() { results.style.display = "none"; results.innerHTML = ""; }

    pIn.addEventListener("input", () => {
      const q = String(pIn.value || "").trim();
      cmState.patientId = "";
      cmState.patientName = "";
      if (patientTimer) clearTimeout(patientTimer);
      if (!q) return hideResults();
      patientTimer = setTimeout(async () => {
        try {
          const items = await searchPatients(q);
          results.innerHTML = "";
          items.slice(0, 8).forEach((it) => {
            const row = document.createElement("div");
            row.style.padding = "10px 12px";
            row.style.cursor = "pointer";
            row.style.borderBottom = "1px solid rgba(255,255,255,.08)";
            row.innerHTML = `<div style="font-weight:900;">${it.name || "Paziente"}</div>
                             <div style="font-size:12px;opacity:.7;">${[it.phone, it.email].filter(Boolean).join(" • ")}</div>`;
            row.onclick = () => {
              cmState.patientId = it.id;
              cmState.patientName = it.name || "";
              pIn.value = cmState.patientName;
              hideResults();
            };
            results.appendChild(row);
          });
          if (!items.length) {
            const row = document.createElement("div");
            row.style.padding = "10px 12px";
            row.style.opacity = ".75";
            row.textContent = "Nessun risultato";
            results.appendChild(row);
          }
          results.style.display = "block";
        } catch {
          hideResults();
        }
      }, 180);
    });

    pIn.addEventListener("blur", () => setTimeout(hideResults, 150));
  }

  bindCreateModalEvents();

  // ========= Details appointment modal (dark, gestionale style) =========
  const detailsModal = (function buildDetailsModal() {
    const wrap = document.createElement("div");
    wrap.className = "prefsBack";
    wrap.style.display = "none";
    wrap.style.zIndex = "120";
    wrap.innerHTML = `
      <div class="prefsPanel" role="dialog" aria-modal="true" style="width: 1100px; max-width: 96vw;">
        <div class="prefsHead">
          <div class="prefsTitle"><span style="font-size:18px;">🗓️</span> Dettagli appuntamento</div>
          <button class="btn" data-dm-close>Chiudi</button>
        </div>
        <div class="prefsBody">
          <div class="prefsCard" style="margin-bottom:14px;">
            <div style="display:flex; gap:12px; justify-content:space-between; align-items:flex-start; flex-wrap:wrap;">
              <div style="min-width:0;">
                <div style="font-weight:900; font-size:18px;" data-dm-patient>—</div>
                <div style="margin-top:6px; color: rgba(255,255,255,.75);" data-dm-when>—</div>
                <div style="margin-top:6px; color: rgba(255,255,255,.75);">
                  Operatore: <strong data-dm-ther>—</strong> • Luogo: <strong data-dm-loc>—</strong>
                </div>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <a class="btn" data-dm-call href="#" style="text-decoration:none; display:none;">CHIAMA</a>
                <a class="btn" data-dm-whatsapp href="#" style="text-decoration:none; display:none;">WHATSAPP</a>
                <a class="btn" data-dm-email href="#" style="text-decoration:none; display:none;">EMAIL</a>
              </div>
            </div>
          </div>

          <div class="formgrid">
            <div class="field" style="grid-column:1/-1;">
              <label>Voce prezzario</label>
              <input class="input" data-dm-service-in />
            </div>

            <div class="field">
              <label>Esito appuntamento</label>
              <input class="input" data-dm-status />
            </div>

            <div class="field">
              <label>Durata (min)</label>
              <select class="select" data-dm-duration style="height:44px; font-size:16px; padding: 10px 12px;">
                <option value="30">30</option>
                <option value="60">60</option>
                <option value="90">90</option>
                <option value="120">120</option>
              </select>
            </div>

            <div class="field">
              <label>Agenda</label>
              <select class="select" data-dm-operator style="height:44px; font-size:16px; padding: 10px 12px;"></select>
            </div>

            <div class="field">
              <label>Luogo appuntamento</label>
              <input class="input" data-dm-location />
            </div>

            <div class="field" style="grid-column:1/-1;">
              <label>Conferme</label>
              <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;padding: 8px 0;">
                <label style="display:flex;gap:10px;align-items:center;color: rgba(255,255,255,.85);">
                  <input type="checkbox" data-dm-conf-pat />
                  <span>Confermato dal paziente</span>
                </label>
                <label style="display:flex;gap:10px;align-items:center;color: rgba(255,255,255,.85);">
                  <input type="checkbox" data-dm-conf-plat />
                  <span>Conferma in piattaforma</span>
                </label>
              </div>
            </div>

            <div class="field" style="grid-column:1/-1;">
              <label>Note interne</label>
              <textarea class="textarea" data-dm-internal maxlength="255"></textarea>
            </div>
            <div class="field" style="grid-column:1/-1;">
              <label>Note visibili al paziente</label>
              <textarea class="textarea" data-dm-patient-note maxlength="255"></textarea>
            </div>
          </div>
        </div>
        <div class="prefsFoot">
          <button class="btn" data-dm-cancel>Annulla</button>
          <button class="btn primary" data-dm-save>Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    return wrap;
  })();

  let dmItem = null;
  function closeDetailsModal() { detailsModal.style.display = "none"; dmItem = null; }

  async function openDetailsModal(it) {
    dmItem = it;
    const st = it.startAt ? it.startAt.toLocaleString("it-IT", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    detailsModal.querySelector("[data-dm-patient]").textContent = it.patient || "Paziente";
    detailsModal.querySelector("[data-dm-when]").textContent = st;
    detailsModal.querySelector("[data-dm-ther]").textContent = it.therapist ? `Dott. ${it.therapist}` : "—";
    detailsModal.querySelector("[data-dm-loc]").textContent = it.location || "—";

    // top chip
    const chip = detailsModal.querySelector("[data-dm-service]");
    chip.textContent = it.service || "—";

    // form defaults
    detailsModal.querySelector("[data-dm-service-in]").value = it.service || "";
    detailsModal.querySelector("[data-dm-status]").value = it.status || "";
    detailsModal.querySelector("[data-dm-location]").value = it.location || "";
    detailsModal.querySelector("[data-dm-internal]").value = "";
    detailsModal.querySelector("[data-dm-patient-note]").value = "";
    detailsModal.querySelector("[data-dm-conf-pat]").checked = false;
    detailsModal.querySelector("[data-dm-conf-plat]").checked = false;

    // duration best-effort
    let dur = 30;
    if (it.startAt && it.endAt) {
      const d = Math.max(15, Math.round((it.endAt.getTime() - it.startAt.getTime()) / 60000));
      dur = [30, 60, 90, 120].includes(d) ? d : 30;
    }
    detailsModal.querySelector("[data-dm-duration]").value = String(dur);

    // operator options
    const opSel = detailsModal.querySelector("[data-dm-operator]");
    opSel.innerHTML = "";
    knownTherapists.forEach((n) => {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      opSel.appendChild(o);
    });
    opSel.value = it.therapist || getUserName() || (knownTherapists[0] || "");

    // patient contact (fetch from /api/patient if we have a linked id)
    const callA = detailsModal.querySelector("[data-dm-call]");
    const waA = detailsModal.querySelector("[data-dm-whatsapp]");
    const emA = detailsModal.querySelector("[data-dm-email]");
    callA.style.display = "none";
    waA.style.display = "none";
    emA.style.display = "none";
    try {
      if (it.patientId) {
        const r = await fetch(`/api/patient?id=${encodeURIComponent(it.patientId)}`, { credentials: "include" });
        const p = await r.json().catch(() => ({}));
        const tel = String(p.Telefono || "").trim();
        const email = String(p.Email || "").trim();
        if (tel) {
          callA.href = `tel:${tel}`;
          callA.textContent = `CHIAMA ${tel}`;
          callA.style.display = "";
          waA.href = `https://wa.me/${tel.replace(/[^\d]/g, "")}`;
          waA.textContent = "WHATSAPP";
          waA.style.display = "";
        }
        if (email) {
          emA.href = `mailto:${email}`;
          emA.textContent = email.toUpperCase();
          emA.style.display = "";
        }
      }
    } catch {}

    detailsModal.style.display = "block";
  }

  async function saveDetailsModal() {
    if (!dmItem) return closeDetailsModal();
    const btn = detailsModal.querySelector("[data-dm-save]");
    btn.disabled = true;
    try {
      const payload = {
        service_name: String(detailsModal.querySelector("[data-dm-service-in]").value || ""),
        status: String(detailsModal.querySelector("[data-dm-status]").value || ""),
        location_name: String(detailsModal.querySelector("[data-dm-location]").value || ""),
        duration_min: Number(detailsModal.querySelector("[data-dm-duration]").value || 30),
        confirmed_by_patient: Boolean(detailsModal.querySelector("[data-dm-conf-pat]").checked),
        confirmed_in_platform: Boolean(detailsModal.querySelector("[data-dm-conf-plat]").checked),
        internal_note: String(detailsModal.querySelector("[data-dm-internal]").value || ""),
        patient_note: String(detailsModal.querySelector("[data-dm-patient-note]").value || ""),
      };
      const r = await fetch(`/api/appointments?id=${encodeURIComponent(dmItem.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Errore aggiornamento");
      toast?.("Salvato");
      closeDetailsModal();
      await load();
    } catch (e) {
      console.error(e);
      alert("Errore salvataggio. Controlla Console/Network.");
    } finally {
      btn.disabled = false;
    }
  }

  // bind details modal events
  detailsModal.querySelector("[data-dm-close]").onclick = closeDetailsModal;
  detailsModal.querySelector("[data-dm-cancel]").onclick = closeDetailsModal;
  detailsModal.querySelector("[data-dm-save]").onclick = saveDetailsModal;
  detailsModal.onclick = (e) => { if (e.target === detailsModal) closeDetailsModal(); };

  // ========= Slot UX wiring =========
  let slotUxBound = false;
  let slotCtx = { weekStart: new Date(), days: 7, byId: new Map(), items: [] };
  function ensureSlotUx(ctx) {
    slotCtx = ctx || slotCtx;
    if (slotUxBound) return;
    slotUxBound = true;

    let slotHl = document.createElement("div");
    slotHl.style.position = "absolute";
    slotHl.style.left = "6px";
    slotHl.style.right = "6px";
    slotHl.style.borderRadius = "10px";
    slotHl.style.background = "rgba(34,230,195,.08)";
    slotHl.style.outline = "1px solid rgba(34,230,195,.22)";
    slotHl.style.pointerEvents = "none";
    slotHl.style.zIndex = "1";
    slotHl.style.display = "none";
    let slotHlCol = null;

    function highlightSlot(col, idx) {
      if (!col) return;
      if (slotHlCol !== col) {
        try { slotHl.remove(); } catch {}
        slotHlCol = col;
        col.appendChild(slotHl);
      }
      slotHl.style.top = (idx * SLOT_PX) + "px";
      slotHl.style.height = SLOT_PX + "px";
      slotHl.style.display = "block";
    }

    function findItemAt(dayIndex, therapistName, minutes) {
      const list = slotCtx.items || [];
      for (const it of list) {
        if (!it || it._dayIndex !== dayIndex) continue;
        if (therapistName && it.therapist && it.therapist !== therapistName) continue;
        if (!it.startAt) continue;
        const st = minutesOfDay(it.startAt);
        let en = st + 30;
        if (it.endAt) en = minutesOfDay(it.endAt);
        if (minutes >= st && minutes < en) return it;
      }
      return null;
    }

    document.addEventListener("mousemove", (e) => {
      const t = e.target;
      const ev = t?.closest?.(".event");
      if (ev) {
        const id = String(ev.dataset.itemId || "");
        const it = slotCtx.byId?.get(id) || null;
        if (!it || !it.startAt) return hideHover();
        const st = it.startAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
        // Highlight the slot where the appointment starts
        const col = ev.closest?.(".dayCol");
        if (col) {
          const idx = Math.max(0, Math.floor((minutesOfDay(it.startAt) - START_HOUR * 60) / SLOT_MIN));
          highlightSlot(col, idx);
        }
        showHover(e.clientX, e.clientY, {
          title: it.patient || "Paziente",
          time: st,
          service: it.service || "",
          therapist: it.therapist ? `Dott. ${it.therapist}` : "",
          status: it.status || "",
          location: it.location || "",
          note: "",
        });
        return;
      }

      const col = t?.closest?.(".dayCol");
      if (!col) return hideHover();

      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y < 0) return hideHover();

      const totalMin = (END_HOUR - START_HOUR) * 60;
      const totalSlots = Math.ceil(totalMin / SLOT_MIN);
      const idx = Math.max(0, Math.min(totalSlots - 1, Math.floor(y / SLOT_PX)));
      const minutes = START_HOUR * 60 + idx * SLOT_MIN;
      const timeStr = `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

      const dayIndex = Number(col.dataset.dayIndex || "0");
      const d = addDays(slotCtx.weekStart, dayIndex);
      highlightSlot(col, idx);

      const therapistName = multiUser ? String(col.dataset.therapist || "") : getUserName();
      const existing = findItemAt(dayIndex, therapistName, minutes);

      // availability location preview
      const dow = DOW_KEYS[dayIndex] || "";
      const email = therapistName ? String(knownEmailByName.get(therapistName) || "").trim().toLowerCase() : getUserEmail();
      const avail = loadAvailabilityForEmail(email);
      const av = dow ? avail?.[dow]?.[timeStr] : null;
      const loc = av?.location || "";

      if (existing && existing.startAt) {
        const st = existing.startAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
        showHover(e.clientX, e.clientY, {
          title: existing.patient || "Paziente",
          time: st,
          service: existing.service || "",
          therapist: existing.therapist ? `Dott. ${existing.therapist}` : "",
          status: existing.status || "",
          location: existing.location || loc || "",
          note: "",
        });
      } else {
        showHover(e.clientX, e.clientY, {
          title: timeStr,
          time: "",
          location: loc ? loc : "",
        });
      }
    });

    document.addEventListener("mouseleave", () => { hideHover(); slotHl.style.display = "none"; });

    document.addEventListener("click", (e) => {
      const t = e.target;
      // don't hijack clicks on buttons/modals
      if (t?.closest?.(".oe-modal") || t?.closest?.(".prefsPanel") || t?.closest?.(".opsMenu")) return;

      const ev = t?.closest?.(".event");
      if (ev) return; // existing appointment opens its own modal via onclick

      const col = t?.closest?.(".dayCol");
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y < 0) return;

      const totalMin = (END_HOUR - START_HOUR) * 60;
      const totalSlots = Math.ceil(totalMin / SLOT_MIN);
      const idx = Math.max(0, Math.min(totalSlots - 1, Math.floor(y / SLOT_PX)));
      const minutes = START_HOUR * 60 + idx * SLOT_MIN;
      const timeStr = `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

      const dayIndex = Number(col.dataset.dayIndex || "0");
      const d = addDays(slotCtx.weekStart, dayIndex);

      const therapistName = multiUser ? String(col.dataset.therapist || "") : getUserName();
      const existing = (function () {
        const list = slotCtx.items || [];
        for (const it of list) {
          if (!it || it._dayIndex !== dayIndex) continue;
          if (therapistName && it.therapist && it.therapist !== therapistName) continue;
          if (!it.startAt) continue;
          const st = minutesOfDay(it.startAt);
          let en = st + 30;
          if (it.endAt) en = minutesOfDay(it.endAt);
          if (minutes >= st && minutes < en) return it;
        }
        return null;
      })();

      if (existing) openDetailsModal(existing);
      else openCreateModal({ dateObj: d, timeStr, therapistName });
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
    if (!avPending.size) return closeAvailability();
    // Commit pending changes (per-slot type + location) to the year-round template.
    for (const [key, v] of avPending.entries()) {
      avSetMany([key], { work: v.work, location: v.work ? String(v.location || "").trim() : "" });
    }
    saveAvailability();
    avSelected = new Set();
    avPending = new Map();
    updateAvCount();
    renderAvailabilityGrid();
    closeAvailability();
    render();
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

