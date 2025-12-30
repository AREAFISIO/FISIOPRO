// Diary (agenda) renderer: week grid similar to OsteoEasy,
// but styled using the existing app.css tokens.
(function () {
  if (typeof window.fpDiaryInit === "function") return;

  window.fpDiaryInit = function fpDiaryInit() {
    // Cleanup previous init (SPA navigation back/forth)
    try {
      if (typeof window.__FP_DIARY_CLEANUP === "function") window.__FP_DIARY_CLEANUP();
    } catch {}
    window.__FP_DIARY_CLEANUP = null;

    // build marker (helps verify cache busting)
    console.log("FISIOPRO diary build", "2b3c1d2");
    const root = document.querySelector("[data-diary]");
    if (!root) return;

  const gridEl = document.querySelector("[data-cal-grid]");
  const qEl = document.querySelector("[data-cal-q]");
  const rangeEl = document.querySelector("[data-cal-range]");
  const monthEl = document.querySelector("[data-cal-month]");
  const weekEl = document.querySelector("[data-cal-week]");
  const loginNameEl = document.querySelector("[data-login-name]");
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
  // SLOT_PX is dynamically adjusted to fill available vertical space.
  // Default is 18px (good density on laptops).
  let SLOT_PX = 18;
  // Small visual breathing room above/below the time range.
  // This affects the grid row height and all y-coordinate calculations.
  const GRID_PAD_TOP = 10;
  const GRID_PAD_BOTTOM = 12;

  let view = "7days"; // 7days | 5days | day
  let anchorDate = new Date();
  let rawItems = [];
  let multiUser = false; // default: show only logged-in user
  let knownTherapists = [];
  let knownByEmail = new Map(); // email -> name
  let knownOperators = []; // [{id,name,email,...}] from /api/operators
  let operatorNameToId = new Map(); // name -> recId
  let operatorNameToRole = new Map(); // name -> role label
  let locationsCache = null; // [{id,name}]
  let servicesCache = null; // [{id,name}]
  let treatmentsCache = null; // [{id,name}]
  const patientLinksCache = {
    evaluations: new Map(), // patientId -> items
    cases: new Map(),
    sales: new Map(),
    erogato: new Map(),
  };
  let insuranceCache = new Map(); // patientId -> string
  let patientSearchCache = new Map(); // qLower -> [{id,label,phone,email}]
  let selectedTherapists = new Set();
  let draftSelected = new Set();
  let pickMode = "view"; // view | defaults
  let didApplyDefaultSelectionOnce = false;

  // Hover card (info rapida)
  const hoverCard = document.createElement("div");
  hoverCard.className = "fpHover";
  document.body.appendChild(hoverCard);
  function hideHover() { hoverCard.style.display = "none"; }

  // Hover card per SLOT (preview quando passi sulla griglia vuota)
  // Stile "OsteoEasy-like" (card chiara) usando le classi già presenti in app.css.
  const slotHoverCard = document.createElement("div");
  slotHoverCard.className = "oe-hovercard fpSlotHoverCard";
  slotHoverCard.style.display = "none";
  slotHoverCard.setAttribute("aria-hidden", "true");
  slotHoverCard.innerHTML = `
    <div class="oe-hovercard__row"><span class="oe-ic">🕒</span><span data-slot-time></span></div>
    <div class="oe-hovercard__row"><span class="oe-ic">👤</span><span data-slot-ther></span></div>
    <div class="oe-hovercard__row"><span class="oe-ic">📍</span><span data-slot-loc></span></div>
  `;
  document.body.appendChild(slotHoverCard);

  function hideSlotHover() {
    slotHoverCard.style.display = "none";
    slotHoverCard.setAttribute("aria-hidden", "true");
  }

  function showSlotHover(ctx, x, y) {
    if (!ctx) return;
    if (modalBack && modalBack.style.display !== "none") return;

    const time = String(ctx.time || "").trim() || "—";
    const ther = String(ctx.therapist || "").trim() || "—";
    const loc = String(ctx.location || "").trim() || "—";

    slotHoverCard.querySelector("[data-slot-time]").textContent = time;
    slotHoverCard.querySelector("[data-slot-ther]").textContent = ther;
    slotHoverCard.querySelector("[data-slot-loc]").textContent = loc;

    const left = Math.min(window.innerWidth - 280, x + 12);
    const top = Math.min(window.innerHeight - 140, y + 12);
    slotHoverCard.style.left = Math.max(12, left) + "px";
    slotHoverCard.style.top = Math.max(12, top) + "px";
    slotHoverCard.style.display = "block";
    slotHoverCard.setAttribute("aria-hidden", "false");
  }
  function showHover(item, x, y) {
    if (!item) return;
    if (modalBack && modalBack.style.display !== "none") return;
    // se stai hoverando un evento, nascondi il tooltip slot per non sovrapporre
    hideSlotHover();

    const startStr = item.startAt ? item.startAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
    const endStr = item.endAt ? item.endAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
    const when = startStr + (endStr ? " → " + endStr : "");

    const sede = pickField(item.fields || {}, ["Sede", "Sedi", "Sede appuntamento", "Location", "Luogo", "Sede Bologna"]);
    const note = pickField(item.fields || {}, ["Note interne", "Note", "Nota", "Note interne (preview)", "Note paziente"]);
    const opRole = roleForOperatorName(item.therapist);

    const roleRaw = String((window.FP_USER?.role || window.FP_SESSION?.role || "")).toLowerCase();
    const canSeeInsurance = roleRaw.includes("front") || roleRaw.includes("manager") || roleRaw.includes("admin") || roleRaw.includes("amministr");
    const insurance = canSeeInsurance && item.patientId ? (insuranceCache.get(item.patientId) || "Carico…") : "";

    hoverCard.dataset.patientId = String(item.patientId || "");
    hoverCard.innerHTML = `
      <div class="t">${item.patient || "Appuntamento"}</div>
      <div class="r"><span class="k">Orario</span><span>${when || "—"}</span></div>
      <div class="r"><span class="k">Stato</span><span>${item.status || "—"}</span></div>
      ${canSeeInsurance ? `<div class="r"><span class="k">Assicurazione</span><span>${insurance || "—"}</span></div>` : ""}
      <div class="r"><span class="k">Operatore</span><span>${item.therapist || "—"}${opRole ? " • " + opRole : ""}</span></div>
      <div class="r"><span class="k">Sede</span><span>${sede ? String(sede) : "—"}</span></div>
      <div class="note">${note ? String(note) : ""}</div>
    `;
    hoverCard.querySelector(".note").style.display = note ? "" : "none";

    // Lazy-load insurance/practice label (front/manager only)
    if (canSeeInsurance && item.patientId && !insuranceCache.has(item.patientId)) {
      insuranceCache.set(item.patientId, "Carico…");
      fetch(`/api/insurance?patientId=${encodeURIComponent(item.patientId)}`, { credentials: "include" })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => {
          if (!ok) throw new Error(j?.error || "insurance_error");
          const first = (j.items || [])[0] || null;
          const label = String(first?.pratica || first?.stato || "").trim();
          insuranceCache.set(item.patientId, label || "—");
          if (hoverCard.style.display === "block" && hoverCard.dataset.patientId === String(item.patientId)) {
            // aggiorna al volo la riga assicurazione (2° span dell'ultima riga assicurazione)
            const rows = hoverCard.querySelectorAll(".r");
            rows.forEach((r) => {
              const k = r.querySelector(".k")?.textContent || "";
              if (k.trim().toLowerCase() === "assicurazione") {
                const spans = r.querySelectorAll("span");
                if (spans[1]) spans[1].textContent = (label || "—");
              }
            });
          }
        })
        .catch(() => {
          insuranceCache.set(item.patientId, "—");
        });
    }

    const left = Math.min(window.innerWidth - 340, x + 12);
    const top = Math.min(window.innerHeight - 180, y + 12);
    hoverCard.style.left = Math.max(12, left) + "px";
    hoverCard.style.top = Math.max(12, top) + "px";
    hoverCard.style.display = "block";
  }

  // Preferences
  const prefsBack = document.querySelector("[data-prefs-back]");
  const prefsClose = document.querySelector("[data-prefs-close]");
  const prefsSave = document.querySelector("[data-prefs-save]");
  const prefsReset = document.querySelector("[data-prefs-reset]");
  const prefSlot = document.querySelector("[data-pref-slot]");
  const prefColor = document.querySelector("[data-pref-color]");
  const prefMulti = document.querySelector("[data-pref-multi]");
  const prefDefaultSection = document.querySelector("[data-pref-default-section]");
  const prefDefaultDots = document.querySelector("[data-pref-default-dots]");
  const prefPick = document.querySelector("[data-pref-pick]");
  const prefDefaultPicker = document.querySelector("[data-pref-default-picker]");
  const prefDefaultList = document.querySelector("[data-pref-default-list]");
  const prefDefaultSearch = document.querySelector("[data-pref-default-search]");
  const prefDefaultClose = document.querySelector("[data-pref-default-close]");
  const prefDoubleSection = document.querySelector("[data-pref-double-section]");
  const prefDoubleDots = document.querySelector("[data-pref-double-dots]");
  const prefDoublePick = document.querySelector("[data-pref-double-pick]");
  const prefDoublePicker = document.querySelector("[data-pref-double-picker]");
  const prefDoubleList = document.querySelector("[data-pref-double-list]");
  const prefDoubleSearch = document.querySelector("[data-pref-double-search]");
  const prefDoubleClose = document.querySelector("[data-pref-double-close]");
  const prefShowService = document.querySelector("[data-pref-show-service]");
  const prefDayNav = document.querySelector("[data-pref-day-nav]");

  let prefs = {
    slotMin: 30,
    multiUser: false,
    defaultOperators: [],
    doubleOperators: [],
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
  function toLocalDateTimeISO(dt) {
    // Airtable accetta ISO; usiamo toISOString (UTC) per coerenza
    return dt instanceof Date ? dt.toISOString() : "";
  }

  function pickField(fields, keys) {
    for (const k of keys) {
      if (fields && fields[k] != null && String(fields[k]).trim() !== "") return fields[k];
    }
    return "";
  }

  // --- Sede / Location inference (per tooltip sugli slot) ---
  // Non abbiamo (ancora) una select Sede nel modal di creazione; perciò, per lo slot
  // stimiamo la sede più probabile guardando gli appuntamenti nel range corrente.
  const LOCATION_KEYS = ["Sede", "Sedi", "Sede appuntamento", "Location", "Luogo", "Sede Bologna"];
  function pickLocation(fields) {
    const v = pickField(fields || {}, LOCATION_KEYS);
    return String(v || "").trim();
  }

  function incCount(map, key, loc) {
    if (!key || !loc) return;
    let inner = map.get(key);
    if (!inner) { inner = new Map(); map.set(key, inner); }
    inner.set(loc, (inner.get(loc) || 0) + 1);
  }

  function pickMostFrequent(inner) {
    if (!inner || !(inner instanceof Map)) return "";
    let best = "";
    let bestN = 0;
    for (const [k, n] of inner.entries()) {
      if (n > bestN) { bestN = n; best = k; }
    }
    return best;
  }

  // Cache: key = "YYYY-MM-DD|Therapist Name" -> "SEDE ..."
  let slotLocationByDayTher = new Map();
  // Cache: key = "Therapist Name" -> "SEDE ..."
  let slotLocationByTher = new Map();

  function rebuildSlotLocationIndex() {
    const dayCounts = new Map(); // key -> Map(loc->count)
    const therCounts = new Map(); // therapist -> Map(loc->count)

    for (const it of rawItems || []) {
      if (!it?.startAt) continue;
      const ymd = toYmd(it.startAt);
      const ther = String(it.therapist || "").trim() || "__ALL__";
      const loc = pickLocation(it.fields || {});
      if (!loc) continue;

      incCount(dayCounts, `${ymd}|${ther}`, loc);
      incCount(dayCounts, `${ymd}|__ALL__`, loc);
      incCount(therCounts, ther, loc);
      incCount(therCounts, "__ALL__", loc);
    }

    slotLocationByDayTher = new Map();
    for (const [k, inner] of dayCounts.entries()) {
      const best = pickMostFrequent(inner);
      if (best) slotLocationByDayTher.set(k, best);
    }

    slotLocationByTher = new Map();
    for (const [k, inner] of therCounts.entries()) {
      const best = pickMostFrequent(inner);
      if (best) slotLocationByTher.set(k, best);
    }
  }

  function inferSlotLocation(ymd, therapistName) {
    const ther = String(therapistName || "").trim() || "__ALL__";
    const day = String(ymd || "").trim();
    return (
      slotLocationByDayTher.get(`${day}|${ther}`) ||
      slotLocationByDayTher.get(`${day}|__ALL__`) ||
      slotLocationByTher.get(ther) ||
      slotLocationByTher.get("__ALL__") ||
      ""
    );
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
    const status = pickField(f, ["Stato appuntamento", "Stato", "status"]) || "";

    // patient can be link-array; attempt text variants, then fallback.
    const patient =
      pickField(f, ["Paziente (testo)", "Paziente", "Patient", "patient_name", "Nome Paziente", "Cognome e Nome"]) ||
      (Array.isArray(f.Paziente) ? `Paziente (${f.Paziente[0] || ""})` : "");

    let patientId = "";
    if (Array.isArray(f.Paziente) && f.Paziente.length && typeof f.Paziente[0] === "string") {
      patientId = String(f.Paziente[0] || "").trim();
    }

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
    // Fallback: use auth payload (nome + cognome if present)
    const u = window.FP_USER || window.FP_SESSION || null;
    const nome = String(u?.nome || "").trim();
    const cognome = String(u?.cognome || "").trim();
    return [nome, cognome].filter(Boolean).join(" ").trim();
  }

  function ensureMeInSelection(set) {
    if (!set) return;
    const me = String(getUserName() || "").trim();
    if (me) set.add(me);
  }

  function normalizeRoleLabel(roleRaw) {
    const r = String(roleRaw || "").trim();
    if (!r) return "";
    const x = r.toLowerCase();
    if (x === "physio" || x === "fisioterapista") return "Fisioterapista";
    if (x.includes("front")) return "Front office";
    if (x.includes("manager") || x.includes("admin") || x.includes("amministr")) return "Manager";
    return r;
  }
  function getUserRoleLabel() {
    const u = window.FP_USER || window.FP_SESSION || null;
    return normalizeRoleLabel(u?.roleLabel || u?.role || "");
  }
  function roleForOperatorName(name) {
    const n = String(name || "").trim();
    if (!n) return "";
    return normalizeRoleLabel(operatorNameToRole.get(n) || "");
  }

  function syncLoginName() {
    if (!loginNameEl) return;
    const name = String(getUserName() || "").trim();
    const roleLabel = getUserRoleLabel();
    loginNameEl.textContent = name ? (name + (roleLabel ? " • " + roleLabel : "")) : "—";
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

  function initSelectionFromPrefs() {
    // Apply saved preferences immediately (before network fetch),
    // so multi-user view doesn't "pop in" late.
    const me = String(getUserName() || "").trim();
    if (multiUser) {
      const base = (prefs.defaultOperators || []).filter(Boolean);
      selectedTherapists = new Set(base);
      // Always keep the current user's agenda visible in multi-user mode.
      ensureMeInSelection(selectedTherapists);
      // If nothing selected, fallback to self (or first known later).
      if (!selectedTherapists.size && me) selectedTherapists.add(me);
    } else {
      selectedTherapists = new Set();
      if (me) selectedTherapists.add(me);
    }
    if (selectedTherapists.size) didApplyDefaultSelectionOnce = true;
  }
  function savePrefs() {
    try { localStorage.setItem(prefsKey(), JSON.stringify(prefs)); } catch {}
  }
  function resetPrefs() {
    prefs = { slotMin: 30, multiUser: false, defaultOperators: [], doubleOperators: [], showService: true, dayNav: false, userColor: "" };
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
    if (prefDefaultSection) prefDefaultSection.style.display = prefMulti?.checked ? "" : "none";
    if (prefDefaultPicker && !prefMulti?.checked) prefDefaultPicker.style.display = "none";
    if (prefDoubleSection) prefDoubleSection.style.display = prefMulti?.checked ? "" : "none";
    if (prefDoublePicker && !prefMulti?.checked) prefDoublePicker.style.display = "none";
    renderDefaultDots();
    renderDoubleDots();
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

  function renderDoubleDots() {
    if (!prefDoubleDots) return;
    prefDoubleDots.innerHTML = "";
    const names = (prefs.doubleOperators || []).slice(0, 10);
    names.forEach((n) => {
      const dot = document.createElement("div");
      dot.className = "opsDot";
      dot.style.background = solidForTherapist(n);
      dot.textContent = therapistKey(n);
      prefDoubleDots.appendChild(dot);
    });
    if (!names.length) {
      const t = document.createElement("div");
      t.className = "opsMini";
      t.textContent = "—";
      prefDoubleDots.appendChild(t);
    }
  }

  function renderDefaultPickerList() {
    if (!prefDefaultList) return;
    const q = String(prefDefaultSearch?.value || "").trim().toLowerCase();
    const names = (knownTherapists || []).slice();
    const filtered = q ? names.filter((n) => String(n).toLowerCase().includes(q)) : names;

    prefDefaultList.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "prefPickRow";
      empty.style.cursor = "default";
      empty.innerHTML = `<div class="prefPickLeft"><div class="prefPickMini">Nessun operatore trovato.</div></div>`;
      prefDefaultList.appendChild(empty);
      return;
    }

    filtered.forEach((name) => {
      const row = document.createElement("div");
      row.className = "prefPickRow";
      const on = (prefs.defaultOperators || []).includes(name);
      const check = `<div class="prefPickCheck ${on ? "on" : ""}">${on ? "✓" : ""}</div>`;
      const role = roleForOperatorName(name);
      row.innerHTML = `
        <div class="prefPickLeft">
          ${check}
          <div style="min-width:0;">
            <div class="prefPickName" style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>
              ${role ? `<span class="opsRole">${role}</span>` : ""}
            </div>
            <div class="prefPickMini">${therapistKey(name) || ""}</div>
          </div>
        </div>
        <div class="opsDot" style="width:22px;height:22px;background:${solidForTherapist(name)}">${therapistKey(name) || ""}</div>
      `;
      row.addEventListener("click", () => {
        const set = new Set(prefs.defaultOperators || []);
        if (set.has(name)) set.delete(name);
        else set.add(name);
        prefs.defaultOperators = Array.from(set);
        renderDefaultDots();
        renderDefaultPickerList();
      });
      prefDefaultList.appendChild(row);
    });
  }

  function renderDoublePickerList() {
    if (!prefDoubleList) return;
    const q = String(prefDoubleSearch?.value || "").trim().toLowerCase();
    const names = (knownTherapists || []).slice();
    const filtered = q ? names.filter((n) => String(n).toLowerCase().includes(q)) : names;

    prefDoubleList.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "prefPickRow";
      empty.style.cursor = "default";
      empty.innerHTML = `<div class="prefPickLeft"><div class="prefPickMini">Nessun operatore trovato.</div></div>`;
      prefDoubleList.appendChild(empty);
      return;
    }

    filtered.forEach((name) => {
      const row = document.createElement("div");
      row.className = "prefPickRow";
      const on = (prefs.doubleOperators || []).includes(name);
      const check = `<div class="prefPickCheck ${on ? "on" : ""}">${on ? "✓" : ""}</div>`;
      const role = roleForOperatorName(name);
      row.innerHTML = `
        <div class="prefPickLeft">
          ${check}
          <div style="min-width:0;">
            <div class="prefPickName" style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>
              ${role ? `<span class="opsRole">${role}</span>` : ""}
            </div>
            <div class="prefPickMini">${therapistKey(name) || ""}</div>
          </div>
        </div>
        <div class="opsDot" style="width:22px;height:22px;background:${solidForTherapist(name)}">${therapistKey(name) || ""}</div>
      `;
      row.addEventListener("click", () => {
        const set = new Set(prefs.doubleOperators || []);
        if (set.has(name)) set.delete(name);
        else set.add(name);
        prefs.doubleOperators = Array.from(set);
        renderDoubleDots();
        renderDoublePickerList();
      });
      prefDoubleList.appendChild(row);
    });
  }

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
    if (pickMode === "defaults") draftSelected = new Set(prefs.defaultOperators || []);
    else draftSelected = new Set(selectedTherapists);
    if (opsMulti) opsMulti.checked = Boolean(multiUser);
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
      const on = draftSelected.has(name);
      const check = `<div class="opsCheck ${on ? "on" : ""}">${on ? "✓" : ""}</div>`;
      const role = roleForOperatorName(name);
      row.innerHTML = `
        <div class="opsRowLeft">
          ${check}
          <div style="min-width:0;">
            <div class="opsName" style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>
              ${role ? `<span class="opsRole">${role}</span>` : ""}
            </div>
            <div class="opsMini">${therapistKey(name) || ""}</div>
          </div>
        </div>
        <div class="opsDot" style="background:${solidForTherapist(name)}">${therapistKey(name) || ""}</div>
      `;
      row.addEventListener("click", () => {
        if (draftSelected.has(name)) draftSelected.delete(name);
        else draftSelected.add(name);
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

  async function loadLocations() {
    if (Array.isArray(locationsCache)) return locationsCache;
    const data = await apiGet("/api/locations");
    locationsCache = data.items || [];
    return locationsCache;
  }

  async function loadServices() {
    if (Array.isArray(servicesCache)) return servicesCache;
    const data = await apiGet("/api/services");
    servicesCache = data.items || [];
    return servicesCache;
  }

  async function loadTreatments() {
    if (Array.isArray(treatmentsCache)) return treatmentsCache;
    const data = await apiGet("/api/treatments?activeOnly=1");
    treatmentsCache = data.items || [];
    return treatmentsCache;
  }

  async function loadEvaluationsForPatient(patientId) {
    const pid = String(patientId || "").trim();
    if (!pid) return [];
    if (patientLinksCache.evaluations.has(pid)) return patientLinksCache.evaluations.get(pid) || [];
    const data = await apiGet(`/api/evaluations?patientId=${encodeURIComponent(pid)}&maxRecords=100`);
    const items = data.items || [];
    patientLinksCache.evaluations.set(pid, items);
    return items;
  }

  async function loadCasesForPatient(patientId) {
    const pid = String(patientId || "").trim();
    if (!pid) return [];
    if (patientLinksCache.cases.has(pid)) return patientLinksCache.cases.get(pid) || [];
    const data = await apiGet(`/api/cases?patientId=${encodeURIComponent(pid)}`);
    const items = data.items || [];
    patientLinksCache.cases.set(pid, items);
    return items;
  }

  async function loadSalesForPatient(patientId) {
    const pid = String(patientId || "").trim();
    if (!pid) return [];
    if (patientLinksCache.sales.has(pid)) return patientLinksCache.sales.get(pid) || [];
    const data = await apiGet(`/api/sales?patientId=${encodeURIComponent(pid)}`);
    const items = data.items || [];
    patientLinksCache.sales.set(pid, items);
    return items;
  }

  async function loadErogatoForPatient(patientId) {
    const pid = String(patientId || "").trim();
    if (!pid) return [];
    if (patientLinksCache.erogato.has(pid)) return patientLinksCache.erogato.get(pid) || [];
    const data = await apiGet(`/api/erogato?patientId=${encodeURIComponent(pid)}&maxRecords=100`);
    const items = data.items || [];
    patientLinksCache.erogato.set(pid, items);
    return items;
  }

  async function searchPatients(q) {
    const qq = String(q || "").trim();
    if (!qq) return [];
    const key = qq.toLowerCase();
    if (patientSearchCache.has(key)) return patientSearchCache.get(key) || [];
    const data = await apiGet(
      `/api/airtable?op=searchPatientsFull&q=${encodeURIComponent(qq)}&maxRecords=60&pageSize=30`,
    );
    const items = (data.items || []).map((x) => {
      const nome = String(x.Nome || "").trim();
      const cognome = String(x.Cognome || "").trim();
      const full = [nome, cognome].filter(Boolean).join(" ").trim() || String(x["Cognome e Nome"] || "").trim();
      return { id: x.id, label: full || "Paziente", phone: x.Telefono || "", email: x.Email || "" };
    });
    patientSearchCache.set(key, items);
    return items;
  }

  async function load() {
    const start = view === "day"
      ? new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())
      : startOfWeekMonday(anchorDate);
    const days = view === "day" ? 1 : (view === "5days" ? 5 : 7);
    const from = toYmd(start);
    const to = toYmd(addDays(start, days - 1));

    if (rangeEl) rangeEl.textContent = ""; // UI: non mostrare date in alto
    if (monthEl) monthEl.textContent = String(fmtMonth(start) || "").toUpperCase();
    if (weekEl) weekEl.textContent = fmtWeekRange(start, days);

    // Fetch operators + agenda in parallel (reduces initial load latency).
    const opsPromise = apiGet("/api/operators").catch(() => null);
    const agendaPromise = apiGet(`/api/agenda?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

    const [ops, data] = await Promise.all([opsPromise, agendaPromise]);

    if (ops?.items) {
      const items = (ops.items || []);
      knownOperators = items;
      const names = items.map((x) => String(x.name || "").trim()).filter(Boolean);
      if (names.length) knownTherapists = names;
      knownByEmail = new Map(items.map((x) => [String(x.email || "").trim().toLowerCase(), String(x.name || "").trim()]).filter((p) => p[0] && p[1]));
      operatorNameToId = new Map(items.map((x) => [String(x.name || "").trim(), String(x.id || "").trim()]).filter((p) => p[0] && p[1]));
      operatorNameToRole = new Map(items.map((x) => [String(x.name || "").trim(), String(x.role || "").trim()]).filter((p) => p[0] && p[1]));
    }

    syncLoginName();
    if (prefDefaultPicker && prefDefaultPicker.style.display !== "none") renderDefaultPickerList();
    if (prefDoublePicker && prefDoublePicker.style.display !== "none") renderDoublePickerList();

    rawItems = (data.items || []).map(normalizeItem).filter((x) => x.startAt);
    if (!knownTherapists.length) knownTherapists = getTherapists(rawItems);
    rebuildSlotLocationIndex();

    // Default behavior (per login):
    // - show the logged-in user's agenda only
    // - if multi-user is enabled, apply defaultOperators ONCE (first load after access)
    if (!didApplyDefaultSelectionOnce && knownTherapists.length) {
      const me = getUserName();
      if (multiUser && (prefs.defaultOperators || []).length) {
        selectedTherapists = new Set(prefs.defaultOperators);
        ensureMeInSelection(selectedTherapists);
      }
      else if (!multiUser && me) selectedTherapists = new Set([me]);
      else if (me) selectedTherapists = new Set([me]);
      else selectedTherapists = new Set([knownTherapists[0]]);
      didApplyDefaultSelectionOnce = true;
    }

    // keep selection valid
    if (selectedTherapists.size === 0 && knownTherapists.length) selectedTherapists.add(knownTherapists[0]);
    if (multiUser) ensureMeInSelection(selectedTherapists);

    syncOpsBar();
    render();
  }

  function buildGridSkeleton(start, days, ops) {
    gridEl.innerHTML = "";

    // Body columns
    const totalMin = (END_HOUR - START_HOUR) * 60;
    const totalSlots = Math.ceil(totalMin / SLOT_MIN);
    // Resize slot height to fit viewport, leaving ~<1 slot of empty space.
    // This fixes the large empty area at the bottom of the agenda on tall screens.
    {
      const outer = gridEl.parentElement; // .calGridOuter
      const outerH = Number(outer?.clientHeight || 0);
      const showCancelBand = true;
      const headerH = multiUser ? (58 + 42 + 34) : (showCancelBand ? (58 + 42) : 58);
      const available = Math.max(0, outerH - headerH);
      const pad = GRID_PAD_TOP + GRID_PAD_BOTTOM;
      // Small bottom safety margin so the last hour label (21:00) isn't clipped.
      const bottomReserve = 16;
      if (available > 0) {
        const ideal = Math.floor((available - pad - bottomReserve) / Math.max(1, totalSlots));
        // Clamp to keep UI sane across screens.
        SLOT_PX = Math.max(14, Math.min(28, ideal || SLOT_PX));
      }
    }

    const bodyHeightPx = totalSlots * SLOT_PX;
    const heightPx = bodyHeightPx + GRID_PAD_TOP + GRID_PAD_BOTTOM;

    const doubleSet = new Set((prefs.doubleOperators || []).filter(Boolean));
    const opSlots = [];
    if (multiUser) {
      (ops || []).forEach((nameRaw) => {
        const name = String(nameRaw || "").trim();
        if (!name) return;
        const laneCount = doubleSet.has(name) ? 2 : 1;
        for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
          opSlots.push({ therapist: name, laneIndex, laneCount });
        }
      });
    }

    const colsPerDay = multiUser ? Math.max(1, opSlots.length || 0) : 1;
    const totalDayCols = days * colsPerDay;

    // Colonne sempre visibili: si stringono (no orizzontale) quando aggiungo operatori
    const showCancelBand = true; // requested: show "disdette" band even in single-operator view
    gridEl.style.gridTemplateColumns = `64px repeat(${totalDayCols}, minmax(0, 1fr))`;
    if (multiUser) gridEl.style.gridTemplateRows = `58px 42px 34px ${heightPx}px`;
    else if (showCancelBand) gridEl.style.gridTemplateRows = `58px 42px ${heightPx}px`;
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
      if (dIdx > 0) dh.classList.add("daySepHead");
      const startCol = 2 + dIdx * colsPerDay;
      dh.style.gridColumn = `${startCol} / span ${colsPerDay}`;
      dh.style.gridRow = "1";
      dh.innerHTML = `<div class="d1">${itDayLabel(d)}</div><div class="d2">${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}</div>`;
      gridEl.appendChild(dh);
    }

    // Cancelled-band row: between day header and operator header (or before grid in single-user)
    if (multiUser || showCancelBand) {
      const blank = document.createElement("div");
      blank.className = "corner";
      blank.style.height = "42px";
      blank.style.gridColumn = "1";
      blank.style.gridRow = "2";
      gridEl.appendChild(blank);

      for (let dIdx = 0; dIdx < days; dIdx++) {
        const cell = document.createElement("div");
        cell.className = "cancelHead";
        if (dIdx > 0) cell.classList.add("daySepHead");
        const startCol = 2 + dIdx * colsPerDay;
        cell.style.gridColumn = `${startCol} / span ${colsPerDay}`;
        cell.style.gridRow = "2";
        cell.dataset.cancelDay = String(dIdx);
        cell.innerHTML = `<div class="cancelWrap" data-cancel-wrap="${dIdx}"></div>`;
        gridEl.appendChild(cell);
      }

      // Operator headers
      if (multiUser) {
        const blank2 = document.createElement("div");
        blank2.className = "corner";
        blank2.style.height = "34px";
        blank2.style.gridColumn = "1";
        blank2.style.gridRow = "3";
        gridEl.appendChild(blank2);

        for (let dIdx = 0; dIdx < days; dIdx++) {
          for (let oIdx = 0; oIdx < colsPerDay; oIdx++) {
            const slot = opSlots[oIdx] || { therapist: "", laneIndex: 0, laneCount: 1 };
            const name = slot.therapist || "";
            const cell = document.createElement("div");
            cell.className = "dayHead";
            cell.classList.add("opHead");
            if (dIdx > 0 && oIdx === 0) cell.classList.add("daySepHead");
            cell.style.height = "34px";
            cell.style.padding = "6px 10px";
            cell.style.gridRow = "3";
            cell.style.gridColumn = String(2 + dIdx * colsPerDay + oIdx);
            // Requested: keep the colored dot, but remove name/surname next to it (still keep tooltip).
            const laneBadge =
              slot.laneCount > 1
                ? `<span title="Colonna ${slot.laneIndex + 1}" style="font-size:11px; font-weight:1000; opacity:.85;">${slot.laneIndex + 1}</span>`
                : "";
            cell.innerHTML = `<div class="d2" style="display:flex;align-items:center;gap:8px;font-size:13px;">
              <span class="opsDot" title="${name}" style="width:22px;height:22px;background:${solidForTherapist(name)}">${therapistKey(name)}</span>
              ${laneBadge}
            </div>`;
            gridEl.appendChild(cell);
          }
        }
      }
    }

    // time column
    const timeCol = document.createElement("div");
    timeCol.className = "timeCol";
    timeCol.style.height = heightPx + "px";
    timeCol.style.gridColumn = "1";
    timeCol.style.gridRow = multiUser ? "4" : (showCancelBand ? "3" : "2");
    timeCol.style.position = "sticky";
    timeCol.style.left = "0";
    timeCol.style.zIndex = "4";
    timeCol.style.background = "rgba(15,26,44,.96)";

    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const y = GRID_PAD_TOP + (((h - START_HOUR) * 60 / SLOT_MIN) * SLOT_PX);
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
        if (dIdx > 0 && oIdx === 0) col.classList.add("daySep");
        col.dataset.dayIndex = String(dIdx);
        if (multiUser) {
          const slot = opSlots[oIdx] || { therapist: "", laneIndex: 0, laneCount: 1 };
          col.dataset.therapist = String(slot.therapist || "");
          col.dataset.lane = String(slot.laneIndex || 0);
          col.dataset.lanes = String(slot.laneCount || 1);
        } else {
          col.dataset.therapist = "";
          col.dataset.lane = "0";
          col.dataset.lanes = "1";
        }
        col.style.height = heightPx + "px";
        col.style.gridColumn = String(2 + dIdx * colsPerDay + oIdx);
        col.style.gridRow = multiUser ? "4" : (showCancelBand ? "3" : "2");

        // grid lines
        for (let s = 0; s <= totalSlots; s++) {
          const m = s * SLOT_MIN;
          const y = GRID_PAD_TOP + (s * SLOT_PX);
          const line = document.createElement("div");
          line.className = "gridLine" + ((m % 60 === 0) ? " hour" : "");
          line.style.top = y + "px";
          col.appendChild(line);
        }

        // Hover slot highlight + click to create
        const hover = document.createElement("div");
        hover.className = "slotHover";
        hover.style.height = SLOT_PX + "px";
        col.appendChild(hover);

        const updateHover = (clientY) => {
          const r = col.getBoundingClientRect();
          const y = (clientY - r.top) - GRID_PAD_TOP;
          const idx = Math.max(0, Math.min(totalSlots - 1, Math.floor(y / SLOT_PX)));
          hover.style.top = (GRID_PAD_TOP + (idx * SLOT_PX)) + "px";
          // NOTE: .slotHover has display:none in agenda.html CSS.
          // Setting "" would keep it hidden; explicitly show it.
          hover.style.display = "block";
          col.dataset._slotIndex = String(idx);

          // Tooltip slot (ora + sede + operatore)
          const slotStartMin = START_HOUR * 60 + idx * SLOT_MIN;
          const day = addDays(start, dIdx);
          const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
          dt.setMinutes(slotStartMin);
          const timeStr = dt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

          const therapistName = multiUser
            ? String(col.dataset.therapist || "").trim()
            : (Array.from(selectedTherapists)[0] || "");
          const role = roleForOperatorName(therapistName);
          const therLabel = therapistName ? (therapistName + (role ? " • " + role : "")) : "—";

          const loc = inferSlotLocation(toYmd(day), therapistName) || "—";
          showSlotHover({ time: timeStr, therapist: therLabel, location: loc }, lastMouseX, lastMouseY);
        };

        let lastMouseX = 0;
        let lastMouseY = 0;
        col.addEventListener("mousemove", (e) => {
          lastMouseX = e.clientX;
          lastMouseY = e.clientY;
          // Se stai sopra un evento, non mostrare highlight/tooltip slot.
          if (e.target && e.target.closest && e.target.closest(".event")) {
            hover.style.display = "none";
            hideSlotHover();
            return;
          }
          updateHover(e.clientY);
        });
        col.addEventListener("mouseleave", () => { hover.style.display = "none"; hideSlotHover(); });

        col.addEventListener("click", (e) => {
          if (e.target && e.target.closest && e.target.closest(".event")) return;
          hideSlotHover();
          const idx = Number(col.dataset._slotIndex || "0");
          const slotStartMin = START_HOUR * 60 + idx * SLOT_MIN;

          const day = addDays(start, dIdx);
          const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
          dt.setMinutes(slotStartMin);

          const therapistName = multiUser ? String(col.dataset.therapist || "").trim() : (Array.from(selectedTherapists)[0] || "");
          openCreateModal({ startAt: dt, therapistName });
        });

        gridEl.appendChild(col);
      }
    }
  }

  function openDetailsModal(item) {
    if (!modalBack) return;
    modalTitle.textContent = item.patient || "Dettagli appuntamento";

    const lines = [];
    const st = item.startAt ? item.startAt.toLocaleString("it-IT", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    const en = item.endAt ? item.endAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
    lines.push(["Quando", st + (en ? " → " + en : "")]);
    if (item.therapist) {
      const role = roleForOperatorName(item.therapist);
      lines.push(["Operatore", item.therapist + (role ? " • " + role : "")]);
    }
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

  function openCreateModal(ctx) {
    if (!modalBack) return;
    const startAt = ctx?.startAt instanceof Date ? ctx.startAt : new Date();
    const therapistName = String(ctx?.therapistName || "").trim();

    // Header strings (requested: day full, uppercase; date/time larger)
    let dayUpper = "";
    let dateStr = "";
    let timeStr = "";
    try {
      dayUpper = String(startAt.toLocaleDateString("it-IT", { weekday: "long" }) || "").toUpperCase();
      dateStr = String(startAt.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" }) || "");
      timeStr = String(startAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) || "");
    } catch {
      // fallback: keep empty strings
    }

    // calcola durata max fino al prossimo appuntamento (stesso giorno e stesso operatore)
    const startMin = minutesOfDay(startAt);
    const endDayMin = END_HOUR * 60;
    let nextMin = endDayMin;
    for (const it of rawItems || []) {
      if (!it.startAt) continue;
      if (therapistName && String(it.therapist || "").trim() !== therapistName) continue;
      const sameDay =
        it.startAt.getFullYear() === startAt.getFullYear() &&
        it.startAt.getMonth() === startAt.getMonth() &&
        it.startAt.getDate() === startAt.getDate();
      if (!sameDay) continue;
      const m = minutesOfDay(it.startAt);
      if (m > startMin && m < nextMin) nextMin = m;
    }
    const maxDur = Math.max(30, Math.min(360, nextMin - startMin)); // fino a 6h per sicurezza UI
    const durOptions = [];
    for (let m = 30; m <= maxDur; m += 30) durOptions.push(m);

    modalTitle.textContent = "Nuovo appuntamento";
    modalBody.innerHTML = `
      <div style="padding: 8px 0 14px; border-bottom: 1px dashed rgba(255,255,255,.12);">
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:14px;">
          <div style="font-weight: 1000; font-size: 22px; letter-spacing: .04em; text-transform: uppercase;">
            ${dayUpper || "—"}
          </div>
          <div style="font-weight: 1000; font-size: 26px;">
            ${timeStr || "—"}
          </div>
        </div>
        <div style="margin-top:6px; opacity:.80; font-weight: 900; font-size: 16px;">
          ${dateStr || "—"}
        </div>
      </div>
      <div style="height:10px;"></div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Voce agenda</span>
          <select class="select" data-f-voce><option value="">Carico…</option></select>
        </label>

        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Durata</span>
          <select class="select" data-f-duration>
            ${durOptions.map((m) => `<option value="${m}">${m === 30 ? "30 min" : (m % 60 === 0 ? (m/60) + " h" : (Math.floor(m/60) + " h " + (m%60) + " min"))}</option>`).join("")}
          </select>
        </label>

        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Stato appuntamento</span>
          <select class="select" data-f-status><option value="">Carico…</option></select>
        </label>

        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Sede</span>
          <select class="select" data-f-location><option value="">Carico…</option></select>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span class="fpFormLabel">Paziente</span>
          <div style="display:flex; gap:10px; align-items:center;">
            <input class="input" data-f-patient-q placeholder="Cerca paziente..." />
            <button class="btn" data-f-patient-clear type="button">Svuota</button>
          </div>
          <div data-f-patient-picked style="margin-top:8px; color: rgba(255,255,255,.90); font-weight:800; display:none;"></div>
          <div data-f-patient-results style="margin-top:8px; display:none; border:1px solid rgba(255,255,255,.10); border-radius:12px; overflow:hidden;"></div>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span class="fpFormLabel">Prestazione</span>
          <input class="input" data-f-service-q placeholder="Cerca prestazione..." />
          <select class="select" data-f-service style="margin-top:8px;"><option value="">Carico…</option></select>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span class="fpFormLabel">Operatore</span>
          <select class="select" data-f-operator></select>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span class="fpFormLabel">Tipi Erogati (separati da virgola)</span>
          <input class="input" data-f-tipi placeholder="Es. FKT, MASSO" />
        </label>

        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Caso clinico</span>
          <select class="select" data-f-case><option value="">—</option></select>
        </label>

        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Vendita collegata</span>
          <select class="select" data-f-sale><option value="">—</option></select>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span class="fpFormLabel">Erogato collegato</span>
          <select class="select" data-f-erogato><option value="">—</option></select>
        </label>

        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">VALUTAZIONI</span>
          <select class="select" multiple size="4" data-f-evals></select>
        </label>

        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">TRATTAMENTI</span>
          <select class="select" multiple size="4" data-f-treatments><option value="">Carico…</option></select>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span class="fpFormLabel">Note interne</span>
          <textarea class="textarea" data-f-internal placeholder="Note interne..."></textarea>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span class="fpFormLabel">Note</span>
          <textarea class="textarea" data-f-notes placeholder="Note..."></textarea>
        </label>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
        <button class="btn" data-f-cancel type="button">Annulla</button>
        <button class="btn primary" data-f-save type="button">Salva</button>
      </div>
    `;

    const elVoce = modalBody.querySelector("[data-f-voce]");
    const elDur = modalBody.querySelector("[data-f-duration]");
    const elStatus = modalBody.querySelector("[data-f-status]");
    const elServQ = modalBody.querySelector("[data-f-service-q]");
    const elServ = modalBody.querySelector("[data-f-service]");
    const elOp = modalBody.querySelector("[data-f-operator]");
    const elLoc = modalBody.querySelector("[data-f-location]");
    const elTipi = modalBody.querySelector("[data-f-tipi]");
    const elCase = modalBody.querySelector("[data-f-case]");
    const elSale = modalBody.querySelector("[data-f-sale]");
    const elErogato = modalBody.querySelector("[data-f-erogato]");
    const elEvals = modalBody.querySelector("[data-f-evals]");
    const elTreatments = modalBody.querySelector("[data-f-treatments]");
    const elInternal = modalBody.querySelector("[data-f-internal]");
    const elNotes = modalBody.querySelector("[data-f-notes]");

    const parseCommaList = (s) =>
      String(s || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    const getMultiValues = (sel) => Array.from(sel?.selectedOptions || []).map((o) => String(o.value)).filter(Boolean);
    const setSelectOptions = (sel, items, { placeholder = "—" } = {}) => {
      if (!sel) return;
      sel.innerHTML =
        `<option value="">${placeholder}</option>` +
        (items || []).map((x) => `<option value="${String(x.id || "")}">${String(x.name || x.label || x.id || "")}</option>`).join("");
    };
    const setMultiOptions = (sel, items, labelFn) => {
      if (!sel) return;
      sel.innerHTML = (items || [])
        .map((x) => `<option value="${String(x.id || "")}">${String(labelFn ? labelFn(x) : (x.name || x.label || x.id || ""))}</option>`)
        .join("");
    };

    // operator select
    const ops = (knownOperators || []).slice();
    elOp.innerHTML = ops
      .map((o) => {
        const name = String(o.name || "").trim();
        const role = normalizeRoleLabel(o.role || "");
        const label = name + (role ? " • " + role : "");
        return `<option value="${String(o.id || "")}">${label}</option>`;
      })
      .join("");
    const defaultOpId = therapistName ? (operatorNameToId.get(therapistName) || "") : "";
    if (defaultOpId) elOp.value = defaultOpId;

    // services (with searchable select)
    const renderSelectError = (selEl, label, err) => {
      if (!selEl) return;
      const msg = String(err?.message || err || "Errore caricamento");
      selEl.innerHTML = `<option value="">${label}: ERRORE</option>`;
      // Also show details in console to avoid silent failures.
      console.error(label + " load error:", err);
      // Add a small helper row below the select (best-effort).
      const wrap = selEl.closest("label.field");
      if (wrap) {
        let hint = wrap.querySelector("[data-fp-loaderr]");
        if (!hint) {
          hint = document.createElement("div");
          hint.setAttribute("data-fp-loaderr", "1");
          hint.style.marginTop = "6px";
          hint.style.fontSize = "12px";
          hint.style.opacity = ".85";
          hint.style.display = "flex";
          hint.style.alignItems = "center";
          hint.style.gap = "10px";
          wrap.appendChild(hint);
        }
        hint.innerHTML = `<span style="color: rgba(255,214,222,.95); font-weight:900;">${msg}</span>
          <button class="btn" type="button" data-fp-debugbtn style="padding:7px 10px; font-size:12px;">Debug</button>`;
        const btn = hint.querySelector("[data-fp-debugbtn]");
        btn.onclick = async () => {
          try {
            const dbgUrl = "/api/services?debug=1";
            const dbg = await apiGet(dbgUrl);
            alert(JSON.stringify(dbg?.debug || dbg, null, 2));
          } catch (e) {
            alert(String(e?.message || e || "debug_failed"));
          }
        };
      }
    };

    let allServices = [];
    function renderServicesFiltered() {
      const q = String(elServQ?.value || "").trim().toLowerCase();
      const selected = String(elServ?.value || "");
      const filtered = q
        ? allServices.filter((x) => String(x.name || "").toLowerCase().includes(q))
        : allServices;

      elServ.innerHTML =
        `<option value="">—</option>` +
        filtered.map((x) => `<option value="${x.id}">${x.name}</option>`).join("");

      // try to keep selection
      if (selected && filtered.some((x) => x.id === selected)) elServ.value = selected;
    }

    loadServices()
      .then((arr) => {
        allServices = Array.isArray(arr) ? arr : [];
        renderServicesFiltered();
        if (!allServices.length) {
          renderSelectError(elServ, "PRESTAZIONI", "Nessuna prestazione trovata (tabella vuota o campo nome senza valori). Premi Debug.");
        }
      })
      .catch((e) => renderSelectError(elServ, "PRESTAZIONI", e));

    elServQ?.addEventListener("input", () => renderServicesFiltered());

    // Voce agenda + Stato appuntamento options (from Airtable)
    apiGet(`/api/appointment-field-options?table=${encodeURIComponent("APPUNTAMENTI")}&field=${encodeURIComponent("Voce agenda")}`)
      .then((d) => {
        const items = d.items || [];
        setSelectOptions(elVoce, items, { placeholder: "—" });
        // default: keep empty, user picks
      })
      .catch((e) => renderSelectError(elVoce, "VOCE AGENDA", e));

    apiGet(`/api/appointment-field-options?table=${encodeURIComponent("APPUNTAMENTI")}&field=${encodeURIComponent("Stato appuntamento")}`)
      .then((d) => {
        const items = d.items || [];
        setSelectOptions(elStatus, items, { placeholder: "—" });
      })
      .catch((e) => renderSelectError(elStatus, "STATO APPUNTAMENTO", e));

    // locations
    const inferredLocName = inferSlotLocation(toYmd(startAt), therapistName);
    loadLocations()
      .then((arr) => {
        const items = Array.isArray(arr) ? arr : [];
        setSelectOptions(elLoc, items, { placeholder: "—" });
        if (inferredLocName) {
          const found = items.find((x) => String(x.name || "").trim().toLowerCase() === String(inferredLocName).trim().toLowerCase());
          if (found?.id) elLoc.value = String(found.id);
        }
      })
      .catch((e) => renderSelectError(elLoc, "SEDI", e));

    // treatments (multi)
    loadTreatments()
      .then((arr) => {
        const items = Array.isArray(arr) ? arr : [];
        setMultiOptions(elTreatments, items, (x) => x.name || x.id);
      })
      .catch((e) => renderSelectError(elTreatments, "TRATTAMENTI", e));

    // patient search
    let patientPicked = { id: "", label: "" };
    const qInput = modalBody.querySelector("[data-f-patient-q]");
    const pickedEl = modalBody.querySelector("[data-f-patient-picked]");
    const resultsEl = modalBody.querySelector("[data-f-patient-results]");
    const clearBtn = modalBody.querySelector("[data-f-patient-clear]");
    let t = null;
    let reqSeq = 0;

    function setPicked(p) {
      patientPicked = p || { id: "", label: "" };
      if (patientPicked.id) {
        pickedEl.style.display = "";
        pickedEl.textContent = patientPicked.label;
      } else {
        pickedEl.style.display = "none";
        pickedEl.textContent = "";
      }
    }

    async function refreshPatientLinks(patientId) {
      const pid = String(patientId || "").trim();
      // reset selects
      setSelectOptions(elCase, [], { placeholder: "—" });
      setSelectOptions(elSale, [], { placeholder: "—" });
      setSelectOptions(elErogato, [], { placeholder: "—" });
      if (elEvals) elEvals.innerHTML = "";
      if (!pid) return;

      try {
        const [cases, sales, erogato, evals] = await Promise.all([
          loadCasesForPatient(pid),
          loadSalesForPatient(pid),
          loadErogatoForPatient(pid),
          loadEvaluationsForPatient(pid),
        ]);

        setSelectOptions(
          elCase,
          (cases || []).map((x) => ({ id: x.id, name: [x.data, x.titolo].filter(Boolean).join(" • ") || x.id })),
          { placeholder: "—" },
        );
        setSelectOptions(
          elSale,
          (sales || []).map((x) => ({ id: x.id, name: [x.data, x.voce].filter(Boolean).join(" • ") || x.id })),
          { placeholder: "—" },
        );
        setSelectOptions(
          elErogato,
          (erogato || []).map((x) => ({ id: x.id, name: [x.data, x.prestazione].filter(Boolean).join(" • ") || x.id })),
          { placeholder: "—" },
        );

        setMultiOptions(elEvals, evals || [], (x) => [x.data, x.tipo].filter(Boolean).join(" • ") || x.id);
      } catch (e) {
        console.warn("refreshPatientLinks failed", e);
      }
    }
    function hideResults() {
      resultsEl.style.display = "none";
      resultsEl.innerHTML = "";
    }
    async function doSearch() {
      const q = String(qInput.value || "").trim();
      // Requested: start searching as soon as user types (1+ characters).
      if (q.length < 1) return hideResults();

      // Immediate feedback while typing
      const mySeq = ++reqSeq;
      resultsEl.style.display = "";
      resultsEl.innerHTML = `<div style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.10); opacity:.85;">Carico…</div>`;

      const results = await searchPatients(q);
      // Ignore late responses
      if (mySeq !== reqSeq) return;
      if (!results.length) return hideResults();
      resultsEl.innerHTML = results.slice(0, 10).map((r) => `
        <div data-pick="${r.id}" style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.10); cursor:pointer;">
          <div style="font-weight:900;">${r.label}</div>
          <div style="opacity:.75; font-size:12px; margin-top:2px;">${[r.phone, r.email].filter(Boolean).join(" • ")}</div>
        </div>
      `).join("");
      resultsEl.querySelectorAll("[data-pick]").forEach((row) => {
        row.addEventListener("click", () => {
          const id = row.getAttribute("data-pick");
          const picked = results.find((x) => x.id === id);
          setPicked(picked);
          hideResults();
          qInput.value = picked?.label || "";
          refreshPatientLinks(picked?.id || "").catch(()=>{});
        });
      });
      resultsEl.style.display = "";
    }

    qInput.addEventListener("input", () => {
      clearTimeout(t);
      // Snappier live search
      t = setTimeout(() => doSearch().catch(()=>{}), 90);
    });
    qInput.addEventListener("focus", () => doSearch().catch(()=>{}));
    clearBtn.addEventListener("click", () => { qInput.value = ""; setPicked({ id:"", label:"" }); hideResults(); refreshPatientLinks("").catch(()=>{}); });

    // cancel/save
    modalBody.querySelector("[data-f-cancel]").onclick = closeModal;
    modalBody.querySelector("[data-f-save]").onclick = async () => {
      const btn = modalBody.querySelector("[data-f-save]");
      btn.disabled = true;
      try {
        const durMin = Number(elDur.value || "30");
        const endAt = new Date(startAt.getTime() + durMin * 60000);

        const payload = {
          startAt: toLocalDateTimeISO(startAt),
          endAt: toLocalDateTimeISO(endAt),
          therapistId: String(elOp.value || ""),
          patientId: patientPicked.id || "",
          serviceId: String(elServ.value || ""),
          locationId: String(elLoc?.value || ""),
          voceAgenda: String(elVoce?.value || ""),
          status: String(elStatus?.value || ""),
          durationMin: durMin,
          internalNote: String(elInternal.value || ""),
          notes: String(elNotes?.value || ""),
          tipiErogati: parseCommaList(elTipi?.value || ""),
          valutazioniIds: getMultiValues(elEvals),
          trattamentiIds: getMultiValues(elTreatments),
          casoClinicoId: String(elCase?.value || ""),
          venditaId: String(elSale?.value || ""),
          erogatoId: String(elErogato?.value || ""),
        };

        // create uses POST; use fetch directly.
        const res = await fetch("/api/appointment-create", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data.error || ("HTTP " + res.status));

        // Ensure the appointment shows under the chosen collaborator.
        try {
          const opId = String(elOp.value || "").trim();
          const opName = (knownOperators || []).find((x) => String(x.id || "") === opId)?.name || "";
          if (multiUser && opName) selectedTherapists.add(String(opName).trim());
        } catch {}

        closeModal();
        load().catch(()=>{});
      } catch (e) {
        console.error(e);
        alert(e.message || "Errore salvataggio appuntamento");
      } finally {
        btn.disabled = false;
      }
    };

    modalBack.style.display = "flex";
  }

  function closeModal() {
    if (!modalBack) return;
    modalBack.style.display = "none";
  }

  function render() {
    const start = view === "day"
      ? new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())
      : startOfWeekMonday(anchorDate);
    const days = view === "day" ? 1 : (view === "5days" ? 5 : 7);
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

    // Assign a "lane" for each appointment in multi-user view when some operators have double columns.
    if (multiUser) {
      const doubleSet = new Set((prefs.doubleOperators || []).filter(Boolean));
      const groups = new Map(); // key -> list
      items.forEach((it) => {
        const key = `${it._dayIndex}|${String(it.therapist || "")}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      });

      for (const [key, list] of groups.entries()) {
        // key = "dayIndex|therapist"
        const therapist = String(key.split("|").slice(1).join("|") || "");
        const laneCount = doubleSet.has(therapist) ? 2 : 1;
        const laneEnds = new Array(laneCount).fill(-1e9);

        list
          .slice()
          .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))
          .forEach((it) => {
            const stMin = it.startAt ? minutesOfDay(it.startAt) : 0;
            let enMin = stMin + 30;
            if (it.endAt) {
              const x = minutesOfDay(it.endAt);
              if (x > stMin) enMin = x;
            }

            let chosen = -1;
            for (let i = 0; i < laneCount; i++) {
              if (stMin >= laneEnds[i]) {
                chosen = i;
                break;
              }
            }
            if (chosen < 0) {
              // All lanes overlap; pick the one that frees up first (best-effort).
              let bestI = 0;
              let bestEnd = laneEnds[0] ?? 0;
              for (let i = 1; i < laneCount; i++) {
                if (laneEnds[i] < bestEnd) {
                  bestEnd = laneEnds[i];
                  bestI = i;
                }
              }
              chosen = bestI;
            }

            it._lane = chosen;
            laneEnds[chosen] = Math.max(laneEnds[chosen], enMin);
          });
      }
    } else {
      items.forEach((it) => { it._lane = 0; });
    }

    buildGridSkeleton(start, days, ops.length ? ops : knownTherapists.slice(0, 1));

    // Render cancelled appointments into the band (also when single-operator view).
    {
      const cancelWraps = Array.from(document.querySelectorAll("[data-cancel-wrap]"));
      cancelWraps.forEach((w) => (w.innerHTML = ""));

      // cancelled/disdetta keywords
      const isCancelled = (s) => {
        const x = String(s || "").toLowerCase();
        return x.includes("annull") || x.includes("disdett") || x.includes("cancell");
      };

      // build list for visible range + selected therapists (ignore free-text search)
      const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
      const cancelled = (rawItems || [])
        .filter((x) => x?.startAt && isCancelled(x.status))
        .filter((x) => {
          const dt0 = new Date(x.startAt.getFullYear(), x.startAt.getMonth(), x.startAt.getDate()).getTime();
          const idx = Math.round((dt0 - day0) / 86400000);
          if (idx < 0 || idx >= days) return false;
          if (selectedTherapists.size && !selectedTherapists.has(x.therapist)) return false;
          return true;
        })
        .map((x) => {
          const dt0 = new Date(x.startAt.getFullYear(), x.startAt.getMonth(), x.startAt.getDate()).getTime();
          const idx = Math.round((dt0 - day0) / 86400000);
          return { ...x, _dayIndex: idx };
        })
        .sort((a, b) => a.startAt - b.startAt);

      const maxPerDay = 6;
      for (let dIdx = 0; dIdx < days; dIdx++) {
        const wrap = document.querySelector(`[data-cancel-wrap="${dIdx}"]`);
        if (!wrap) continue;
        const list = cancelled.filter((x) => x._dayIndex === dIdx);
        if (!list.length) continue;

        const shown = list.slice(0, maxPerDay);
        shown.forEach((it) => {
          const hh = pad2(it.startAt.getHours());
          const mm = pad2(it.startAt.getMinutes());
          const key = therapistKey(it.therapist) || "";
          const label = (it.patient || "Paziente").trim();
          const chip = document.createElement("div");
          chip.className = "cancelChip";
          chip.style.background = `color-mix(in srgb, ${solidForTherapist(it.therapist)} 22%, rgba(255,255,255,.06))`;
          chip.title = `${label} • ${hh}:${mm} • ${it.therapist || ""} • ${it.status || "Annullato"}`;
          chip.innerHTML = `<span class="k">DIS</span><span class="t">${hh}:${mm}</span><span class="k">${key}</span><span class="p">${label}</span>`;
          wrap.appendChild(chip);
        });

        if (list.length > shown.length) {
          const more = document.createElement("div");
          more.className = "cancelChip";
          more.style.background = "rgba(255,255,255,.08)";
          more.style.borderColor = "rgba(255,255,255,.14)";
          more.innerHTML = `<span class="k">+${list.length - shown.length}</span>`;
          more.title = `${list.length - shown.length} annullati in più`;
          wrap.appendChild(more);
        }
      }
    }

    const cols = Array.from(document.querySelectorAll(".dayCol"));
    const startMin = START_HOUR * 60;
    const endMin = END_HOUR * 60;

    items.forEach((it) => {
      let col = null;
      if (multiUser) {
        const lane = String(it._lane ?? 0);
        col =
          cols.find(
            (c) =>
              c.dataset.dayIndex === String(it._dayIndex) &&
              c.dataset.therapist === String(it.therapist || "") &&
              String(c.dataset.lane || "0") === lane,
          ) ||
          // fallback: first column for that therapist/day
          cols.find((c) => c.dataset.dayIndex === String(it._dayIndex) && c.dataset.therapist === String(it.therapist || ""));
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
      const top = GRID_PAD_TOP + (((Math.max(startMin, stMin) - startMin) / SLOT_MIN) * SLOT_PX);
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
      ev.onclick = () => openDetailsModal(it);
      ev.addEventListener("mousemove", (e) => showHover(it, e.clientX, e.clientY));
      ev.addEventListener("mouseleave", hideHover);

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
  btnPrev?.addEventListener("click", () => {
    const step = view === "day" ? 1 : (view === "5days" ? 5 : 7);
    anchorDate = addDays(anchorDate, -step);
    load().catch(()=>{});
  });
  btnNext?.addEventListener("click", () => {
    const step = view === "day" ? 1 : (view === "5days" ? 5 : 7);
    anchorDate = addDays(anchorDate, step);
    load().catch(()=>{});
  });
  btnToday?.addEventListener("click", () => { anchorDate = new Date(); load().catch(()=>{}); });
  document.querySelectorAll("[data-cal-view]").forEach((el) => {
    el.addEventListener("click", () => setView(el.getAttribute("data-cal-view")));
  });

  modalClose?.addEventListener("click", closeModal);
  modalBack?.addEventListener("click", (e) => { if (e.target === modalBack) closeModal(); });
  const onDocScroll = () => { hideHover(); hideSlotHover(); };
  let resizeT = null;
  const onResize = () => {
    hideHover();
    hideSlotHover();
    // Rebuild grid to re-fit SLOT_PX to new height.
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      try { render(); } catch {}
    }, 80);
  };
  document.addEventListener("scroll", onDocScroll, true);
  window.addEventListener("resize", onResize);

  // Operator selector
  opsBar?.addEventListener("click", () => { pickMode = "view"; openOpsMenu(); });
  opsBtnClose?.addEventListener("click", closeOpsMenu);
  opsBack?.addEventListener("click", (e) => { if (e.target === opsBack) closeOpsMenu(); });
  opsBtnAll?.addEventListener("click", () => {
    draftSelected = new Set(knownTherapists);
    renderOpsList();
  });
  opsBtnApply?.addEventListener("click", () => {
    if (pickMode === "defaults") {
      prefs.defaultOperators = Array.from(draftSelected);
      savePrefs();
      renderDefaultDots();
      // apply immediately if multi-user is on
      if (multiUser) {
        selectedTherapists = new Set(prefs.defaultOperators);
        ensureMeInSelection(selectedTherapists);
      }
    } else {
      selectedTherapists = new Set(draftSelected);
    }
    multiUser = Boolean(opsMulti?.checked);
    if (multiUser) ensureMeInSelection(selectedTherapists);
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

  // Preferences modal events
  prefsClose?.addEventListener("click", closePrefs);
  prefsBack?.addEventListener("click", (e) => { if (e.target === prefsBack) closePrefs(); });
  // "Agende visualizzate di default" -> apre selezione operatori (salva su prefs.defaultOperators per utente)
  prefPick?.addEventListener("click", () => {
    // Se l'utente non ha ancora attivato la vista multi utente, la attiviamo (come in OsteoEasy).
    if (prefMulti && !prefMulti.checked) {
      prefMulti.checked = true;
      if (prefDefaultSection) prefDefaultSection.style.display = "";
      if (prefDoubleSection) prefDoubleSection.style.display = "";
    }
    // Apri la lista direttamente sotto (inline, scrollabile)
    if (prefDefaultPicker) {
      prefDefaultPicker.style.display = "block";
      // assicurati che la lista sia aggiornata
      renderDefaultPickerList();
      // focus sulla ricerca per rendere evidente la selezione
      try { prefDefaultSearch?.focus?.(); } catch {}
    }
  });
  prefDoublePick?.addEventListener("click", () => {
    // Se l'utente non ha ancora attivato la vista multi utente, la attiviamo.
    if (prefMulti && !prefMulti.checked) {
      prefMulti.checked = true;
      if (prefDefaultSection) prefDefaultSection.style.display = "";
      if (prefDoubleSection) prefDoubleSection.style.display = "";
    }
    if (prefDoublePicker) {
      prefDoublePicker.style.display = "block";
      renderDoublePickerList();
      try { prefDoubleSearch?.focus?.(); } catch {}
    }
  });
  prefsReset?.addEventListener("click", () => { resetPrefs(); syncPrefsUI(); toast?.("Reset"); render(); });
  prefMulti?.addEventListener("change", () => {
    if (prefDefaultSection) prefDefaultSection.style.display = prefMulti.checked ? "" : "none";
    if (prefDefaultPicker && !prefMulti.checked) prefDefaultPicker.style.display = "none";
    if (prefDoubleSection) prefDoubleSection.style.display = prefMulti.checked ? "" : "none";
    if (prefDoublePicker && !prefMulti.checked) prefDoublePicker.style.display = "none";
  });
  prefDefaultClose?.addEventListener("click", () => {
    if (prefDefaultPicker) prefDefaultPicker.style.display = "none";
  });
  prefDefaultSearch?.addEventListener("input", () => renderDefaultPickerList());
  prefDoubleClose?.addEventListener("click", () => {
    if (prefDoublePicker) prefDoublePicker.style.display = "none";
  });
  prefDoubleSearch?.addEventListener("input", () => renderDoublePickerList());
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
    } else if ((prefs.defaultOperators || []).length) {
      selectedTherapists = new Set(prefs.defaultOperators);
      ensureMeInSelection(selectedTherapists);
    } else {
      selectedTherapists = new Set();
      ensureMeInSelection(selectedTherapists);
    }

    syncOpsBar();
    closePrefs();
    render();
  });

  // Init from URL (?date=YYYY-MM-DD)
  try {
    const u = new URL(location.href);
    const d = parseYmd(u.searchParams.get("date"));
    if (d) anchorDate = d;
  } catch {}

  loadPrefs();
  initSelectionFromPrefs();
  syncLoginName();
  // Render immediately with saved selection (empty grid), then load data.
  try { render(); } catch {}
  setView("7days");
  // Cleanup (remove global listeners + ephemeral DOM)
  window.__FP_DIARY_CLEANUP = () => {
    try { document.removeEventListener("scroll", onDocScroll, true); } catch {}
    try { window.removeEventListener("resize", onResize); } catch {}
    try { hoverCard?.remove?.(); } catch {}
    try { slotHoverCard?.remove?.(); } catch {}
  };
};

  // Auto-init on classic page load
  window.fpDiaryInit();
})();

