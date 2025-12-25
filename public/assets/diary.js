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
  const SLOT_PX = 18;

  let view = "7days"; // 7days | 5days | day
  let anchorDate = new Date();
  let rawItems = [];
  let multiUser = false; // default: show only logged-in user
  let knownTherapists = [];
  let knownByEmail = new Map(); // email -> name
  let knownOperators = []; // [{id,name,email,...}] from /api/operators
  let operatorNameToId = new Map(); // name -> recId
  let locationsCache = null; // [{id,name}]
  let servicesCache = null; // [{id,name}]
  let insuranceCache = new Map(); // patientId -> string
  let selectedTherapists = new Set();
  let draftSelected = new Set();
  let pickMode = "view"; // view | defaults

  // Hover card (info rapida)
  const hoverCard = document.createElement("div");
  hoverCard.className = "fpHover";
  document.body.appendChild(hoverCard);
  function hideHover() { hoverCard.style.display = "none"; }
  function showHover(item, x, y) {
    if (!item) return;
    if (modalBack && modalBack.style.display !== "none") return;

    const startStr = item.startAt ? item.startAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
    const endStr = item.endAt ? item.endAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
    const when = startStr + (endStr ? " → " + endStr : "");

    const sede = pickField(item.fields || {}, ["Sede", "Sedi", "Sede appuntamento", "Location", "Luogo", "Sede Bologna"]);
    const note = pickField(item.fields || {}, ["Note interne", "Note", "Nota", "Note interne (preview)", "Note paziente"]);

    const roleRaw = String((window.FP_USER?.role || window.FP_SESSION?.role || "")).toLowerCase();
    const canSeeInsurance = roleRaw.includes("front") || roleRaw.includes("manager") || roleRaw.includes("admin") || roleRaw.includes("amministr");
    const insurance = canSeeInsurance && item.patientId ? (insuranceCache.get(item.patientId) || "Carico…") : "";

    hoverCard.dataset.patientId = String(item.patientId || "");
    hoverCard.innerHTML = `
      <div class="t">${item.patient || "Appuntamento"}</div>
      <div class="r"><span class="k">Orario</span><span>${when || "—"}</span></div>
      <div class="r"><span class="k">Stato</span><span>${item.status || "—"}</span></div>
      ${canSeeInsurance ? `<div class="r"><span class="k">Assicurazione</span><span>${insurance || "—"}</span></div>` : ""}
      <div class="r"><span class="k">Operatore</span><span>${item.therapist || "—"}</span></div>
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
  const prefShowService = document.querySelector("[data-pref-show-service]");
  const prefDayNav = document.querySelector("[data-pref-day-nav]");

  let prefs = {
    slotMin: 30,
    multiUser: false,
    defaultOperators: [],
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
    // Fallback: auth payload has only "nome"
    const u = window.FP_USER || window.FP_SESSION || null;
    return String(u?.nome || "").trim();
  }

  function syncLoginName() {
    if (!loginNameEl) return;
    const name = String(getUserName() || "").trim();
    loginNameEl.textContent = name || "—";
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
    prefs = { slotMin: 30, multiUser: false, defaultOperators: [], showService: true, dayNav: false, userColor: "" };
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
      row.innerHTML = `
        <div class="prefPickLeft">
          ${check}
          <div style="min-width:0;">
            <div class="prefPickName">${name}</div>
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
      row.innerHTML = `
        <div class="opsRowLeft">
          ${check}
          <div style="min-width:0;">
            <div class="opsName">${name}</div>
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
    try {
      const data = await apiGet("/api/locations");
      locationsCache = data.items || [];
    } catch {
      locationsCache = [];
    }
    return locationsCache;
  }

  async function loadServices() {
    if (Array.isArray(servicesCache)) return servicesCache;
    try {
      const data = await apiGet("/api/services");
      servicesCache = data.items || [];
    } catch {
      servicesCache = [];
    }
    return servicesCache;
  }

  async function searchPatients(q) {
    const qq = String(q || "").trim();
    if (!qq) return [];
    const data = await apiGet(`/api/airtable?op=searchPatientsFull&q=${encodeURIComponent(qq)}`);
    const items = (data.items || []).map((x) => {
      const nome = String(x.Nome || "").trim();
      const cognome = String(x.Cognome || "").trim();
      const full = [nome, cognome].filter(Boolean).join(" ").trim() || String(x["Cognome e Nome"] || "").trim();
      return { id: x.id, label: full || "Paziente", phone: x.Telefono || "", email: x.Email || "" };
    });
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

    // Load known operators from COLLABORATORI (preferred),
    // then load appointments for the selected week.
    try {
      const ops = await apiGet("/api/operators");
      const items = (ops.items || []);
      knownOperators = items;
      const names = items.map((x) => String(x.name || "").trim()).filter(Boolean);
      if (names.length) knownTherapists = names;
      knownByEmail = new Map(items.map((x) => [String(x.email || "").trim().toLowerCase(), String(x.name || "").trim()]).filter((p) => p[0] && p[1]));
      operatorNameToId = new Map(items.map((x) => [String(x.name || "").trim(), String(x.id || "").trim()]).filter((p) => p[0] && p[1]));
    } catch {
      // fallback to operators found in the week
    }
    syncLoginName();
    if (prefDefaultPicker && prefDefaultPicker.style.display !== "none") renderDefaultPickerList();

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
      } else if (multiUser && (prefs.defaultOperators || []).length) {
        selectedTherapists = new Set(prefs.defaultOperators);
      } else if (me) {
        selectedTherapists = new Set([me]);
      } else {
        selectedTherapists = new Set([knownTherapists[0]]);
      }
    }

    // keep selection valid
    if (selectedTherapists.size === 0 && knownTherapists.length) selectedTherapists.add(knownTherapists[0]);

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

    // Colonne sempre visibili: si stringono (no orizzontale) quando aggiungo operatori
    gridEl.style.gridTemplateColumns = `64px repeat(${totalDayCols}, minmax(0, 1fr))`;
    if (multiUser) gridEl.style.gridTemplateRows = `58px 42px 34px ${heightPx}px`;
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

    // Cancelled-band row (only in multi-user): between day header and operator header
    if (multiUser) {
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
      const blank2 = document.createElement("div");
      blank2.className = "corner";
      blank2.style.height = "34px";
      blank2.style.gridColumn = "1";
      blank2.style.gridRow = "3";
      gridEl.appendChild(blank2);

      for (let dIdx = 0; dIdx < days; dIdx++) {
        for (let oIdx = 0; oIdx < colsPerDay; oIdx++) {
          const name = ops[oIdx] || "";
          const cell = document.createElement("div");
          cell.className = "dayHead";
          cell.classList.add("opHead");
          if (dIdx > 0 && oIdx === 0) cell.classList.add("daySepHead");
          cell.style.height = "34px";
          cell.style.padding = "6px 10px";
          cell.style.gridRow = "3";
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
    timeCol.style.gridRow = multiUser ? "4" : "2";
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
        if (dIdx > 0 && oIdx === 0) col.classList.add("daySep");
        col.dataset.dayIndex = String(dIdx);
        col.dataset.therapist = multiUser ? String(ops[oIdx] || "") : "";
        col.style.height = heightPx + "px";
        col.style.gridColumn = String(2 + dIdx * colsPerDay + oIdx);
        col.style.gridRow = multiUser ? "4" : "2";

        // grid lines
        for (let s = 0; s <= totalSlots; s++) {
          const m = s * SLOT_MIN;
          const y = s * SLOT_PX;
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
          const y = clientY - r.top;
          const idx = Math.max(0, Math.min(totalSlots - 1, Math.floor(y / SLOT_PX)));
          hover.style.top = (idx * SLOT_PX) + "px";
          hover.style.display = "";
          col.dataset._slotIndex = String(idx);
        };

        col.addEventListener("mousemove", (e) => updateHover(e.clientY));
        col.addEventListener("mouseleave", () => { hover.style.display = "none"; });

        col.addEventListener("click", (e) => {
          if (e.target && e.target.closest && e.target.closest(".event")) return;
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

  function openCreateModal(ctx) {
    if (!modalBack) return;
    const startAt = ctx?.startAt instanceof Date ? ctx.startAt : new Date();
    const therapistName = String(ctx?.therapistName || "").trim();

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
      <div class="fp-kv"><div class="k">Inizio</div><div class="v">${startAt.toLocaleString("it-IT", { weekday:"short", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" })}</div></div>
      <div style="height:10px;"></div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <label class="field" style="gap:6px;">
          <span style="color:rgba(255,255,255,.55); font-size:12px; letter-spacing:.08em; text-transform:uppercase;">Tipologia</span>
          <select class="select" data-f-type>
            <option value="Appuntamento paziente">Appuntamento paziente</option>
            <option value="Indisponibilità">Indisponibilità</option>
            <option value="Appuntamento società">Appuntamento società</option>
            <option value="Ferie">Ferie</option>
            <option value="Appuntamento di gruppo">Appuntamento di gruppo</option>
            <option value="Proposta di appuntamento">Proposta di appuntamento</option>
          </select>
        </label>

        <label class="field" style="gap:6px;">
          <span style="color:rgba(255,255,255,.55); font-size:12px; letter-spacing:.08em; text-transform:uppercase;">Durata</span>
          <select class="select" data-f-duration>
            ${durOptions.map((m) => `<option value="${m}">${m === 30 ? "30 min" : (m % 60 === 0 ? (m/60) + " h" : (Math.floor(m/60) + " h " + (m%60) + " min"))}</option>`).join("")}
          </select>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span style="color:rgba(255,255,255,.55); font-size:12px; letter-spacing:.08em; text-transform:uppercase;">Paziente</span>
          <div style="display:flex; gap:10px; align-items:center;">
            <input class="input" data-f-patient-q placeholder="Cerca paziente..." />
            <button class="btn" data-f-patient-clear type="button">Svuota</button>
          </div>
          <div data-f-patient-picked style="margin-top:8px; color: rgba(255,255,255,.90); font-weight:800; display:none;"></div>
          <div data-f-patient-results style="margin-top:8px; display:none; border:1px solid rgba(255,255,255,.10); border-radius:12px; overflow:hidden;"></div>
        </label>

        <label class="field" style="gap:6px;">
          <span style="color:rgba(255,255,255,.55); font-size:12px; letter-spacing:.08em; text-transform:uppercase;">Sede</span>
          <select class="select" data-f-location><option value="">Carico…</option></select>
        </label>

        <label class="field" style="gap:6px;">
          <span style="color:rgba(255,255,255,.55); font-size:12px; letter-spacing:.08em; text-transform:uppercase;">Prestazione</span>
          <select class="select" data-f-service><option value="">Carico…</option></select>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span style="color:rgba(255,255,255,.55); font-size:12px; letter-spacing:.08em; text-transform:uppercase;">Operatore</span>
          <select class="select" data-f-operator></select>
        </label>

        <label class="field" style="gap:6px; grid-column:1 / -1;">
          <span style="color:rgba(255,255,255,.55); font-size:12px; letter-spacing:.08em; text-transform:uppercase;">Note interne</span>
          <textarea class="textarea" data-f-internal placeholder="Note interne..."></textarea>
        </label>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
        <button class="btn" data-f-cancel type="button">Annulla</button>
        <button class="btn primary" data-f-save type="button">Salva</button>
      </div>
    `;

    const elType = modalBody.querySelector("[data-f-type]");
    const elDur = modalBody.querySelector("[data-f-duration]");
    const elLoc = modalBody.querySelector("[data-f-location]");
    const elServ = modalBody.querySelector("[data-f-service]");
    const elOp = modalBody.querySelector("[data-f-operator]");
    const elInternal = modalBody.querySelector("[data-f-internal]");

    // operator select
    const ops = (knownOperators || []).slice();
    elOp.innerHTML = ops.map((o) => `<option value="${String(o.id || "")}">${String(o.name || "").trim()}</option>`).join("");
    const defaultOpId = therapistName ? (operatorNameToId.get(therapistName) || "") : "";
    if (defaultOpId) elOp.value = defaultOpId;

    // locations + services
    loadLocations().then((arr) => {
      elLoc.innerHTML = `<option value="">—</option>` + arr.map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
    });
    loadServices().then((arr) => {
      elServ.innerHTML = `<option value="">—</option>` + arr.map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
    });

    // patient search
    let patientPicked = { id: "", label: "" };
    const qInput = modalBody.querySelector("[data-f-patient-q]");
    const pickedEl = modalBody.querySelector("[data-f-patient-picked]");
    const resultsEl = modalBody.querySelector("[data-f-patient-results]");
    const clearBtn = modalBody.querySelector("[data-f-patient-clear]");
    let t = null;

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
    function hideResults() {
      resultsEl.style.display = "none";
      resultsEl.innerHTML = "";
    }
    async function doSearch() {
      const q = String(qInput.value || "").trim();
      if (q.length < 2) return hideResults();
      const results = await searchPatients(q);
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
        });
      });
      resultsEl.style.display = "";
    }

    qInput.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => doSearch().catch(()=>{}), 250);
    });
    qInput.addEventListener("focus", () => doSearch().catch(()=>{}));
    clearBtn.addEventListener("click", () => { qInput.value = ""; setPicked({ id:"", label:"" }); hideResults(); });

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
          locationId: String(elLoc.value || ""),
          serviceId: String(elServ.value || ""),
          type: String(elType.value || ""),
          durationMin: durMin,
          internalNote: String(elInternal.value || ""),
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

    buildGridSkeleton(start, days, ops.length ? ops : knownTherapists.slice(0, 1));

    // Render cancelled appointments into the band (multi-user only).
    if (multiUser) {
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
  document.addEventListener("scroll", hideHover, true);
  window.addEventListener("resize", hideHover);

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
      if (multiUser) selectedTherapists = new Set(prefs.defaultOperators);
    } else {
      selectedTherapists = new Set(draftSelected);
    }
    multiUser = Boolean(opsMulti?.checked);
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
  prefPick?.addEventListener("click", () => {
    if (!prefDefaultPicker) return;
    if (!prefMulti?.checked) return;
    const open = prefDefaultPicker.style.display !== "none";
    prefDefaultPicker.style.display = open ? "none" : "block";
    if (!open) renderDefaultPickerList();
  });
  prefsReset?.addEventListener("click", () => { resetPrefs(); syncPrefsUI(); toast?.("Reset"); render(); });
  prefMulti?.addEventListener("change", () => {
    if (prefDefaultSection) prefDefaultSection.style.display = prefMulti.checked ? "" : "none";
    if (prefDefaultPicker && !prefMulti.checked) prefDefaultPicker.style.display = "none";
  });
  prefDefaultClose?.addEventListener("click", () => {
    if (prefDefaultPicker) prefDefaultPicker.style.display = "none";
  });
  prefDefaultSearch?.addEventListener("input", () => renderDefaultPickerList());
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
  syncLoginName();
  setView("7days");
})();

