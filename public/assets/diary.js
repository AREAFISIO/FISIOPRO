// Diary (agenda) renderer: week grid similar to OsteoEasy,
// but styled using the existing app.css tokens.
(function () {
  // Build marker (to verify cache-busting in production)
  try {
    window.__FP_DIARY_BUILD = "fpui-20260110e";
    console.info("[Agenda] diary.js build:", window.__FP_DIARY_BUILD);
  } catch {}
  if (typeof window.fpDiaryInit === "function") return;

  window.fpDiaryInit = function fpDiaryInit() {
    // Cleanup previous init (SPA navigation back/forth)
    try {
      if (typeof window.__FP_DIARY_CLEANUP === "function") window.__FP_DIARY_CLEANUP();
    } catch {}
    window.__FP_DIARY_CLEANUP = null;

    // build marker (helps verify cache busting)
    console.log("FISIOPRO diary build", "2b3c1d2-20251231b");
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
  const btnOpenHours = document.querySelector("[data-open-hours]");
  const btnPrev = document.querySelector("[data-cal-prev]");
  const btnNext = document.querySelector("[data-cal-next]");
  const btnToday = document.querySelector("[data-cal-today]");

  const modalBack = document.querySelector("[data-cal-modal]");
  const modalTitle = document.querySelector("[data-cal-modal-title]");
  const modalBody = document.querySelector("[data-cal-modal-body]");
  const modalClose = document.querySelector("[data-cal-modal-close]");

  // Grid time range is computed dynamically from user "work hours" preferences.
  // (Fallback defaults below, can be overridden in preferences.)
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
  let operatorIdToName = new Map(); // recId -> name
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
  let editHoursMode = false;

  // Work slots are stored at 30-min base resolution (stable even if grid slot is 60).
  const BASE_SLOT_MIN = 30;
  const MINUTES_PER_DAY = 24 * 60;

  // Appointments settings (from app.js "Impostazioni Appuntamenti")
  let appointmentsSettingsCache = null; // { cancelband: boolean, drag: boolean, ... }
  function settingsKeyAppointments() {
    const email = String((window.FP_USER?.email || window.FP_SESSION?.email || "anon")).trim().toLowerCase() || "anon";
    return `fp_settings_appointments_${email}`;
  }
  function loadAppointmentsSettingsFromStorage() {
    if (appointmentsSettingsCache) return appointmentsSettingsCache;
    let s = null;
    try { s = JSON.parse(localStorage.getItem(settingsKeyAppointments()) || "null"); } catch {}
    const obj = s && typeof s === "object" ? s : {};
    appointmentsSettingsCache = {
      cancelband: Boolean(obj.cancelband ?? true),
      drag: Boolean(obj.drag ?? true),
      billing: Boolean(obj.billing ?? true),
      showname: Boolean(obj.showname ?? false),
      name: String(obj.name ?? ""),
      info: String(obj.info ?? ""),
    };
    return appointmentsSettingsCache;
  }

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

  // Confirm dialog (centered) for out-of-hours actions.
  // Requirement: do NOT block creation/move, but warn + ask confirmation first.
  let __fpHoursConfirmEl = null;
  let __fpHoursConfirmResolve = null;
  function ensureHoursConfirmUi() {
    if (__fpHoursConfirmEl) return __fpHoursConfirmEl;

    // One-time style (kept inside diary.js to avoid touching page HTML)
    if (!document.getElementById("fp-hours-confirm-style")) {
      const st = document.createElement("style");
      st.id = "fp-hours-confirm-style";
      st.textContent = `
        .fp-hours-confirm-back{
          position: fixed;
          inset: 0;
          z-index: 85;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 18px;
          background: rgba(0,0,0,.55);
        }
        .fp-hours-confirm{
          width: min(560px, 96vw);
          border-radius: 18px;
          background: var(--panelSolid);
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
          overflow: hidden;
          color: var(--text);
        }
        .fp-hours-confirm__head{
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--text) 6%, transparent),
            color-mix(in srgb, var(--text) 2%, transparent)
          );
        }
        .fp-hours-confirm__title{
          font-weight: 1000;
          font-size: 18px;
          letter-spacing: -.1px;
        }
        .fp-hours-confirm__body{
          padding: 14px 16px 16px;
          font-size: 15px;
          line-height: 1.55;
          color: var(--muted);
        }
        .fp-hours-confirm__foot{
          padding: 14px 16px;
          border-top: 1px solid var(--border);
          display:flex;
          justify-content:flex-end;
          gap:10px;
          flex-wrap:wrap;
        }
        .fp-hours-confirm__warn{
          display:flex;
          gap:10px;
          align-items:flex-start;
          padding: 12px 12px;
          border-radius: 14px;
          border: 1px solid rgba(255, 122, 0, .22);
          background: rgba(255, 122, 0, .10);
          color: var(--text);
        }
        .fp-hours-confirm__warn .ic{ font-size: 18px; line-height: 1; margin-top: 1px; }
      `;
      document.head.appendChild(st);
    }

    const back = document.createElement("div");
    back.className = "fp-hours-confirm-back";
    back.setAttribute("data-fp-hours-confirm", "1");
    back.innerHTML = `
      <div class="fp-hours-confirm" role="dialog" aria-modal="true" aria-labelledby="fp-hours-confirm-title">
        <div class="fp-hours-confirm__head">
          <div class="fp-hours-confirm__title" id="fp-hours-confirm-title">Fuori orario di lavoro</div>
          <button class="btn" type="button" data-fp-hours-cancel>Chiudi</button>
        </div>
        <div class="fp-hours-confirm__body">
          <div class="fp-hours-confirm__warn">
            <div class="ic">⚠️</div>
            <div style="min-width:0;">
              <div style="font-weight:1000;">Questo slot risulta non lavorativo.</div>
              <div style="margin-top:6px; opacity:.88;" data-fp-hours-msg></div>
            </div>
          </div>
          <div style="margin-top:12px; opacity:.80;">
            Vuoi comunque proseguire e creare/spostare l’appuntamento?
          </div>
        </div>
        <div class="fp-hours-confirm__foot">
          <button class="btn" type="button" data-fp-hours-no>Annulla</button>
          <button class="btn primary" type="button" data-fp-hours-yes>Sì, prosegui</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);

    const close = (val) => {
      back.style.display = "none";
      const r = __fpHoursConfirmResolve;
      __fpHoursConfirmResolve = null;
      if (typeof r === "function") r(Boolean(val));
    };

    back.addEventListener("click", (e) => {
      if (e.target === back) close(false);
    });
    back.querySelector("[data-fp-hours-cancel]")?.addEventListener("click", () => close(false));
    back.querySelector("[data-fp-hours-no]")?.addEventListener("click", () => close(false));
    back.querySelector("[data-fp-hours-yes]")?.addEventListener("click", () => close(true));

    // Esc to cancel
    const onKey = (e) => {
      if (back.style.display === "none") return;
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);

    __fpHoursConfirmEl = back;
    return back;
  }

  function confirmOutsideWorkingHours({ whenLabel = "", therapistName = "", mode = "proseguire" } = {}) {
    const back = ensureHoursConfirmUi();
    const msgEl = back.querySelector("[data-fp-hours-msg]");
    const when = String(whenLabel || "").trim();
    const ther = String(therapistName || "").trim();
    const parts = [];
    if (when) parts.push(when);
    if (ther) parts.push(ther);
    if (msgEl) msgEl.textContent = parts.length ? parts.join(" • ") : "—";

    // tweak verb (create vs move)
    const bodyLine = back.querySelector(".fp-hours-confirm__body > div:last-child");
    if (bodyLine) {
      const v = String(mode || "proseguire").toLowerCase().includes("spost")
        ? "Vuoi comunque proseguire e spostare l’appuntamento?"
        : "Vuoi comunque proseguire e creare l’appuntamento?";
      bodyLine.textContent = v;
    }

    back.style.display = "flex";
    return new Promise((resolve) => {
      __fpHoursConfirmResolve = resolve;
      // focus default action (safe: cancel first)
      try { back.querySelector("[data-fp-hours-no]")?.focus?.(); } catch {}
    });
  }

  // Confirm dialog for appointment MOVE (replaces native window.confirm so it can be styled).
  let __fpMoveConfirmEl = null;
  let __fpMoveConfirmResolve = null;
  function ensureMoveConfirmUi() {
    if (__fpMoveConfirmEl) return __fpMoveConfirmEl;

    if (!document.getElementById("fp-move-confirm-style")) {
      const st = document.createElement("style");
      st.id = "fp-move-confirm-style";
      st.textContent = `
        .fp-move-confirm-back{
          position: fixed;
          inset: 0;
          z-index: 90;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 18px;
          background: rgba(0,0,0,.72);
          backdrop-filter: blur(6px);
        }
        .fp-move-confirm{
          width: min(720px, 96vw);
          border-radius: 20px;
          background: var(--panelSolid);
          border: 2px solid color-mix(in srgb, var(--accent-2) 42%, rgba(255,255,255,.10));
          box-shadow: 0 28px 90px rgba(0,0,0,.55);
          overflow: hidden;
          color: var(--text);
        }
        .fp-move-confirm__head{
          padding: 16px 18px;
          border-bottom: 1px solid var(--border);
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent-2) 18%, transparent),
            color-mix(in srgb, var(--text) 2%, transparent)
          );
        }
        .fp-move-confirm__title{
          font-weight: 1000;
          font-size: 20px;
          letter-spacing: -.2px;
        }
        .fp-move-confirm__body{
          padding: 16px 18px 18px;
          font-size: 16px;
          line-height: 1.55;
        }
        .fp-move-confirm__box{
          margin-top: 12px;
          padding: 12px 12px;
          border-radius: 16px;
          border: 1px solid var(--border);
          background: color-mix(in srgb, var(--btnBg) 80%, transparent);
        }
        .fp-move-confirm__row{
          display:flex;
          gap:10px;
          align-items:flex-start;
          margin: 10px 0;
        }
        .fp-move-confirm__k{
          width: 34px;
          flex: 0 0 34px;
          display:grid;
          place-items:center;
          font-weight: 1000;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: color-mix(in srgb, var(--text) 6%, transparent);
          color: var(--text);
        }
        .fp-move-confirm__v{
          min-width: 0;
          font-weight: 950;
          color: var(--text);
          word-break: break-word;
        }
        .fp-move-confirm__hint{
          margin-top: 10px;
          color: var(--muted);
          font-size: 13px;
          font-weight: 800;
        }
        .fp-move-confirm__foot{
          padding: 16px 18px;
          border-top: 1px solid var(--border);
          display:flex;
          justify-content:flex-end;
          gap:12px;
          flex-wrap:wrap;
        }
        .fp-move-confirm__btn{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:10px;
          padding: 12px 18px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: var(--btnBg);
          color: var(--text);
          cursor: pointer;
          font-weight: 1000;
          min-width: 140px;
        }
        .fp-move-confirm__btn:hover{ transform: translateY(-1px); background: var(--btnBgHover); }
        .fp-move-confirm__btn:active{ transform: translateY(0); }
        .fp-move-confirm__btn.ok{
          border-color: color-mix(in srgb, var(--accent-2) 55%, var(--border));
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent-2) 26%, transparent),
            color-mix(in srgb, var(--accent) 14%, transparent)
          );
        }
      `;
      document.head.appendChild(st);
    }

    const back = document.createElement("div");
    back.className = "fp-move-confirm-back";
    back.setAttribute("data-fp-move-confirm", "1");
    back.innerHTML = `
      <div class="fp-move-confirm" role="dialog" aria-modal="true" aria-labelledby="fp-move-confirm-title">
        <div class="fp-move-confirm__head">
          <div class="fp-move-confirm__title" id="fp-move-confirm-title">Confermi lo spostamento dell’appuntamento?</div>
          <button class="btn" type="button" data-fp-move-cancel aria-label="Chiudi">×</button>
        </div>
        <div class="fp-move-confirm__body">
          <div class="fp-move-confirm__box">
            <div class="fp-move-confirm__row">
              <div class="fp-move-confirm__k">DA</div>
              <div class="fp-move-confirm__v" data-fp-move-from>—</div>
            </div>
            <div class="fp-move-confirm__row">
              <div class="fp-move-confirm__k">A</div>
              <div class="fp-move-confirm__v" data-fp-move-to>—</div>
            </div>
          </div>
          <div class="fp-move-confirm__hint">Suggerimento: se non sei sicuro, premi “Annulla”.</div>
        </div>
        <div class="fp-move-confirm__foot">
          <button class="fp-move-confirm__btn" type="button" data-fp-move-no>Annulla</button>
          <button class="fp-move-confirm__btn ok" type="button" data-fp-move-yes>OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);

    const close = (ok) => {
      back.style.display = "none";
      if (typeof __fpMoveConfirmResolve === "function") __fpMoveConfirmResolve(Boolean(ok));
      __fpMoveConfirmResolve = null;
    };
    back.addEventListener("click", (e) => {
      if (e.target === back) close(false);
    });
    back.querySelector("[data-fp-move-cancel]")?.addEventListener("click", () => close(false));
    back.querySelector("[data-fp-move-no]")?.addEventListener("click", () => close(false));
    back.querySelector("[data-fp-move-yes]")?.addEventListener("click", () => close(true));

    const onKey = (e) => {
      if (back.style.display === "none") return;
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);

    __fpMoveConfirmEl = back;
    return back;
  }

  function confirmMoveAppointment({ fromLabel = "", toLabel = "" } = {}) {
    const back = ensureMoveConfirmUi();
    const fromEl = back.querySelector("[data-fp-move-from]");
    const toEl = back.querySelector("[data-fp-move-to]");
    if (fromEl) fromEl.textContent = String(fromLabel || "").trim() || "—";
    if (toEl) toEl.textContent = String(toLabel || "").trim() || "—";
    back.style.display = "flex";
    return new Promise((resolve) => {
      __fpMoveConfirmResolve = resolve;
      try { back.querySelector("[data-fp-move-no]")?.focus?.(); } catch {}
    });
  }

  function showSlotHover(ctx, x, y) {
    if (!ctx) return;
    if (modalBack && modalBack.style.display !== "none") return;

    const time = String(ctx.time || "").trim() || "—";
    const ther = String(ctx.therapist || "").trim() || "—";
    const loc = String(ctx.location || "").trim(); // requested: empty in empty slots

    slotHoverCard.querySelector("[data-slot-time]").textContent = time;
    slotHoverCard.querySelector("[data-slot-ther]").textContent = ther;
    const locEl = slotHoverCard.querySelector("[data-slot-loc]");
    if (locEl) {
      locEl.textContent = loc;
      const row = locEl.closest(".oe-hovercard__row");
      if (row) row.style.display = loc ? "" : "none";
    }

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
      <div class="t">${item.patient || "Paziente"}</div>
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
  const prefOpColorsSection = document.querySelector("[data-pref-opcolors-section]");
  const prefOpColorsWrap = document.querySelector("[data-pref-opcolors]");
  const prefOpColorsHint = document.querySelector("[data-pref-opcolors-hint]");

  let prefs = {
    slotMin: 30,
    multiUser: false,
    defaultOperators: [],
    doubleOperators: [],
    // Per-operator slot overrides:
    // {
    //   "<therapistName|DEFAULT>": {
    //     "0".."6": { "<minute>": { on:boolean, locationId?:string, locationName?:string } }
    //   }
    // }
    workSlots: {},
    showService: true,
    dayNav: false,
    userColor: "",
    operatorColors: {}, // { [operatorId]: "#RRGGBB" }
  };

  function normalizeHexColor(s) {
    const x = String(s || "").trim();
    if (!x) return "";
    const m = x.match(/^#([0-9a-fA-F]{6})$/);
    return m ? ("#" + m[1].toUpperCase()) : "";
  }

  function hslToRgb(h, s, l) {
    const hh = ((Number(h) % 360) + 360) % 360;
    const ss = Math.max(0, Math.min(1, Number(s)));
    const ll = Math.max(0, Math.min(1, Number(l)));
    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = ll - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;
    if (hh < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (hh < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (hh < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (hh < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (hh < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    return { r, g, b };
  }

  function rgbToHex({ r, g, b }) {
    const to2 = (n) => String(Math.max(0, Math.min(255, Number(n) || 0)).toString(16)).padStart(2, "0").toUpperCase();
    return `#${to2(r)}${to2(g)}${to2(b)}`;
  }

  function defaultHexForName(name) {
    const s = String(name || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return rgbToHex(hslToRgb(hue, 0.78, 0.55));
  }

  function hexToRgb(hex) {
    const h = String(hex || "").trim();
    const m = h.match(/^#([0-9a-fA-F]{6})$/);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbaFromColor(color, alpha) {
    const a = Math.max(0, Math.min(1, Number(alpha)));
    const c = String(color || "").trim();
    if (!c) return "";
    if (c.startsWith("#")) {
      const rgb = hexToRgb(c);
      if (!rgb) return c;
      return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
    }
    if (c.startsWith("hsl(") || c.startsWith("hsla(")) {
      if (c.includes("/")) return c.replace(/\/\s*[\d.]+\s*\)/, `/ ${a})`);
      return c;
    }
    return c;
  }

  function escapeHtml(x) {
    return String(x ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // Attribute-safe escaping (for option values, data-*).
  // Our HTML escape is already safe for quotes; keep a dedicated helper for readability.
  function escapeAttr(x) {
    return escapeHtml(x);
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function timeToMin(s) {
    const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }
  function minToTime(min) {
    const m = clamp(Number(min) || 0, 0, 24 * 60 - 1);
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  function weekdayIdxMon0(d) { return (d.getDay() + 6) % 7; } // lun=0..dom=6
  const WEEKDAY_LABELS = ["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"];

  // Global availability (from "Impostazioni Disponibilità" modal in app.js).
  // Stored in localStorage as: fp_settings_availability_<emailLower>.
  let settingsAvailabilityCache = null; // { byTher: Map<therKey, Map<wIdx, Map<minute, {status, locationId}>> > }

  function settingsKeyAvailability() {
    const email = String((window.FP_USER?.email || window.FP_SESSION?.email || "anon")).trim().toLowerCase() || "anon";
    return `fp_settings_availability_${email}`;
  }

  function getLocationNameSync(locationId) {
    const id = String(locationId || "").trim();
    if (!id) return "";
    const items = Array.isArray(locationsCache) ? locationsCache : null;
    if (!items) return "";
    const hit = items.find((x) => String(x?.id || "").trim() === id);
    return hit ? String(hit.name || hit.nome || hit.label || hit.id || "").trim() : "";
  }

  function loadSettingsAvailability() {
    if (settingsAvailabilityCache) return settingsAvailabilityCache;
    const byTher = new Map();

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(settingsKeyAvailability()) || "null"); } catch {}

    const parseSlotsMap = (slotsObj) => {
      const dayMin = new Map();
      const slots = slotsObj && typeof slotsObj === "object" ? slotsObj : null;
      if (!slots) return dayMin;
      for (const [k, v] of Object.entries(slots)) {
        const key = String(k || "");
        const m = key.match(/^(\d+):(\d+)$/);
        if (!m) continue;
        const wIdx = Number(m[1]);          // 0..6 (lun..dom)
        const rIdx = Number(m[2]);          // 30-min row from 07:00
        if (!Number.isFinite(wIdx) || !Number.isFinite(rIdx)) continue;
        if (wIdx < 0 || wIdx > 6) continue;
        if (rIdx < 0 || rIdx > 1000) continue;

        const status = String(v?.status || "").toLowerCase();
        if (status !== "work" && status !== "off") continue;
        const locationId = String(v?.locationId || "");

        const minute = (7 * 60) + (rIdx * 30);
        if (minute < 0 || minute >= MINUTES_PER_DAY) continue;

        if (!dayMin.has(wIdx)) dayMin.set(wIdx, new Map());
        dayMin.get(wIdx).set(minute, { status, locationId });
      }
      return dayMin;
    };

    const sObj = saved && typeof saved === "object" ? saved : null;
    const byTherRaw = sObj?.byTherapist && typeof sObj.byTherapist === "object" ? sObj.byTherapist : null;
    if (byTherRaw) {
      for (const [ther, slots] of Object.entries(byTherRaw)) {
        byTher.set(String(ther || "DEFAULT"), parseSlotsMap(slots));
      }
    } else if (sObj?.slots && typeof sObj.slots === "object") {
      byTher.set("DEFAULT", parseSlotsMap(sObj.slots));
    } else {
      // legacy: saved.on = ["d:r", ...] => work
      const dayMin = new Map();
      const on = Array.isArray(sObj?.on) ? sObj.on : [];
      on.forEach((k) => {
        const key = String(k || "");
        const m = key.match(/^(\d+):(\d+)$/);
        if (!m) return;
        const wIdx = Number(m[1]);
        const rIdx = Number(m[2]);
        if (!Number.isFinite(wIdx) || !Number.isFinite(rIdx)) return;
        const minute = (7 * 60) + (rIdx * 30);
        if (!dayMin.has(wIdx)) dayMin.set(wIdx, new Map());
        dayMin.get(wIdx).set(minute, { status: "work", locationId: "" });
      });
      byTher.set("DEFAULT", dayMin);
    }

    settingsAvailabilityCache = { byTher };
    return settingsAvailabilityCache;
  }

  function normTherapistKeyForSlots(name) {
    const s = String(name || "").trim();
    return s || "DEFAULT";
  }

  function roundDownToBase(min) {
    const m = clamp(Number(min) || 0, 0, MINUTES_PER_DAY - 1);
    return Math.floor(m / BASE_SLOT_MIN) * BASE_SLOT_MIN;
  }
  function roundUpToBaseExclusive(min) {
    const m = clamp(Number(min) || 0, 0, MINUTES_PER_DAY);
    return Math.ceil(m / BASE_SLOT_MIN) * BASE_SLOT_MIN;
  }

  function getSlotRule(therapistName, dateObj, minuteOfDay) {
    const key = normTherapistKeyForSlots(therapistName);
    const wIdx = weekdayIdxMon0(dateObj);
    const m = String(roundDownToBase(minuteOfDay));
    const store = prefs.workSlots || {};
    const byTher = store[key] || store.DEFAULT || null;
    const byDay = byTher ? (byTher[String(wIdx)] || null) : null;
    const hit = byDay ? byDay[m] : null;
    if (hit && typeof hit === "object") return { on: Boolean(hit.on), locationId: hit.locationId || "", locationName: hit.locationName || "" };

    // Fallback to global availability settings (new modal).
    const av = loadSettingsAvailability();
    const mm = Number(m);
    const therKey = normTherapistKeyForSlots(therapistName);
    const dayMinMap =
      av?.byTher?.get?.(therKey) ||
      av?.byTher?.get?.("DEFAULT") ||
      null;
    const byW = dayMinMap ? (dayMinMap.get(wIdx) || null) : null;
    const rec = byW ? (byW.get(mm) || null) : null;
    if (rec && typeof rec === "object") {
      const on = String(rec.status) === "work";
      const locationId = String(rec.locationId || "");
      const locationName = getLocationNameSync(locationId);
      return { on, locationId, locationName };
    }

    // Default baseline: NON lavorativo (OsteoEasy-like).
    return { on: false, locationId: "", locationName: "" };
  }

  function setSlotRuleRange({ therapistName, dateObj, startMin, endMinExclusive, on, locationId, locationName }) {
    const key = normTherapistKeyForSlots(therapistName);
    const wIdx = String(weekdayIdxMon0(dateObj));
    prefs.workSlots = prefs.workSlots && typeof prefs.workSlots === "object" ? prefs.workSlots : {};
    if (!prefs.workSlots[key]) prefs.workSlots[key] = {};
    if (!prefs.workSlots[key][wIdx]) prefs.workSlots[key][wIdx] = {};
    const dayMap = prefs.workSlots[key][wIdx];

    const a = roundDownToBase(startMin);
    const b = roundUpToBaseExclusive(endMinExclusive);
    for (let m = a; m < b; m += BASE_SLOT_MIN) {
      dayMap[String(m)] = on
        ? { on: true, locationId: String(locationId || ""), locationName: String(locationName || "") }
        : { on: false };
    }
  }

  function clearSelectionOverlays() {
    document.querySelectorAll("[data-slot-sel]").forEach((el) => el.remove());
  }

  function showSelectionOverlay(col, topPx, heightPx) {
    if (!col) return;
    clearSelectionOverlays();
    const sel = document.createElement("div");
    sel.setAttribute("data-slot-sel", "1");
    sel.style.position = "absolute";
    sel.style.left = "10px";
    sel.style.right = "10px";
    sel.style.top = Math.round(topPx) + "px";
    sel.style.height = Math.max(8, Math.round(heightPx)) + "px";
    sel.style.border = "2px solid rgba(75, 165, 255, .95)";
    sel.style.borderRadius = "8px";
    sel.style.boxShadow = "0 0 0 2px rgba(0,0,0,.15) inset";
    sel.style.background = "rgba(75, 165, 255, .12)";
    sel.style.pointerEvents = "none";
    sel.style.zIndex = "5";
    col.appendChild(sel);
  }

  function buildSlotEditModal() {
    if (document.querySelector("[data-slot-edit-back]")) return;
    const back = document.createElement("div");
    back.className = "oe-modal__backdrop";
    back.style.display = "none";
    back.setAttribute("data-slot-edit-back", "1");
    back.innerHTML = `
      <div class="oe-modal" role="dialog" aria-modal="true" style="max-width: 620px;">
        <div class="oe-modal__header">
          <div class="oe-modal__title">1 slot selezionato</div>
          <button class="oe-modal__x" data-slot-edit-close aria-label="Chiudi">×</button>
        </div>
        <div class="oe-modal__body">
          <div style="display:flex; align-items:center; gap:18px; margin-bottom: 10px;">
            <label style="display:flex; align-items:center; gap:8px; font-weight:900;">
              <input type="radio" name="fp_slot_mode" value="off" />
              <span>Non lavorativo</span>
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-weight:900;">
              <input type="radio" name="fp_slot_mode" value="on" checked />
              <span>Lavorativo</span>
            </label>
          </div>
          <div style="opacity:.85; font-weight:900; margin: 10px 0 8px;">Luogo di lavoro:</div>
          <div data-slot-edit-locs style="display:flex; flex-direction:column; gap:10px;"></div>
        </div>
        <div class="oe-modal__footer">
          <button class="oe-btn oe-btn--primary" data-slot-edit-ok>OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);
  }

  async function openSlotEditModal({ therapistName, dateObj, startMin, endMinExclusive }) {
    buildSlotEditModal();
    const back = document.querySelector("[data-slot-edit-back]");
    if (!back) return;
    const title = back.querySelector(".oe-modal__title");
    const list = back.querySelector("[data-slot-edit-locs]");
    const btnOk = back.querySelector("[data-slot-edit-ok]");
    const btnClose = back.querySelector("[data-slot-edit-close]");
    const radios = Array.from(back.querySelectorAll("input[name=\"fp_slot_mode\"]"));

    const slots = [];
    for (let m = roundDownToBase(startMin); m < roundUpToBaseExclusive(endMinExclusive); m += BASE_SLOT_MIN) {
      slots.push(getSlotRule(therapistName, dateObj, m));
    }
    const count = slots.length;
    if (title) title.textContent = `${count} slot selezionat${count === 1 ? "o" : "i"}`;

    // Infer current selection (if all same)
    const allOn = slots.every((s) => s.on === true);
    const allOff = slots.every((s) => s.on === false);
    const mode = allOff ? "off" : "on"; // default to on when mixed
    radios.forEach((r) => { r.checked = (r.value === mode); });

    let chosenLocId = "";
    if (allOn) {
      const ids = new Set(slots.map((s) => String(s.locationId || "")).filter(Boolean));
      if (ids.size === 1) chosenLocId = Array.from(ids)[0];
    }

    // Load locations
    let locs = [];
    try {
      locs = await loadLocations();
    } catch (e) {
      console.warn("loadLocations failed", e);
      locs = [];
    }
    if (list) {
      list.innerHTML = "";
      const items = Array.isArray(locs) ? locs : [];
      items.forEach((x) => {
        const id = String(x.id || "");
        const name = String(x.name || x.label || id);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "btn";
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.padding = "12px 14px";
        row.style.borderRadius = "14px";
        row.style.border = chosenLocId === id ? "1px solid rgba(34,230,195,.55)" : "1px solid rgba(255,255,255,.16)";
        row.style.background = chosenLocId === id ? "rgba(34,230,195,.12)" : "rgba(255,255,255,.04)";
        row.style.fontWeight = "1000";
        row.innerHTML = `<span style="display:flex; align-items:center; gap:10px;">
            <span style="width:22px; height:22px; border-radius:8px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.18); background:${chosenLocId === id ? "rgba(34,230,195,.22)" : "rgba(0,0,0,.10)"};">
              ${chosenLocId === id ? "✓" : ""}
            </span>
            <span>${name}</span>
          </span>`;
        row.addEventListener("click", () => {
          chosenLocId = id;
          // rerender highlight quickly
          openSlotEditModal({ therapistName, dateObj, startMin, endMinExclusive }).catch(()=>{});
        }, { once: true });
        list.appendChild(row);
      });
    }

    const close = () => { back.style.display = "none"; clearSelectionOverlays(); };
    btnClose && (btnClose.onclick = close);
    back.onclick = (e) => { if (e.target === back) close(); };

    btnOk && (btnOk.onclick = () => {
      const chosenMode = (radios.find((r) => r.checked)?.value || "on");
      const on = chosenMode === "on";
      const loc = (Array.isArray(locs) ? locs : []).find((x) => String(x.id || "") === String(chosenLocId || "")) || null;
      setSlotRuleRange({
        therapistName,
        dateObj,
        startMin,
        endMinExclusive,
        on,
        locationId: on ? (loc?.id || chosenLocId || "") : "",
        locationName: on ? (loc?.name || "") : "",
      });
      savePrefs();
      close();
      render();
    });

    back.style.display = "flex";
  }

  // NOTE: removed "work hours default" editor. Availability is only slot-based.

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
    return WEEKDAY_LABELS[(d.getDay() + 6) % 7];
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

  function pickTextField(fields, keys) {
    for (const k of keys) {
      if (!fields) continue;
      const v = fields[k];
      if (v == null) continue;
      // Avoid linked-record arrays (Airtable IDs)
      if (Array.isArray(v)) continue;
      const s = String(v).trim();
      if (!s) continue;
      // Avoid showing Airtable record ids as "names"
      if (s.startsWith("rec") && s.length >= 12 && !s.includes(" ")) continue;
      return v;
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

  function backfillTherapistNamesFromIds() {
    if (!rawItems || !rawItems.length) return;
    let changed = 0;
    for (const it of rawItems) {
      if (!it) continue;
      const ther = String(it.therapist || "").trim();
      if (ther) continue;
      const id = String(it?.fields?.therapist_id || it?.fields?.collaboratoreId || it?.fields?.operatorId || "").trim();
      if (!id) continue;
      const name = String(operatorIdToName.get(id) || "").trim();
      if (!name) continue;
      it.therapist = name;
      changed += 1;
    }
    if (changed) {
      try { rebuildSlotLocationIndex(); } catch {}
      try { if (!knownTherapists.length) knownTherapists = getTherapists(rawItems); } catch {}
    }
  }

  function normalizeItem(x) {
    const f = x.fields || {};
    const start = pickField(f, ["Data e ora INIZIO", "Start", "Inizio", "start_at", "StartAt"]);
    const end = pickField(f, ["Data e ora FINE", "End", "Fine", "end_at", "EndAt"]);
    let therapist = String(x.operator || "").trim() || pickField(f, ["Collaboratore", "Collaborator", "Operatore", "Operator", "Fisioterapista", "Therapist", "therapist_name", "Email"]) || "";
    const therapistId = String(pickField(f, ["therapist_id", "collaboratoreId", "operatorId", "CollaboratoreId"]) || "").trim();
    if (!therapist) {
      if (therapistId) therapist = String(operatorIdToName.get(therapistId) || "").trim();
    }
    // In case Operatore is still an array, normalize to a readable string.
    if (Array.isArray(therapist)) therapist = therapist.filter(Boolean).join(", ");
    // If it contains multiple names, pick the first for column placement
    if (typeof therapist === "string" && therapist.includes(",")) therapist = therapist.split(",")[0].trim();

    // Normalize therapistId:
    // - if already a record id (rec...), keep
    // - else try to map the display name to an operator record id
    let therapistIdNorm = therapistId;
    if (!therapistIdNorm || !String(therapistIdNorm).startsWith("rec")) {
      const byName = String(operatorNameToId.get(String(therapist || "").trim()) || "").trim();
      if (byName) therapistIdNorm = byName;
      else {
        const byIdLoose = String(operatorNameToId.get(String(therapistIdNorm || "").trim()) || "").trim();
        if (byIdLoose) therapistIdNorm = byIdLoose;
      }
    }
    const service = pickField(f, ["Prestazione", "Servizio", "service_name"]) || "";
    const status = pickField(f, ["Stato appuntamento", "Stato", "status"]) || "";

    // patient can be link-array; attempt text variants, then fallback.
    const patient =
      String(pickTextField(f, [
        "Paziente (testo)",
        "Nome Paziente",
        "Cognome e Nome",
        "Paziente testo",
        "Patient name",
        "patient_name",
        "Patient",
        // keep last: sometimes it's already a text field; if it's a linked-record id, pickTextField will ignore it
        "Paziente",
      ]) || "").trim();

    let patientId = "";
    if (Array.isArray(f.Paziente) && f.Paziente.length && typeof f.Paziente[0] === "string") {
      patientId = String(f.Paziente[0] || "").trim();
    }
    if (!patientId) {
      const pid = pickField(f, ["patient_id", "PatientId", "PazienteId", "paziente_id"]);
      patientId = String(pid || "").trim();
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
      therapistId: String(therapistIdNorm || "").trim(),
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
    const solid = solidForTherapist(name);
    return rgbaFromColor(solid, 0.18) || "rgba(34,230,195,.14)";
  }

  function solidForTherapist(name) {
    const n = String(name || "").trim();
    const oc = prefs?.operatorColors && typeof prefs.operatorColors === "object" ? prefs.operatorColors : {};
    const opId = operatorNameToId.get(n) || "";
    const byId = opId ? normalizeHexColor(oc[opId]) : "";
    if (byId) return byId;

    // Back-compat: userColor (applies to "me" only)
    const me = String(getUserName() || "").trim();
    const my = normalizeHexColor(prefs.userColor);
    if (my && me && n === me) return my;

    return defaultHexForName(n) || "#22E6C3";
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

  function getUserRoleNorm() {
    const u = window.FP_USER || window.FP_SESSION || null;
    const raw = String(u?.role || u?.roleLabel || "").trim().toLowerCase();
    if (!raw) return "";
    if (raw === "ceo" || raw.includes("manager") || raw.includes("admin") || raw.includes("amministr")) return "manager";
    if (raw.includes("front")) return "front";
    if (raw.includes("physio") || raw.includes("fisioterap")) return "physio";
    return raw;
  }

  function canEditOperatorColors() {
    const r = getUserRoleNorm();
    return r === "front" || r === "manager";
  }

  function ensureMeInSelection(set) {
    // For CEO/Manager: don't force a "CEO agenda" column, but if the same email
    // is also a physiotherapist, include that *physio operator* name so they can
    // still see their clinical agenda.
    if (!set) return;
    const role = getUserRoleNorm();
    if (role === "manager") {
      const email = getUserEmail();
      const physioName = email ? String(knownByEmail.get(email) || "").trim() : "";
      if (physioName) set.add(physioName);
      return;
    }
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

  function ensureUserMappedOrWarn() {
    // Agenda is mission-critical: if the logged-in user can't be mapped to an operator,
    // tell them explicitly instead of silently hiding appointments.
    const email = getUserEmail();
    if (!email) return;
    if (!knownByEmail || !knownByEmail.has(email)) {
      try {
        console.warn("[Agenda] user email not mapped to operator:", email);
      } catch {}
      try {
        // Non-blocking toast; doesn't interrupt workflow.
        if (typeof window.toast === "function") window.toast("Attenzione: utente non mappato a Collaboratore (controlla email in COLLABORATORI).");
      } catch {}
    }
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
      if (obj && typeof obj === "object") {
        // Never restore operatorColors from local storage (shared server-side)
        const { operatorColors: _ignore, ...rest } = obj;
        prefs = { ...prefs, ...rest };
      }
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
      // Keep the current user's agenda visible only for non-manager roles.
      ensureMeInSelection(selectedTherapists);
      // If nothing selected, fallback:
      // - physio/front: self
      // - manager: wait for load() to auto-select all operators once we know them
      if (!selectedTherapists.size && me && getUserRoleNorm() !== "manager") selectedTherapists.add(me);
    } else {
      selectedTherapists = new Set();
      if (me) selectedTherapists.add(me);
    }
    if (selectedTherapists.size) didApplyDefaultSelectionOnce = true;
  }
  function savePrefs() {
    // operatorColors are shared (server-side) and must not be stored per-user in localStorage
    try {
      const toSave = { ...(prefs || {}) };
      delete toSave.operatorColors;
      localStorage.setItem(prefsKey(), JSON.stringify(toSave));
    } catch {}
  }
  function resetPrefs() {
    prefs = {
      slotMin: 30,
      multiUser: false,
      defaultOperators: [],
      doubleOperators: [],
      workSlots: {},
      showService: true,
      dayNav: false,
      userColor: "",
      operatorColors: {},
    };
    SLOT_MIN = 30;
    multiUser = false;
    savePrefs();
  }

  function ensureOperatorColorsObject() {
    if (!prefs || typeof prefs !== "object") return;
    if (!prefs.operatorColors || typeof prefs.operatorColors !== "object") prefs.operatorColors = {};
  }

  function migrateUserColorToOperatorColorIfNeeded() {
    // Back-compat: older configs had only prefs.userColor.
    // If we can map "me" to an operator id, copy it into operatorColors once.
    ensureOperatorColorsObject();
    const my = normalizeHexColor(prefs.userColor);
    if (!my) return;
    const me = String(getUserName() || "").trim();
    if (!me) return;
    const myOpId = operatorNameToId.get(me) || "";
    if (!myOpId) return;
    if (!normalizeHexColor(prefs.operatorColors[myOpId])) {
      prefs.operatorColors[myOpId] = my;
    }
  }

  function renderOperatorColorsUI() {
    if (!prefOpColorsSection || !prefOpColorsWrap) return;
    ensureOperatorColorsObject();
    migrateUserColorToOperatorColorIfNeeded();

    const roleCanEditAll = canEditOperatorColors();
    const me = String(getUserName() || "").trim();
    const myOpId = me ? (operatorNameToId.get(me) || "") : "";

    // If we don't have operators yet, show placeholder.
    if (!Array.isArray(knownOperators) || knownOperators.length === 0) {
      prefOpColorsWrap.innerHTML = `<div style="padding:12px 12px; opacity:.75; font-weight:800;">Carico collaboratori…</div>`;
      // hide section only if user can't edit and no data; otherwise keep it visible
      prefOpColorsSection.style.display = "";
      if (prefOpColorsHint) prefOpColorsHint.style.display = roleCanEditAll ? "" : "none";
      return;
    }

    // Visibility: show for everyone, but edit rules differ
    prefOpColorsSection.style.display = "";
    if (prefOpColorsHint) prefOpColorsHint.style.display = roleCanEditAll ? "" : "none";

    const ops = (knownOperators || [])
      .map((o) => ({ id: String(o.id || "").trim(), name: String(o.name || "").trim(), role: normalizeRoleLabel(o.role || "") }))
      .filter((o) => o.id && o.name)
      .sort((a, b) => a.name.localeCompare(b.name, "it"));

    // Build rows
    prefOpColorsWrap.innerHTML = ops.map((o) => {
      const saved = normalizeHexColor(prefs.operatorColors[o.id]);
      const fallback = defaultHexForName(o.name);
      const val = saved || fallback || "#22E6C3";
      const canEditThis = roleCanEditAll || (myOpId && o.id === myOpId);
      const roleTxt = o.role ? ` • ${escapeHtml(o.role)}` : "";
      return `
        <div data-opcolor-row="${escapeHtml(o.id)}" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.08);">
          <div style="display:flex; align-items:center; gap:10px; min-width:0;">
            <div class="opsDot" data-opcolor-dot style="width:22px;height:22px;background:${escapeHtml(val)}; border:1px solid rgba(255,255,255,.22);"></div>
            <div style="min-width:0;">
              <div style="font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(o.name)}${roleTxt}</div>
              <div style="opacity:.65; font-size:12px; margin-top:2px;">${escapeHtml(o.id)}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="colorSwatch" style="width:56px; height:34px;">
              <input type="color" data-opcolor-input value="${escapeHtml(val)}" ${canEditThis ? "" : "disabled"} />
            </div>
          </div>
        </div>
      `;
    }).join("");

    // Remove last border
    try {
      const rows = Array.from(prefOpColorsWrap.querySelectorAll("[data-opcolor-row]"));
      if (rows.length) rows[rows.length - 1].style.borderBottom = "none";
    } catch {}

    // Live preview in the list (without saving yet)
    prefOpColorsWrap.querySelectorAll("[data-opcolor-row]").forEach((row) => {
      const id = String(row.getAttribute("data-opcolor-row") || "");
      const inp = row.querySelector("[data-opcolor-input]");
      const dot = row.querySelector("[data-opcolor-dot]");
      if (!inp || !dot) return;
      inp.addEventListener("input", () => {
        const v = normalizeHexColor(inp.value) || "#22E6C3";
        dot.style.background = v;
      });
    });
  }

  function syncPrefsUI() {
    if (prefSlot) prefSlot.value = String(prefs.slotMin || 30);
    if (prefMulti) prefMulti.checked = Boolean(prefs.multiUser);
    if (prefShowService) prefShowService.checked = Boolean(prefs.showService);
    if (prefDayNav) prefDayNav.checked = Boolean(prefs.dayNav);
    if (prefColor) prefColor.value = String(prefs.userColor || "#22e6c3");
    renderOperatorColorsUI();
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
    // Prevent indefinite hangs (Airtable/network stalls can otherwise leave UI on "Carico…" forever).
    // Agenda can be heavy on cold starts; keep a safer ceiling.
    const timeoutMs = 25_000;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      try { ctrl.abort(); } catch {}
    }, timeoutMs);

    // Small in-memory cache to avoid refetch loops during fast navigation/view switches.
    // (Server still enforces auth; this is just for UI responsiveness.)
    const cacheKey = String(url || "");
    const canCache = cacheKey && !cacheKey.includes("nocache=1");
    if (canCache) {
      try {
        apiGet._cache = apiGet._cache || new Map();
        const hit = apiGet._cache.get(cacheKey);
        if (hit && Date.now() < hit.exp) return hit.data;
      } catch {}
    }

    let r;
    try {
      r = await fetch(url, { credentials: "include", signal: ctrl.signal });
    } catch (e) {
      if (e?.name === "AbortError") throw new Error(`Timeout (${Math.round(timeoutMs / 1000)}s) su ${url}`);
      throw e;
    } finally {
      clearTimeout(t);
    }

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const raw = String(data.error || "").trim();
      let msg = raw || ("HTTP " + r.status);
      // Airtable can return this generic string on missing base/table permissions.
      if (/invalid permissions/i.test(msg) || /requested model was not found/i.test(msg)) {
        msg = "Permessi Airtable mancanti o base/tabella non trovata. Controlla AIRTABLE_TOKEN/AIRTABLE_BASE_ID e gli accessi alla base.";
      }
      const where = `\n\nEndpoint: ${url} (HTTP ${r.status})`;
      const extra = data.details ? `\nDettagli: ${JSON.stringify(data.details, null, 2)}` : "";
      throw new Error(msg + where + extra);
    }

    if (canCache) {
      try {
        // short TTL: keeps UI snappy without hiding real-time updates for long
        apiGet._cache.set(cacheKey, { exp: Date.now() + 12_000, data });
      } catch {}
    }
    return data;
  }

  async function loadLocations() {
    if (Array.isArray(locationsCache)) return locationsCache;
    // Positions are stored in Airtable table "AZIENDA" (requested).
    const data = await apiGet("/api/locations?table=AZIENDA&nameField=Sede");
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

  async function load(opts = {}) {
    const start = view === "day"
      ? new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())
      : startOfWeekMonday(anchorDate);
    const days = view === "day" ? 1 : (view === "5days" ? 5 : 7);
    const from = toYmd(start);
    const to = toYmd(addDays(start, days - 1));

    if (rangeEl) rangeEl.textContent = ""; // UI: non mostrare date in alto
    if (monthEl) monthEl.textContent = String(fmtMonth(start) || "").toUpperCase();
    if (weekEl) weekEl.textContent = fmtWeekRange(start, days);

    const nocache = opts && opts.nocache ? "&nocache=1" : "";
    // Use the lighter endpoint to avoid timeouts.
    const startISO = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0).toISOString();
    const endExclusive = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    endExclusive.setDate(endExclusive.getDate() + days);
    const endISO = endExclusive.toISOString();
    // Background operators fetch (do not block first render).
    // Helps multi-user selector even if appointments are slow.
    apiGet("/api/operators")
      .then((ops) => {
        if (!ops?.items) return;
        const items = (ops.items || []);
        knownOperators = items;
        const names = items.map((x) => String(x.name || "").trim()).filter(Boolean);
        if (names.length) knownTherapists = names;
        operatorIdToName = new Map(items.map((x) => [String(x.id || "").trim(), String(x.name || "").trim()]).filter((p) => p[0] && p[1]));
        knownByEmail = new Map(items.map((x) => [String(x.email || "").trim().toLowerCase(), String(x.name || "").trim()]).filter((p) => p[0] && p[1]));
        operatorNameToId = new Map(items.map((x) => [String(x.name || "").trim(), String(x.id || "").trim()]).filter((p) => p[0] && p[1]));
        operatorNameToRole = new Map(items.map((x) => [String(x.name || "").trim(), String(x.role || "").trim()]).filter((p) => p[0] && p[1]));

        // Shared colors (from Airtable via /api/operators)
        ensureOperatorColorsObject();
        const nextColors = {};
        items.forEach((x) => {
          const id = String(x.id || "").trim();
          const c = normalizeHexColor(x.color);
          if (id && c) nextColors[id] = c;
        });
        prefs.operatorColors = nextColors;

        // If appointments were loaded in lite mode, backfill therapist names from ids.
        backfillTherapistNamesFromIds();
        syncOpsBar();
        ensureUserMappedOrWarn();
        try { render(); } catch {}
      })
      .catch(() => {});

    // First load: ask the API for a "lite" response (no extra name-resolving calls),
    // to avoid 25s client timeouts on cold starts.
    const data = await apiGet(`/api/appointments?lite=1&allowUnmapped=1&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}${nocache}`);

    // NOTE: operators are NOT needed to render the agenda grid.
    // Loading them on the critical path makes the "first open" slower on cold starts.
    // We fetch operators in the background after the first render below.

    syncLoginName();
    if (prefDefaultPicker && prefDefaultPicker.style.display !== "none") renderDefaultPickerList();
    if (prefDoublePicker && prefDoublePicker.style.display !== "none") renderDoublePickerList();

    // Normalize appointments to the legacy shape expected by the renderer.
    if (data?.meta?.unmappedPhysio) {
      try { if (typeof window.toast === "function") window.toast("Avviso: utente non mappato a Collaboratore, agenda in modalità fallback."); } catch {}
    }

    rawItems = (data.appointments || []).map((a) => {
      const ap = a || {};
      return normalizeItem({
        id: ap.id,
        operator: ap.therapist_name || "",
        fields: {
          start_at: ap.start_at || "",
          end_at: ap.end_at || "",
          therapist_id: ap.therapist_id || "",
          therapist_name: ap.therapist_name || "",
          service_name: ap.service_name || "",
          status: ap.status || "",
          patient_name: ap.patient_name || "",
          patient_id: ap.patient_id || "",
          // Keep link-like keys if downstream expects them
          erogato_id: ap.erogato_id || "",
          vendita_id: ap.vendita_id || "",
          internal_note: ap.internal_note || ap.quick_note || "",
        },
      });
    }).filter((x) => x.startAt);
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
      else if (multiUser && getUserRoleNorm() === "manager") {
        // Manager/CEO: default to "see everything" (no forced personal column).
        selectedTherapists = new Set(knownTherapists);
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

    // Best-effort: enrich appointments in background (names for linked records).
    // If it times out, the agenda still works (it will show what it can from raw fields).
    apiGet(`/api/appointments?allowUnmapped=1&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}${nocache}`)
      .then((full) => {
        if (!full?.appointments) return;
        if (full?.meta?.unmappedPhysio) {
          try { if (typeof window.toast === "function") window.toast("Avviso: agenda in modalità fallback (mapping Collaboratore mancante)."); } catch {}
        }
        rawItems = (full.appointments || []).map((a) => {
          const ap = a || {};
          return normalizeItem({
            id: ap.id,
            operator: ap.therapist_name || "",
            fields: {
              start_at: ap.start_at || "",
              end_at: ap.end_at || "",
              therapist_name: ap.therapist_name || "",
              service_name: ap.service_name || "",
              status: ap.status || "",
              patient_name: ap.patient_name || "",
              patient_id: ap.patient_id || "",
              // Keep link-like keys if downstream expects them
              erogato_id: ap.erogato_id || "",
              vendita_id: ap.vendita_id || "",
              internal_note: ap.internal_note || ap.quick_note || "",
            },
          });
        }).filter((x) => x.startAt);
        rebuildSlotLocationIndex();
        syncOpsBar();
        try { render(); } catch {}
      })
      .catch(() => {});
  }

  function computeGridRange(start, days) {
    // Infer grid range from selected "working" slots. If none exist, fallback 08:00–20:00.
    let minOn = null;
    let maxOn = null;

    const visibleTherapists = multiUser ? Array.from(selectedTherapists) : [Array.from(selectedTherapists)[0] || ""];

    // Use getSlotRule so global availability also affects grid range.
    for (let dIdx = 0; dIdx < days; dIdx++) {
      const day = addDays(start, dIdx);
      for (const t of visibleTherapists) {
        for (let mm = 0; mm < MINUTES_PER_DAY; mm += BASE_SLOT_MIN) {
          const r = getSlotRule(t, day, mm);
          if (!r?.on) continue;
          minOn = (minOn === null) ? mm : Math.min(minOn, mm);
          maxOn = (maxOn === null) ? (mm + BASE_SLOT_MIN) : Math.max(maxOn, mm + BASE_SLOT_MIN);
        }
      }
    }

    let startMin = minOn === null ? (8 * 60) : minOn;
    let endMin = maxOn === null ? (20 * 60) : maxOn;

    // Requested UX: always show full day range up to 21:00 (and from 07:00),
    // even if there are no working slots at the edges.
    startMin = Math.min(startMin, 7 * 60);
    endMin = Math.max(endMin, 21 * 60);
    startMin = clamp(startMin, 0, 23 * 60);
    endMin = clamp(endMin, startMin + 60, 24 * 60);
    startMin = Math.floor(startMin / 60) * 60;
    endMin = Math.ceil(endMin / 60) * 60;
    endMin = clamp(endMin, startMin + 60, 24 * 60);
    return { startMin, endMin };
  }

  function buildGridSkeleton(start, days, ops, { gridStartMin, gridEndMin } = {}) {
    gridEl.innerHTML = "";

    // Body columns
    const startMinRange = Number(gridStartMin ?? (8 * 60));
    const endMinRange = Number(gridEndMin ?? (20 * 60));
    const totalMin = Math.max(60, endMinRange - startMinRange);
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

    // Expose geometry to CSS so we can draw the grid with gradients (faster than DOM lines).
    try {
      const slotsPerHour = Math.max(1, Math.round(60 / Math.max(1, Number(SLOT_MIN || 30))));
      document.documentElement.style.setProperty("--fp-slot-px", `${SLOT_PX}px`);
      document.documentElement.style.setProperty("--fp-hour-px", `${SLOT_PX * slotsPerHour}px`);
      document.documentElement.style.setProperty("--fp-grid-pad-top", `${GRID_PAD_TOP}px`);
      document.documentElement.style.setProperty("--fp-grid-pad-bottom", `${GRID_PAD_BOTTOM}px`);
    } catch {}

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
    const apptSettings = loadAppointmentsSettingsFromStorage();
    const showCancelBand = Boolean(apptSettings.cancelband);
    // Make sticky offsets match the presence/absence of the band.
    try { document.documentElement.style.setProperty("--fpCancelH", showCancelBand ? "42px" : "0px"); } catch {}
    gridEl.style.gridTemplateColumns = `64px repeat(${totalDayCols}, minmax(0, 1fr))`;
    const cancelH = showCancelBand ? 42 : 0;
    if (multiUser) gridEl.style.gridTemplateRows = `58px ${cancelH}px 34px ${heightPx}px`;
    else gridEl.style.gridTemplateRows = `58px ${cancelH}px ${heightPx}px`;

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
    // We keep the row even when disabled (height 0) to keep row indices stable.
    {
      const blank = document.createElement("div");
      blank.className = "corner";
      blank.style.height = (showCancelBand ? "42px" : "0px");
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
            const laneBadge =
              slot.laneCount > 1
                ? `<span title="Colonna ${slot.laneIndex + 1}" style="font-size:11px; font-weight:1000; opacity:.85;">${slot.laneIndex + 1}</span>`
                : "";
            // Multi-user header: show only the "logo" (initials), no name next to it.
            cell.innerHTML = `<div class="d2" style="display:flex;align-items:center;gap:8px;font-size:13px; min-width:0;">
              <span class="opsDot" title="${escapeHtml(name)}" style="width:22px;height:22px;background:${solidForTherapist(name)}">${therapistKey(name)}</span>
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
    timeCol.style.gridRow = multiUser ? "4" : "3";
    timeCol.style.position = "sticky";
    timeCol.style.left = "0";
    timeCol.style.zIndex = "4";
    // Theme-aware background (agenda.html defines --fp-timecol-bg).
    timeCol.style.background = "var(--fp-timecol-bg)";

    const startHour = Math.floor(startMinRange / 60);
    const endHour = Math.ceil(endMinRange / 60);
    for (let h = startHour; h <= endHour; h++) {
      const y = GRID_PAD_TOP + ((((h * 60) - startMinRange) / SLOT_MIN) * SLOT_PX);
      if (y < GRID_PAD_TOP - 2 || y > (GRID_PAD_TOP + totalSlots * SLOT_PX + 2)) continue;
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
        col.style.position = "relative";
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
        col.style.gridRow = multiUser ? "4" : "3";

        // Availability overlay (slot-based). Base is "non-working" dark, with "working" green blocks.
        {
          const therapistForCol = multiUser ? String(col.dataset.therapist || "").trim() : (Array.from(selectedTherapists)[0] || "");
          const dayObj = addDays(start, dIdx);
          const endPx = GRID_PAD_TOP + (totalSlots * SLOT_PX);

          // full dark mask
          const dark = document.createElement("div");
          dark.style.position = "absolute";
          dark.style.left = "0";
          dark.style.right = "0";
          dark.style.top = GRID_PAD_TOP + "px";
          dark.style.height = (totalSlots * SLOT_PX) + "px";
          dark.style.background = "rgba(0,0,0,.16)";
          dark.style.pointerEvents = "none";
          dark.style.zIndex = "1";
          col.appendChild(dark);

          // green working segments (merge consecutive slots)
          let segStart = null; // px
          for (let s = 0; s < totalSlots; s++) {
            const minute = startMinRange + s * SLOT_MIN;
            const rule = getSlotRule(therapistForCol, dayObj, minute);
            const on = Boolean(rule.on);
            const y = GRID_PAD_TOP + (s * SLOT_PX);
            if (on && segStart === null) segStart = y;
            if ((!on || s === totalSlots - 1) && segStart !== null) {
              const segEnd = (!on ? y : (y + SLOT_PX));
              const block = document.createElement("div");
              block.style.position = "absolute";
              block.style.left = "0";
              block.style.right = "0";
              block.style.top = segStart + "px";
              block.style.height = Math.max(2, segEnd - segStart) + "px";
              block.style.background = colorForTherapist(therapistForCol);
              block.style.pointerEvents = "none";
              block.style.zIndex = "2";
              col.appendChild(block);
              segStart = null;
            }
          }

          // Clamp overlays within grid
          if (endPx <= GRID_PAD_TOP + 1) {
            // no-op safeguard
          }
        }

        // grid lines
        // NOTE: grid lines are painted via CSS background gradients on .dayCol (see agenda.html).

        // Hover slot highlight + click to create
        const hover = document.createElement("div");
        hover.className = "slotHover";
        hover.style.height = SLOT_PX + "px";
        {
          const therForHover = multiUser ? String(col.dataset.therapist || "").trim() : (Array.from(selectedTherapists)[0] || "");
          const solid = solidForTherapist(therForHover);
          hover.style.background = rgbaFromColor(solid, 0.20);
          hover.style.outlineColor = rgbaFromColor(solid, 0.45);
        }
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
          const slotStartMin = startMinRange + idx * SLOT_MIN;
          const day = addDays(start, dIdx);
          const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
          dt.setMinutes(slotStartMin);
          const timeStr = dt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

          const therapistName = multiUser
            ? String(col.dataset.therapist || "").trim()
            : (Array.from(selectedTherapists)[0] || "");
          const role = roleForOperatorName(therapistName);
          const therLabel = therapistName ? (therapistName + (role ? " • " + role : "")) : "—";

          const ruleForHover = getSlotRule(therapistName, day, slotStartMin);
          // Requested: in empty slots the position must be empty (no inference from other appointments).
          const loc = String(ruleForHover?.locationName || "").trim();
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

        // Slot editing: click+drag selects slots and opens editor.
        let dragStartIdx = null;
        let dragActive = false;
        let dragDay = null;
        let dragTherapist = "";

        const slotIdxFromClientY = (clientY) => {
          const r = col.getBoundingClientRect();
          const y = (clientY - r.top) - GRID_PAD_TOP;
          return Math.max(0, Math.min(totalSlots - 1, Math.floor(y / SLOT_PX)));
        };

        const applyDragOverlay = (idxA, idxB) => {
          const a = Math.min(idxA, idxB);
          const b = Math.max(idxA, idxB);
          const top = GRID_PAD_TOP + a * SLOT_PX;
          const h = (b - a + 1) * SLOT_PX;
          showSelectionOverlay(col, top, h);
        };

        col.addEventListener("mousedown", (e) => {
          if (!editHoursMode) return;
          if (e.button !== 0) return;
          if (e.target && e.target.closest && e.target.closest(".event")) return;
          dragActive = true;
          dragStartIdx = slotIdxFromClientY(e.clientY);
          dragDay = addDays(start, dIdx);
          dragTherapist = multiUser ? String(col.dataset.therapist || "").trim() : (Array.from(selectedTherapists)[0] || "");
          applyDragOverlay(dragStartIdx, dragStartIdx);
          try { e.preventDefault(); } catch {}
        });
        col.addEventListener("mousemove", (e) => {
          if (!editHoursMode) return;
          if (!dragActive || dragStartIdx === null) return;
          const idx = slotIdxFromClientY(e.clientY);
          applyDragOverlay(dragStartIdx, idx);
        });
        const finishDrag = (e) => {
          if (!editHoursMode) return;
          if (!dragActive || dragStartIdx === null) return;
          dragActive = false;
          const endIdx = slotIdxFromClientY(e.clientY);
          const a = Math.min(dragStartIdx, endIdx);
          const b = Math.max(dragStartIdx, endIdx);
          const selStartMin = startMinRange + a * SLOT_MIN;
          const selEndMinEx = startMinRange + (b + 1) * SLOT_MIN;
          openSlotEditModal({
            therapistName: dragTherapist,
            dateObj: dragDay || addDays(start, dIdx),
            startMin: selStartMin,
            endMinExclusive: selEndMinEx,
          }).catch((err) => {
            console.error(err);
            clearSelectionOverlays();
          });
          dragStartIdx = null;
        };
        col.addEventListener("mouseup", (e) => finishDrag(e));
        col.addEventListener("mouseleave", () => {
          if (!editHoursMode) return;
          // if user drags outside, keep overlay; mouseup on window will close it.
        });
        window.addEventListener("mouseup", (e) => {
          // capture drag end even outside column
          try { finishDrag(e); } catch {}
        });

        col.addEventListener("click", async (e) => {
          if (e.target && e.target.closest && e.target.closest(".event")) return;
          if (editHoursMode) return; // in edit mode, click is handled by drag selection
          hideSlotHover();
          const idx = Number(col.dataset._slotIndex || "0");
          const slotStartMin = startMinRange + idx * SLOT_MIN;

          const day = addDays(start, dIdx);
          const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
          dt.setMinutes(slotStartMin);

          // Block creating appointments outside working hours (default behavior).
          const therapistNameForRule = multiUser ? String(col.dataset.therapist || "").trim() : (Array.from(selectedTherapists)[0] || "");
          const rule = getSlotRule(therapistNameForRule, day, slotStartMin);
          if (!rule.on) {
            const hhmm = minToTime(slotStartMin);
            const whenLabel = `${hhmm} • ${WEEKDAY_LABELS[weekdayIdxMon0(day)]} ${day.getDate()}/${day.getMonth() + 1}`;
            const ok = await confirmOutsideWorkingHours({
              whenLabel,
              therapistName: therapistNameForRule,
              mode: "creare",
            });
            if (!ok) return;
          }

          const therapistName = multiUser ? String(col.dataset.therapist || "").trim() : (Array.from(selectedTherapists)[0] || "");
          openCreateModal({ startAt: dt, therapistName });
        });

        gridEl.appendChild(col);
      }
    }
  }

  function openDetailsModal(item) {
    // Re-query modal elements every time (SPA swaps can detach old nodes).
    const back = document.querySelector("[data-cal-modal]");
    const titleEl = document.querySelector("[data-cal-modal-title]");
    const bodyEl = document.querySelector("[data-cal-modal-body]");
    if (!back || !titleEl || !bodyEl) return;

    const roleNorm = getUserRoleNorm();
    const canDelete = roleNorm === "front" || roleNorm === "manager";

    titleEl.textContent = "Dettagli appuntamento";

    const startAt = item?.startAt instanceof Date ? item.startAt : null;
    const endAt = item?.endAt instanceof Date ? item.endAt : null;
    const durMin = startAt && endAt ? Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000)) : 60;

    let dtLabel = "";
    try {
      dtLabel = startAt
        ? startAt.toLocaleString("it-IT", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "";
    } catch {}

    const guessedLocationName = inferSlotLocation(startAt ? toYmd(startAt) : "", item?.therapist || "") || "";

    bodyEl.innerHTML = `
      <div class="oe-modal__top" style="margin-top:0;">
        <div class="oe-modal__topActions">
          <button class="oe-chipbtn oe-chipbtn--accent" type="button" data-det-repeat>RIPETI</button>
          <button class="oe-chipbtn" type="button" data-det-notify>NOTIFICHE</button>
          <button class="oe-chipbtn oe-chipbtn--accent2" type="button" data-det-location>LUOGO</button>
          <button class="oe-chipbtn oe-chipbtn--danger" type="button" data-det-delete ${canDelete ? "" : "disabled"}>${canDelete ? "ELIMINA" : "ELIMINA"}</button>
        </div>
        <div class="oe-modal__created" data-det-created></div>
      </div>

      <div class="oe-modal__patientCenter" style="margin-top:6px;">
        <div class="oe-modal__patientnameRow">
          <div class="oe-modal__patientname" data-det-pname>${escapeHtml(item?.patient || "")}</div>
          <div class="oe-badge" data-det-tag style="display:none"></div>
        </div>
        <div class="oe-modal__patientActions">
          <a class="oe-chipbtn" data-det-call href="#" aria-disabled="true">CHIAMA</a>
          <a class="oe-chipbtn oe-chipbtn--accent" data-det-wa href="#" aria-disabled="true">+39… WhatsApp</a>
          <a class="oe-chipbtn" data-det-email href="#" aria-disabled="true">EMAIL</a>
          <a class="oe-modal__patientlink" data-det-plink href="/pages/paziente.html?id=${encodeURIComponent(String(item?.patientId || ""))}">Apri scheda paziente</a>
        </div>
      </div>

      <div class="oe-modal__section" style="padding-top:12px;">
        <div class="oe-modal__dt">${escapeHtml(dtLabel)}</div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr; gap:12px;">
        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Esito appuntamento</span>
          <select class="select" data-det-status><option value="">Carico…</option></select>
        </label>
      </div>

      <div style="height:10px;"></div>

      <div style="display:grid; grid-template-columns: 1.6fr 1fr 1.2fr; gap:12px;">
        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Voce prezzario</span>
          <select class="select" data-det-service><option value="">Carico…</option></select>
        </label>
        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Durata (min)</span>
          <input class="input" type="number" min="0" step="1" data-det-duration value="${String(durMin)}" />
        </label>
        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Agenda</span>
          <select class="select" data-det-operator><option value="">Carico…</option></select>
        </label>
        <label class="field" style="gap:6px; grid-column: 1 / -1;">
          <span class="fpFormLabel">Luogo</span>
          <select class="select" data-det-locationSel><option value="">Carico…</option></select>
        </label>
      </div>

      <div class="oe-modal__checks" style="padding-top:12px;">
        <label class="oe-check"><input type="checkbox" data-det-confirm-patient /> <span>Confermato dal paziente</span></label>
        <label class="oe-check"><input type="checkbox" data-det-confirm-platform /> <span>Conferma in InBuoneMani</span></label>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:10px;">
        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Note interne</span>
          <textarea class="textarea" maxlength="255" data-det-internal></textarea>
          <div class="oe-counter"><span data-det-count-internal>0</span> / 255</div>
        </label>
        <label class="field" style="gap:6px;">
          <span class="fpFormLabel">Note visibili al paziente</span>
          <textarea class="textarea" maxlength="255" data-det-patient></textarea>
          <div class="oe-counter"><span data-det-count-patient>0</span> / 255</div>
        </label>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:14px;">
        <button class="btn" type="button" data-det-cancel>Annulla</button>
        <button class="btn primary" type="button" data-det-save>Salva</button>
      </div>
    `;

    const q = (sel) => bodyEl.querySelector(sel);
    const elStatus = q("[data-det-status]");
    const elService = q("[data-det-service]");
    const elOperator = q("[data-det-operator]");
    const elLocation = q("[data-det-locationSel]");
    const elInternal = q("[data-det-internal]");
    const elPatient = q("[data-det-patient]");
    const elConfP = q("[data-det-confirm-patient]");
    const elConfPl = q("[data-det-confirm-platform]");
    const btnSave = q("[data-det-save]");
    const btnCancel = q("[data-det-cancel]");
    const btnDelete = q("[data-det-delete]");
    const btnLoc = q("[data-det-location]");

    // Prefill notes/status/confirm flags from available fields.
    const f = item?.fields || {};
    const currentStatus = String(item?.status || "").trim();
    const internalNote = String(f["Nota rapida"] ?? f["Nota rapida (interna)"] ?? f["Note interne"] ?? "").trim();
    const patientNote = String(f["Note"] ?? f["Note paziente"] ?? "").trim();
    const confByPatient = Boolean(f["Confermato dal paziente"] ?? f["Conferma del paziente"] ?? false);
    const confInPlatform = Boolean(f["Conferma in InBuoneMani"] ?? f["Conferma in piattaforma"] ?? false);

    if (elInternal) elInternal.value = internalNote;
    if (elPatient) elPatient.value = patientNote;
    if (elConfP) elConfP.checked = confByPatient;
    if (elConfPl) elConfPl.checked = confInPlatform;

    const updateCounters = () => {
      const ci = q("[data-det-count-internal]");
      const cp = q("[data-det-count-patient]");
      if (ci && elInternal) ci.textContent = String((elInternal.value || "").length);
      if (cp && elPatient) cp.textContent = String((elPatient.value || "").length);
    };
    if (elInternal) elInternal.oninput = updateCounters;
    if (elPatient) elPatient.oninput = updateCounters;
    updateCounters();

    // Load selects
    (async () => {
      try {
        const [services, locations] = await Promise.all([loadServices().catch(() => []), loadLocations().catch(() => [])]);
        // Services
        if (elService) {
          elService.innerHTML = `<option value="">—</option>` + (services || []).map((s) =>
            `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name || s.id)}</option>`
          ).join("");
          const want = (services || []).find((s) => String(s.name || "").trim() === String(item?.service || "").trim())?.id || "";
          if (want) elService.value = want;
        }
        // Operators
        if (elOperator) {
          const ops = knownOperators || [];
          elOperator.innerHTML = `<option value="">—</option>` + ops.map((o) =>
            `<option value="${escapeAttr(o.id)}">${escapeHtml(o.name || o.id)}</option>`
          ).join("");
          const opId = operatorNameToId.get(String(item?.therapist || "").trim()) || "";
          if (opId) elOperator.value = opId;
        }
        // Locations
        if (elLocation) {
          elLocation.innerHTML = `<option value="">—</option>` + (locations || []).map((l) =>
            `<option value="${escapeAttr(l.id)}">${escapeHtml(l.name || l.id)}</option>`
          ).join("");
          const locId =
            (locations || []).find((l) => String(l.name || "").trim() === String(guessedLocationName || "").trim())?.id ||
            "";
          if (locId) elLocation.value = locId;
        }
        // Status options
        if (elStatus) {
          const st = await apiGet("/api/appointment-field-options?field=Stato appuntamento").catch(() => ({ items: [] }));
          const items = st.items || [];
          elStatus.innerHTML = `<option value="">—</option>` + items.map((x) =>
            `<option value="${escapeAttr(x.id)}">${escapeHtml(x.name || x.id)}</option>`
          ).join("");
          if (currentStatus) elStatus.value = currentStatus;
        }
      } catch (e) {
        console.warn("Details modal options not available", e);
      }
    })();

    // Patient contacts
    (async () => {
      const callA = q("[data-det-call]");
      const waA = q("[data-det-wa]");
      const emailA = q("[data-det-email]");
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
      const pid = String(item?.patientId || "").trim();
      if (!pid) return;
      try {
        const p = await apiGet(`/api/patient?id=${encodeURIComponent(pid)}`);
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
    })();

    const close = () => { back.style.display = "none"; };
    if (btnCancel) btnCancel.onclick = close;

    if (btnLoc) btnLoc.onclick = () => { try { elLocation?.focus?.(); } catch {} };

    if (btnDelete) btnDelete.onclick = async () => {
      if (!canDelete) return;
      if (!confirm("Eliminare questo appuntamento?")) return;
      try {
        btnDelete.disabled = true;
        await fetch(`/api/appointments?id=${encodeURIComponent(String(item.id))}`, { method: "DELETE", credentials: "include" });
        close();
        load({ nocache: true }).catch(() => {});
      } catch (e) {
        console.error(e);
        alert("Errore eliminazione appuntamento");
      } finally {
        btnDelete.disabled = false;
      }
    };

    if (btnSave) btnSave.onclick = async () => {
      try {
        btnSave.disabled = true;
        const payload = {
          status: elStatus ? String(elStatus.value || "") : "",
          serviceId: elService ? String(elService.value || "") : "",
          collaboratoreId: elOperator ? String(elOperator.value || "") : "",
          sedeId: elLocation ? String(elLocation.value || "") : "",
          durata: q("[data-det-duration]") ? String(q("[data-det-duration]").value || "") : "",
          confirmed_by_patient: Boolean(elConfP?.checked),
          confirmed_in_platform: Boolean(elConfPl?.checked),
          notaRapida: elInternal ? String(elInternal.value || "") : "",
          note: elPatient ? String(elPatient.value || "") : "",
        };

        const res = await fetch(`/api/appointments?id=${encodeURIComponent(String(item.id))}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || ("HTTP " + res.status));

        close();
        load({ nocache: true }).catch(() => {});
      } catch (e) {
        console.error(e);
        alert(e.message || "Errore salvataggio appuntamento");
      } finally {
        btnSave.disabled = false;
      }
    };

    back.style.display = "flex";
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
    // Max duration limited by last "working" slot (if defined), else 20:00.
    let endDayMin = 20 * 60;
    try {
      const key = normTherapistKeyForSlots(therapistName);
      const wIdx = String(weekdayIdxMon0(startAt));
      const byDay = prefs.workSlots?.[key]?.[wIdx] || null;
      if (byDay) {
        let maxOn = null;
        for (const [k, v] of Object.entries(byDay)) {
          if (!v || typeof v !== "object") continue;
          if (v.on !== true) continue;
          const mm = Number(k);
          if (!Number.isFinite(mm)) continue;
          maxOn = (maxOn === null) ? (mm + BASE_SLOT_MIN) : Math.max(maxOn, mm + BASE_SLOT_MIN);
        }
        if (maxOn !== null) endDayMin = clamp(maxOn, 60, 24 * 60);
      }
    } catch {}
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
          <span class="fpFormLabel">Posizione</span>
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

    // positions (AZIENDA)
    const startMinOfDay = (startAt?.getHours?.() || 0) * 60 + (startAt?.getMinutes?.() || 0);
    const ruleLoc = getSlotRule(therapistName, startAt, startMinOfDay);
    const inferredLocName = (ruleLoc?.locationName || inferSlotLocation(toYmd(startAt), therapistName));
    loadLocations()
      .then((arr) => {
        const items = Array.isArray(arr) ? arr : [];
        setSelectOptions(elLoc, items, { placeholder: "—" });
        if (inferredLocName) {
          const found = items.find((x) => String(x.name || "").trim().toLowerCase() === String(inferredLocName).trim().toLowerCase());
          if (found?.id) elLoc.value = String(found.id);
        }
      })
      .catch((e) => renderSelectError(elLoc, "POSIZIONE", e));

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
        // Basic client-side validation to avoid "silent" Airtable rejects.
        // Note: some inputs show a label, but their value must be the underlying id (rec...).
        const patientText = String(qInput?.value || "").trim();
        const therapistId = String(elOp?.value || "").trim();
        const serviceId = String(elServ?.value || "").trim();

        // Patient is picked only when clicking a search result (we need the record id).
        if (patientText && !(patientPicked && patientPicked.id)) {
          throw new Error("Seleziona il paziente dalla lista (non solo testo) oppure premi Svuota.");
        }
        if (!therapistId) {
          throw new Error("Seleziona un Operatore.");
        }
        if (String(elServQ?.value || "").trim() && !serviceId) {
          throw new Error("Seleziona una Prestazione dalla lista.");
        }

        const durMin = Number.parseInt(String(elDur?.value || "30"), 10);
        if (!Number.isFinite(durMin) || durMin <= 0) {
          throw new Error("Durata non valida. Seleziona una durata in minuti.");
        }

        const endAt = new Date(startAt.getTime() + durMin * 60000);
        if (!Number.isFinite(startAt?.getTime?.()) || !Number.isFinite(endAt?.getTime?.())) {
          throw new Error("Data/ora non valida. Riprova selezionando lo slot in agenda.");
        }

        const payload = {
          startAt: toLocalDateTimeISO(startAt),
          endAt: toLocalDateTimeISO(endAt),
          therapistId,
          patientId: (patientPicked && patientPicked.id) ? patientPicked.id : "",
          serviceId,
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

        // create uses POST; use fetch directly with a timeout to avoid "stuck" UI.
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 20000);
        const res = await fetch("/api/appointment-create", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ac.signal,
        }).finally(() => clearTimeout(t));
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          const details = data?.details?.lastError ? `\n\nDettagli: ${String(data.details.lastError)}` : "";
          throw new Error((data?.error ? String(data.error) : ("HTTP " + res.status)) + details);
        }

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
        const msg = String(e?.name || "") === "AbortError"
          ? "Timeout durante il salvataggio (rete lenta o Airtable non risponde). Riprova."
          : (e?.message || "Errore salvataggio appuntamento");
        alert(msg);
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
    const range = computeGridRange(start, days);

    // Infallibile: filter by therapist *id* (stable) instead of display name (can differ).
    const selectedOperatorIds = (() => {
      try {
        const out = new Set();
        // selection may contain display names -> map to ids when possible
        Array.from(selectedTherapists || []).forEach((name) => {
          const id = String(operatorNameToId.get(String(name || "").trim()) || "").trim();
          if (id) out.add(id);
        });
        // If we can map current user email to an operator, include it (prevents "flash then disappear").
        const meEmail = getUserEmail();
        const meName = meEmail ? String(knownByEmail.get(meEmail) || "").trim() : "";
        const meId = meName ? String(operatorNameToId.get(meName) || "").trim() : "";
        if (meId) out.add(meId);
        return out;
      } catch {
        return new Set();
      }
    })();

    const q = String(qEl?.value || "").trim().toLowerCase();
    const items = rawItems
      .filter((x) => {
        if (!x.startAt) return false;
        const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
        const dt0 = new Date(x.startAt.getFullYear(), x.startAt.getMonth(), x.startAt.getDate()).getTime();
        const idx = Math.round((dt0 - day0) / 86400000);
        if (idx < 0 || idx >= days) return false;
        // Filter by operator id when we have it; if we don't know the id yet, don't hide the appointment.
        if (selectedOperatorIds.size) {
          let tid = String(x?.therapistId || x?.fields?.therapist_id || "").trim();
          // If we only have a display name, try to map it to an operator id
          if (tid && !tid.startsWith("rec")) {
            const mapped = String(operatorNameToId.get(String(tid).trim()) || operatorNameToId.get(String(x?.therapist || "").trim()) || "").trim();
            if (mapped) tid = mapped;
          }
          if (tid && !selectedOperatorIds.has(tid)) return false;
        }
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

    buildGridSkeleton(start, days, ops.length ? ops : knownTherapists.slice(0, 1), {
      gridStartMin: range.startMin,
      gridEndMin: range.endMin,
    });

    const apptSettings = loadAppointmentsSettingsFromStorage();
    const showCancelBand = Boolean(apptSettings.cancelband);
    const dragEnabled = Boolean(apptSettings.drag);

    // Render cancelled appointments into the band.
    {
      if (!showCancelBand) {
        // ensure empty if disabled
        const cancelWraps = Array.from(document.querySelectorAll("[data-cancel-wrap]"));
        cancelWraps.forEach((w) => (w.innerHTML = ""));
      } else {
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
          chip.style.background = `color-mix(in srgb, ${solidForTherapist(it.therapist)} 22%, var(--btnBg))`;
          chip.title = `${label} • ${hh}:${mm} • ${it.therapist || ""} • ${it.status || "Annullato"}`;
          chip.innerHTML = `<span class="k">DIS</span><span class="t">${hh}:${mm}</span><span class="k">${key}</span><span class="p">${label}</span>`;
          wrap.appendChild(chip);
        });

        if (list.length > shown.length) {
          const more = document.createElement("div");
          more.className = "cancelChip";
          more.style.background = "var(--btnBg)";
          more.style.borderColor = "var(--border)";
          more.innerHTML = `<span class="k">+${list.length - shown.length}</span>`;
          more.title = `${list.length - shown.length} annullati in più`;
          wrap.appendChild(more);
        }
      }
      }
    }

    const cols = Array.from(document.querySelectorAll(".dayCol"));
    const startMin = range.startMin;
    const endMin = range.endMin;
    const totalSlotsForDnD = Math.max(1, Math.ceil((endMin - startMin) / SLOT_MIN));

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
      {
        const solid = solidForTherapist(it.therapist);
        // Requested: make appointment block more evident (no transparency).
        // Use a solid tinted panel so text stays readable in both themes.
        ev.style.background = `color-mix(in srgb, ${solid} 32%, var(--panelSolid) 68%)`;
        ev.style.borderColor = `color-mix(in srgb, ${solid} 58%, var(--border))`;
        ev.style.borderLeftColor = `color-mix(in srgb, ${solid} 85%, rgba(0,0,0,.18))`;
      }

      const dotSolid = solidForTherapist(it.therapist);
      const dot = `<span class="dot" style="background:${dotSolid}; box-shadow:0 10px 22px ${rgbaFromColor(dotSolid, 0.22)};"></span>`;
      const line = prefs.showService
        ? [it.service, it.status].filter(Boolean).join(" • ")
        : [it.status].filter(Boolean).join(" • ");

      ev.innerHTML = `
        <div class="t">${it.patient || "Paziente"}</div>
        <div class="m">${line}</div>
        <div class="b">${dot}<span>${therapistKey(it.therapist) || it.therapist || ""}</span><span style="margin-left:auto; opacity:.8;">${pad2(it.startAt.getHours())}:${pad2(it.startAt.getMinutes())}</span></div>
      `;
      // Highlight on hover (slot-like) + keep existing preview behavior
      {
        const solid = solidForTherapist(it.therapist);
        const applyHover = (on) => {
          if (ev.classList.contains("isDragging")) return;
          ev.classList.toggle("isHover", Boolean(on));
          if (on) {
            ev.style.outline = `2px solid ${rgbaFromColor(solid, 0.55)}`;
            ev.style.outlineOffset = "-2px";
            ev.style.boxShadow = `0 18px 60px ${rgbaFromColor(solid, 0.18)}`;
          } else {
            ev.style.outline = "";
            ev.style.outlineOffset = "";
            ev.style.boxShadow = "";
          }
        };
        ev.addEventListener("mouseenter", () => applyHover(true));
        ev.addEventListener("mouseleave", () => applyHover(false));
      }
      // Click vs drag: if drag is enabled, click only fires when user didn't move.
      let dragStart = null;
      let dragMoved = false;
      let dragCleanup = null;

      const fmtDT = (d) => {
        try { return d.toLocaleString("it-IT", { weekday:"short", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" }); } catch { return String(d); }
      };

      const clearDragPreview = () => {
        document.querySelectorAll("[data-fp-drop-preview]").forEach((x) => x.remove());
      };
      const showDragPreview = ({ colEl, topPx, heightPx, label, valid }) => {
        if (!colEl) return;
        clearDragPreview();
        const ind = document.createElement("div");
        ind.setAttribute("data-fp-drop-preview", "1");
        ind.style.position = "absolute";
        // Align with event width
        ind.style.left = "6px";
        ind.style.right = "6px";
        ind.style.top = Math.round(topPx) + "px";
        ind.style.height = Math.max(18, Math.round(heightPx)) + "px";
        ind.style.border = valid ? "2px dashed rgba(255, 122, 0, .95)" : "2px dashed rgba(255, 77, 109, .95)";
        ind.style.borderRadius = "12px";
        ind.style.background = valid ? "rgba(255, 122, 0, .14)" : "rgba(255, 77, 109, .14)";
        ind.style.pointerEvents = "none";
        ind.style.zIndex = "6";
        ind.style.display = "flex";
        ind.style.alignItems = "flex-start";
        ind.style.justifyContent = "space-between";
        ind.style.padding = "8px 10px";
        ind.style.gap = "10px";
        ind.style.boxShadow = "0 18px 60px rgba(0,0,0,.22)";
        ind.innerHTML = `
          <div style="min-width:0; font-weight:900; font-size:12px; color:rgba(255,255,255,.92); text-shadow:0 2px 10px rgba(0,0,0,.35); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${escapeHtml(label || "")}
          </div>
          <div style="flex:0 0 auto; font-weight:1000; font-size:12px; color:rgba(255,255,255,.92); opacity:.92;">
            ${valid ? "↔" : "✖"}
          </div>
        `;
        colEl.appendChild(ind);
      };

      const autoScrollOnDrag = (clientY) => {
        const sc = document.querySelector(".calGridOuter");
        if (!sc) return;
        const r = sc.getBoundingClientRect();
        const margin = 46;
        const step = 18;
        if (clientY < r.top + margin) sc.scrollTop -= step;
        else if (clientY > r.bottom - margin) sc.scrollTop += step;
      };

      const applyMove = async ({ targetDayIndex, targetTherapist, targetStartMin }) => {
        const dayObj = addDays(start, targetDayIndex);
        const rule = getSlotRule(targetTherapist || it.therapist, dayObj, targetStartMin);
        if (!rule?.on) {
          const hhmm = minToTime(targetStartMin);
          const whenLabel = `${hhmm} • ${WEEKDAY_LABELS[weekdayIdxMon0(dayObj)]} ${dayObj.getDate()}/${dayObj.getMonth() + 1}`;
          const ok = await confirmOutsideWorkingHours({
            whenLabel,
            therapistName: String(targetTherapist || it.therapist || "").trim(),
            mode: "spostare",
          });
          if (!ok) return;
        }

        const durMin = (() => {
          const stMin0 = minutesOfDay(it.startAt);
          let d0 = 30;
          if (it.endAt) {
            const en0 = minutesOfDay(it.endAt);
            if (en0 > stMin0) d0 = en0 - stMin0;
          }
          return d0;
        })();

        const newStart = new Date(dayObj.getFullYear(), dayObj.getMonth(), dayObj.getDate(), 0, 0, 0, 0);
        newStart.setMinutes(targetStartMin);
        const newEnd = new Date(newStart.getTime() + durMin * 60000);

        const fromLabel = `${fmtDT(it.startAt)} • ${String(it.therapist || "").trim() || "—"}`;
        const toLabel = `${fmtDT(newStart)} • ${String(targetTherapist || it.therapist || "").trim() || "—"}`;
        const ok = await confirmMoveAppointment({ fromLabel, toLabel });
        if (!ok) return;

        const payload = {
          start_at: newStart.toISOString(),
          end_at: newEnd.toISOString(),
        };

        // If moving across therapists, update collaborator link (required for correct column on reload).
        const therTrim = String(targetTherapist || "").trim();
        if (multiUser && therTrim && therTrim !== String(it.therapist || "").trim()) {
          const opId = operatorNameToId.get(therTrim) || "";
          if (!opId) {
            toast?.("Operatore non mappato: impossibile spostare su altra agenda");
            return;
          }
          payload.therapist_id = opId;
        }

        try {
          const patchOnce = async () => {
            const res = await fetch(`/api/appointments?id=${encodeURIComponent(it.id)}`, {
              method: "PATCH",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            return { res, data };
          };

          let { res, data } = await patchOnce();

          // Rare but observed: session cookie can be missing/intermittent.
          // If we get 401, re-check auth and retry once.
          if (res.status === 401) {
            try {
              const authRes = await fetch("/api/auth-me", { credentials: "include" });
              const authJson = await authRes.json().catch(() => ({}));
              if (authRes.ok && authJson?.ok) {
                ({ res, data } = await patchOnce());
              }
            } catch {}
          }

          if (!res.ok || !data?.ok) {
            const errCode = String(data?.error || "").trim();
            if (res.status === 401 || errCode === "unauthorized") {
              throw new Error("Sessione scaduta. Ricarica la pagina ed effettua nuovamente l’accesso.");
            }
            throw new Error(errCode || ("HTTP " + res.status));
          }

          // Optimistic local update for immediate UI response.
          // IMPORTANT: `it` is a *copy* (see items.map({ ...x })), so we must update `rawItems`.
          const rawIdx = (rawItems || []).findIndex((x) => String(x?.id || "") === String(it.id || ""));
          if (rawIdx >= 0) {
            rawItems[rawIdx] = {
              ...rawItems[rawIdx],
              startAt: newStart,
              endAt: newEnd,
              therapist: (multiUser && therTrim) ? therTrim : rawItems[rawIdx]?.therapist,
            };
          } else {
            // Fallback (should be rare): update local copy.
            it.startAt = newStart;
            it.endAt = newEnd;
            if (multiUser && therTrim) it.therapist = therTrim;
          }

          // Re-render immediately so the block moves visually right away.
          try { render(); } catch {}
          toast?.("Spostato");

          // Reload without cache so server data stays consistent.
          load({ nocache: true }).catch(() => {});
        } catch (e) {
          console.error(e);
          alert(e.message || "Errore spostamento appuntamento");
        }
      };

      const onClick = () => openDetailsModal(it);
      // If drag is enabled, "click to open details" is handled by mouseup logic.
      // But when slot-edit mode is enabled, we still want a normal click to open the appointment.
      ev.onclick = () => {
        if (dragEnabled && !editHoursMode) return;
        onClick();
      };

      if (dragEnabled) {
        ev.addEventListener("mousedown", (e) => {
          if (editHoursMode) return; // don't conflict with slot-edit mode
          if (e.button !== 0) return;
          dragMoved = false;
          dragStart = { x: e.clientX, y: e.clientY };
          ev.classList.add("isDragging");
          try { e.preventDefault(); } catch {}
          try { e.stopPropagation(); } catch {}

          const onMove = (me) => {
            if (!dragStart) return;
            autoScrollOnDrag(me.clientY);
            const dx = Math.abs(me.clientX - dragStart.x);
            const dy = Math.abs(me.clientY - dragStart.y);
            if (dx + dy > 5) dragMoved = true;

            const under = document.elementFromPoint(me.clientX, me.clientY);
            const colEl = under?.closest?.(".dayCol") || null;
            if (!colEl) return;
            const dIdx = Number(colEl.dataset.dayIndex || "0");
            const ther = multiUser ? String(colEl.dataset.therapist || "").trim() : String(it.therapist || "").trim();
            const r = colEl.getBoundingClientRect();
            const y = (me.clientY - r.top) - GRID_PAD_TOP;
            // Snap to nearest slot (more natural than always "down").
            const idxFloat = y / SLOT_PX;
            const idx = Math.max(0, Math.min(totalSlotsForDnD - 1, Math.round(idxFloat)));
            const slotStartMin = startMin + idx * SLOT_MIN;

            const dayObj = addDays(start, dIdx);
            const rule = getSlotRule(ther || it.therapist, dayObj, slotStartMin);
            const valid = Boolean(rule?.on);

            const hh = pad2(Math.floor(slotStartMin / 60));
            const mm = pad2(slotStartMin % 60);
            const therChip = therapistKey(ther) || ther || "—";
            const label = valid ? `${hh}:${mm} • ${therChip}` : `${hh}:${mm} • ${therChip} • Fuori orario`;

            showDragPreview({ colEl, topPx: GRID_PAD_TOP + idx * SLOT_PX, heightPx: height, label, valid });
            ev.dataset.fpDragTarget = JSON.stringify({ dIdx, ther, slotStartMin, valid });
          };

          const onUp = (ue) => {
            const tgtRaw = ev.dataset.fpDragTarget || "";
            ev.dataset.fpDragTarget = "";
            ev.classList.remove("isDragging");
            clearDragPreview();
            if (dragCleanup) dragCleanup();
            dragCleanup = null;

            const moved = dragMoved;
            dragStart = null;
            dragMoved = false;

            if (!moved) {
              onClick();
              return;
            }

            let tgt = null;
            try { tgt = tgtRaw ? JSON.parse(tgtRaw) : null; } catch { tgt = null; }
            if (!tgt) return;

            applyMove({
              targetDayIndex: Number(tgt.dIdx || 0),
              targetTherapist: String(tgt.ther || "").trim() || String(it.therapist || "").trim(),
              targetStartMin: Number(tgt.slotStartMin || startMin),
            });
          };

          document.addEventListener("mousemove", onMove, true);
          document.addEventListener("mouseup", onUp, true);
          dragCleanup = () => {
            document.removeEventListener("mousemove", onMove, true);
            document.removeEventListener("mouseup", onUp, true);
          };
        });
        // Also keep click accessible when drag setting is on.
        ev.addEventListener("click", (e) => {
          if (dragMoved) {
            try { e.preventDefault(); } catch {}
            try { e.stopPropagation(); } catch {}
          }
        });
      }
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
  btnOpenHours?.addEventListener("click", () => {
    editHoursMode = !editHoursMode;
    clearSelectionOverlays();
    toast?.(editHoursMode ? "Modalità orari a slot: ON" : "Modalità orari a slot: OFF");
  });

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
  prefsSave?.addEventListener("click", async () => {
    prefs.slotMin = Number(prefSlot?.value || 30);
    prefs.multiUser = Boolean(prefMulti?.checked);
    prefs.showService = Boolean(prefShowService?.checked);
    prefs.dayNav = Boolean(prefDayNav?.checked);
    prefs.userColor = String(prefColor?.value || "").trim();

    // Per-collaborator colors (saved by operator id)
    ensureOperatorColorsObject();
    const nextColors = {};
    try {
      prefOpColorsWrap?.querySelectorAll?.("[data-opcolor-row]")?.forEach?.((row) => {
        const id = String(row.getAttribute("data-opcolor-row") || "").trim();
        const inp = row.querySelector?.("[data-opcolor-input]");
        const v = normalizeHexColor(inp?.value);
        if (id && v) nextColors[id] = v;
      });
    } catch {}

    // Also apply "Colore utente" to current operator (back-compat)
    const me = String(getUserName() || "").trim();
    const myOpId = me ? (operatorNameToId.get(me) || "") : "";
    const myHex = normalizeHexColor(prefs.userColor);
    if (myOpId && myHex) nextColors[myOpId] = myHex;

    prefs.operatorColors = nextColors;
    savePrefs();

    // Persist shared collaborator colors server-side (Airtable) when allowed.
    // This makes colors identical across devices/browsers and for both Manager + Front office.
    if (canEditOperatorColors()) {
      try {
        const res = await fetch("/api/operators", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ colors: nextColors }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || ("HTTP " + res.status));
        toast?.("Colori salvati");
        try { window.dispatchEvent(new CustomEvent("fpAgendaPrefsChanged")); } catch {}
        // Reload operators so we reflect Airtable truth immediately
        try { await load({ nocache: true }); } catch {}
      } catch (e) {
        console.error(e);
        toast?.("Errore salvataggio colori (Airtable)");
      }
    } else {
      try { window.dispatchEvent(new CustomEvent("fpAgendaPrefsChanged")); } catch {}
    }

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

  // If "Impostazioni Disponibilità" changes, refresh availability cache + re-render.
  const onAvailabilityChanged = () => {
    settingsAvailabilityCache = null;
    // If we already loaded locations once, location names become immediately available.
    try { render(); } catch {}
  };
  window.addEventListener("fpAvailabilityChanged", onAvailabilityChanged);

  // If "Impostazioni Appuntamenti" changes, refresh cache + re-render.
  const onAppointmentsSettingsChanged = () => {
    appointmentsSettingsCache = null;
    try { render(); } catch {}
  };
  window.addEventListener("fpAppointmentsSettingsChanged", onAppointmentsSettingsChanged);

  // Cleanup (remove global listeners + ephemeral DOM)
  window.__FP_DIARY_CLEANUP = () => {
    try { document.removeEventListener("scroll", onDocScroll, true); } catch {}
    try { window.removeEventListener("resize", onResize); } catch {}
    try { window.removeEventListener("fpAvailabilityChanged", onAvailabilityChanged); } catch {}
    try { window.removeEventListener("fpAppointmentsSettingsChanged", onAppointmentsSettingsChanged); } catch {}
    try { hoverCard?.remove?.(); } catch {}
    try { slotHoverCard?.remove?.(); } catch {}
  };
};

  // Auto-init on classic page load
  window.fpDiaryInit();
})();

