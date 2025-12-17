// Diary (agenda) renderer: week grid similar to OsteoEasy,
// but styled using the existing app.css tokens.
(function () {
  const root = document.querySelector("[data-diary]");
  if (!root) return;

  const gridEl = document.querySelector("[data-cal-grid]");
  const qEl = document.querySelector("[data-cal-q]");
  const rangeEl = document.querySelector("[data-cal-range]");
  const monthEl = document.querySelector("[data-cal-month]");
  const weekEl = document.querySelector("[data-cal-week]");
  const therapistsEl = document.querySelector("[data-cal-therapists]");
  const btnPrev = document.querySelector("[data-cal-prev]");
  const btnNext = document.querySelector("[data-cal-next]");
  const btnToday = document.querySelector("[data-cal-today]");

  const modalBack = document.querySelector("[data-cal-modal]");
  const modalTitle = document.querySelector("[data-cal-modal-title]");
  const modalBody = document.querySelector("[data-cal-modal-body]");
  const modalClose = document.querySelector("[data-cal-modal-close]");

  const START_HOUR = 8;
  const END_HOUR = 20;
  const SLOT_MIN = 15;
  const SLOT_PX = 18;

  let view = "week"; // week | workweek
  let anchorDate = new Date();
  let rawItems = [];
  let activeTherapist = "ALL";

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
    const therapist = pickField(f, ["Operatore", "Fisioterapista", "Therapist", "therapist_name", "Email"]) || "";
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

  async function apiGet(url) {
    const r = await fetch(url, { credentials: "include" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
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

    const data = await apiGet(`/api/agenda?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    rawItems = (data.items || []).map(normalizeItem).filter((x) => x.startAt);
    render();
  }

  function renderTherapists(items) {
    const names = Array.from(new Set(items.map((x) => x.therapist).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    therapistsEl.innerHTML = "";

    const makeChip = (label, value, active) => {
      const el = document.createElement("span");
      el.className = "chip btnlike" + (active ? " active" : "");
      el.textContent = label;
      el.onclick = () => { activeTherapist = value; render(); };
      return el;
    };

    therapistsEl.appendChild(makeChip("Tutti", "ALL", activeTherapist === "ALL"));
    names.slice(0, 12).forEach((n) => {
      const key = therapistKey(n) || n.slice(0, 2).toUpperCase();
      therapistsEl.appendChild(makeChip(key, n, activeTherapist === n));
    });
  }

  function buildGridSkeleton(start, days) {
    gridEl.innerHTML = "";

    // Header row
    const head = document.createElement("div");
    head.className = "calHead";

    const corner = document.createElement("div");
    corner.className = "corner";
    head.appendChild(corner);

    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      const dh = document.createElement("div");
      dh.className = "dayHead";
      dh.innerHTML = `<div class="d1">${itDayLabel(d)}</div><div class="d2">${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}</div>`;
      head.appendChild(dh);
    }

    gridEl.appendChild(head);

    // Body columns
    const totalMin = (END_HOUR - START_HOUR) * 60;
    const totalSlots = Math.ceil(totalMin / SLOT_MIN);
    const heightPx = totalSlots * SLOT_PX;

    // time column
    const timeCol = document.createElement("div");
    timeCol.className = "timeCol";
    timeCol.style.height = heightPx + "px";
    timeCol.style.gridColumn = "1";
    timeCol.style.gridRow = "2";
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

    // day columns
    for (let i = 0; i < days; i++) {
      const col = document.createElement("div");
      col.className = "dayCol";
      col.dataset.dayIndex = String(i);
      col.style.height = heightPx + "px";
      col.style.gridColumn = String(2 + i);
      col.style.gridRow = "2";

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

    const q = String(qEl?.value || "").trim().toLowerCase();
    const items = rawItems
      .filter((x) => {
        if (!x.startAt) return false;
        const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
        const dt0 = new Date(x.startAt.getFullYear(), x.startAt.getMonth(), x.startAt.getDate()).getTime();
        const idx = Math.round((dt0 - day0) / 86400000);
        if (idx < 0 || idx >= days) return false;
        if (activeTherapist !== "ALL" && x.therapist !== activeTherapist) return false;
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

    renderTherapists(rawItems);
    buildGridSkeleton(start, days);

    const cols = Array.from(document.querySelectorAll(".dayCol"));
    const startMin = START_HOUR * 60;
    const endMin = END_HOUR * 60;

    items.forEach((it) => {
      const col = cols[it._dayIndex];
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
      ev.innerHTML = `
        <div class="t">${it.patient || "Appuntamento"}</div>
        <div class="m">${[it.service, it.status].filter(Boolean).join(" • ")}</div>
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

  // Init from URL (?date=YYYY-MM-DD)
  try {
    const u = new URL(location.href);
    const d = parseYmd(u.searchParams.get("date"));
    if (d) anchorDate = d;
  } catch {}

  setView("week");
})();

