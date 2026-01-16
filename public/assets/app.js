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

// Expose a stable, reusable client for other pages/scripts.
// (Keeps existing internal usage untouched.)
window.fpApi = api;

// Minimal reusable helper to handle loading + error states (no framework).
// Usage:
//   const data = await window.fpWithLoading({
//     loadingEl: document.querySelector("[data-loading]"),
//     errorEl: document.querySelector("[data-error]"),
//     run: () => window.fpApi("/api/contabilita?op=dashboard"),
//   });
window.fpWithLoading = async function fpWithLoading({ loadingEl, errorEl, run, loadingText = "Caricamento…" } = {}) {
  const show = (el, msg) => {
    if (!el) return;
    el.style.display = "block";
    if (msg !== undefined) el.textContent = String(msg || "");
  };
  const hide = (el) => {
    if (!el) return;
    el.style.display = "none";
  };

  hide(errorEl);
  show(loadingEl, loadingText);
  try {
    return await run();
  } catch (e) {
    const msg = String(e?.message || "Errore");
    show(errorEl, msg);
    throw e;
  } finally {
    hide(loadingEl);
  }
};

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

// =====================
// THEME (Standard vs Pro)
// =====================
function fpThemeKey() {
  const email = String((window.FP_USER?.email || window.FP_SESSION?.email || "anon")).trim().toLowerCase() || "anon";
  return `fp_settings_theme_${email}`;
}
function applyTheme(theme) {
  const t = String(theme || "").trim().toLowerCase();
  const cls = t === "pro" ? "fp-theme-pro" : "fp-theme-standard";
  document.body.classList.remove("fp-theme-pro", "fp-theme-standard");
  document.body.classList.add(cls);
}
function loadTheme() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(fpThemeKey()) || "null"); } catch {}
  const t = String(s?.theme || "standard").toLowerCase();
  return t === "pro" ? "pro" : "standard";
}
function saveTheme(theme) {
  const t = String(theme || "").toLowerCase() === "pro" ? "pro" : "standard";
  try { localStorage.setItem(fpThemeKey(), JSON.stringify({ theme: t })); } catch {}
  applyTheme(t);
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

// =====================
// UNIFIED SIDEBAR MENU (workflow-ordered)
// =====================
function ensureUnifiedSidebarMenu(roleRaw) {
  const nav = document.querySelector(".sidebar .nav");
  if (!nav) return;
  if (nav.getAttribute("data-fp-unified-nav") === "1") return;

  function normalizeRole(raw) {
    const r = String(raw || "").trim().toLowerCase();
    if (!r) return "";
    if (["physio", "fisioterapisti", "fisioterapista", "fisioterapiste", "terapista", "terapisti"].includes(r)) return "physio";
    if (["front", "front-office", "frontoffice", "segreteria"].includes(r)) return "front";
    if (["back", "back-office", "backoffice", "amministrazione"].includes(r)) return "back";
    if (["manager", "admin", "administrator"].includes(r)) return "manager";
    return r;
  }

  const role = normalizeRole(
    String(roleRaw || "").trim() || String((window.FP_USER?.role || window.FP_SESSION?.role || "")).trim()
  );

  // Default all relative links to /pages/*, but allow absolute paths (e.g. /manager/*).
  const pageHref = (p) => {
    const s = String(p || "").trim();
    if (!s) return "#";
    if (s.startsWith("/")) return s;
    return `/pages/${s.replace(/^\/+/, "")}`;
  };
  const link = (href, label, extraHtml = "") => `<a data-nav href="${pageHref(href)}">${label}${extraHtml}</a>`;
  const section = () => "";

  const html = [];

  // =========================
  // Menu semplificato per ruolo
  // - Pazienti + Agenda: sempre visibili (richiesta)
  // - Fisioterapista: poche voci
  // - Front office: voci operative/front
  // - Manager/CEO: vede tutto
  // =========================

  const isManager = role === "manager";

  // Generale (sempre)
  html.push(section("Generale"));
  html.push(link("agenda.html", "Agenda"));
  html.push(link("anagrafica.html", "Pazienti"));

  // Fisioterapista (menu ridotto)
  if (role === "physio") {
    html.push(section("Operativo"));
    html.push(link("operativo.html", "Oggi"));
    html.push(section("Clinico"));
    html.push(link("anamnesi.html", "Anamnesi"));
  }

  // Front office (menu operativo + front)
  if (role === "front") {
    html.push(section("Operativo"));
    html.push(link("operativo.html", "Oggi"));
    html.push(link("note.html", "Note & Alert", `<span class="badge" data-fp-inbox-badge style="display:none;"></span>`));
    html.push(link("notifiche.html", "Notifiche"));
    html.push(link("fatturazione.html", "Fatturazione"));

    html.push(section("Front Office"));
    html.push(link("front-office.html", "Home"));
    html.push(link("vendite.html", "Vendite"));
    html.push(link("pratiche-assicurative.html", "Assicurazioni"));
    html.push(link("archivio-documenti.html", "Archivio documenti"));
  }

  // Back office (lasciamo un set essenziale)
  if (role === "back") {
    html.push(section("Back Office"));
    html.push(link("back-office.html", "Home"));
    html.push(link("gestione-contabile.html", "Gestione contabile"));
    html.push(link("erogato.html", "Erogato"));
    html.push(link("note.html", "Note & Alert", `<span class="badge" data-fp-inbox-badge style="display:none;"></span>`));
    html.push(link("notifiche.html", "Notifiche"));
  }

  // Manager/CEO: vede tutto (unione delle aree)
  if (isManager) {
    html.push(section("Dashboard"));
    html.push(link("dashboard.html", "Dashboard"));
    html.push(link("dashboard-controllo.html", "Dashboard controllo"));
    html.push(link("dashboard-costi.html", "Dashboard costi"));

    html.push(section("Operativo"));
    html.push(link("operativo.html", "Oggi"));
    html.push(link("note.html", "Note & Alert", `<span class="badge" data-fp-inbox-badge style="display:none;"></span>`));
    html.push(link("notifiche.html", "Notifiche"));
    html.push(link("fatturazione.html", "Fatturazione"));

    html.push(section("Front Office"));
    html.push(link("front-office.html", "Home"));
    html.push(link("vendite.html", "Vendite"));
    html.push(link("pratiche-assicurative.html", "Assicurazioni"));
    html.push(link("archivio-documenti.html", "Archivio documenti"));

    html.push(section("Back Office"));
    html.push(link("back-office.html", "Home"));
    html.push(link("gestione-contabile.html", "Gestione contabile"));
    html.push(link("erogato.html", "Erogato"));

    html.push(section("Clinico"));
    html.push(link("anamnesi.html", "Anamnesi"));
    html.push(link("fisioterapisti.html", "Fisioterapisti"));

    html.push(section("Manager"));
    html.push(link("manager.html", "Home Manager"));
    html.push(link("/manager/dashboard.html", "Dashboard CFO"));
    html.push(link("/manager/riepilogo-mensile.html", "Riepilogo mensile"));
    html.push(link("/manager/costi-per-categoria.html", "Costi per categoria"));
  }

  // --------
  // Sessione
  // --------
  html.push(section("Sessione"));
  html.push(link("login.html", "Logout"));

  nav.innerHTML = html.join("\n");

  nav.setAttribute("data-fp-unified-nav", "1");
}

// Inject "Controllo di Gestione" section into the persistent sidebar.
// This avoids editing many HTML files and plays well with the SPA router (sidebar stays mounted).
function ensureControlloGestioneMenu() {
  const nav = document.querySelector(".sidebar .nav");
  if (!nav) return;
  // If unified menu is active, it already contains these items.
  if (nav.getAttribute("data-fp-unified-nav") === "1") return;
  const role = String((window.FP_USER?.role || window.FP_SESSION?.role || "")).trim();
  if (role !== "manager") return;
  if (nav.querySelector("[data-fp-cdg-menu]")) return;

  // If links already exist in HTML, don't duplicate.
  const hasCosti = Boolean(nav.querySelector('a[href$="costi-per-categoria.html"]'));
  const hasCtrl = Boolean(nav.querySelector('a[href$="riepilogo-mensile.html"]'));
  if (hasCosti && hasCtrl) return;

  const marker = document.createElement("div");
  marker.setAttribute("data-fp-cdg-menu", "1");
  marker.style.display = "none";

  const section = document.createElement("div");
  section.className = "section";
  section.setAttribute("data-role", "manager");
  section.textContent = "Controllo di Gestione";

  const a1 = document.createElement("a");
  a1.setAttribute("data-nav", "");
  a1.setAttribute("data-role", "manager");
  a1.href = "/manager/costi-per-categoria.html";
  a1.textContent = "Costi per categoria";

  const a2 = document.createElement("a");
  a2.setAttribute("data-nav", "");
  a2.setAttribute("data-role", "manager");
  a2.href = "/manager/riepilogo-mensile.html";
  a2.textContent = "Riepilogo mensile";

  // Insert before Logout link if possible (keeps menu tidy)
  const logout = nav.querySelector('a[href$="login.html"], a[href$="/login.html"]');
  const insertBeforeNode = logout || null;

  nav.insertBefore(marker, insertBeforeNode);
  if (!hasCosti || !hasCtrl) {
    nav.insertBefore(section, insertBeforeNode);
    if (!hasCosti) nav.insertBefore(a1, insertBeforeNode);
    if (!hasCtrl) nav.insertBefore(a2, insertBeforeNode);
  }
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

// =====================
// BRAND LOGO (from Airtable AZIENDA.Logo)
// =====================
async function initBrandLogo() {
  // Only run if the sidebar brand exists
  if (!document.querySelector(".sidebar .brand .dot")) return;

  try {
    const data = await api("/api/azienda");
    const url = String(data?.logoUrl || "").trim();
    if (!url) return;

    // Set CSS var used by .brand .dot background-image
    const safe = url.replace(/"/g, "%22");
    document.documentElement.style.setProperty("--brandLogo", `url("${safe}")`);
  } catch {
    // keep default logo
  }
}

function setUserBadges(user) {
  const fullName = user
    ? [user.nome || "", user.cognome || ""].map(s => String(s || "").trim()).filter(Boolean).join(" ")
    : "";
  const label = user
    ? [fullName || user.nome || "", user.roleLabel || user.role || ""].filter(Boolean).join(" • ")
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
function isDashboardPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/dashboard.html") || p.endsWith("/dashboard.html");
}
function isOperativoPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/operativo.html") || p.endsWith("/operativo.html");
}

function isSalesPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/vendite.html") || p.endsWith("/vendite.html");
}
function isErogatoPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/erogato.html") || p.endsWith("/erogato.html");
}
function isInsurancePage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/pratiche-assicurative.html") || p.endsWith("/pratiche-assicurative.html");
}
function isAnamnesiPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/anamnesi.html") || p.endsWith("/anamnesi.html");
}

// =====================
// NOTES & ALERTS (operational inbox)
// =====================
function isNotesPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/note.html") || p.endsWith("/note.html");
}

function toStartOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDaysLocal(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + Number(n || 0));
  return x;
}

function apptLabel(a) {
  const who = a.patient_name || "(senza nome)";
  const when = fmtTime(a.start_at);
  const svc = a.service_name ? ` • ${a.service_name}` : "";
  const th = a.therapist_name ? ` • ${a.therapist_name}` : "";
  return `${when} • ${who}${svc}${th}`;
}

async function updateInboxBadge() {
  const badge = document.querySelector("[data-fp-inbox-badge]");
  if (!badge) return;

  // Cache for ~60s to keep navigation snappy.
  const key = "fp_inbox_badge_v1";
  let prevN = null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || "null");
    if (cached && Date.now() - Number(cached.t || 0) < 60_000) {
      const n = Number(cached.n || 0);
      badge.textContent = String(n);
      badge.style.display = n > 0 ? "" : "none";
      return;
    }
    if (cached && typeof cached.n === "number") prevN = Number(cached.n || 0);
  } catch {}

  try {
    const start = new Date(); // now
    const end = addDaysLocal(start, 2);
    // Fast path: ask backend for counts only (no big payload, no linked-name lookups).
    const data = await api(
      `/api/appointments?summary=1&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
    );
    const c = data?.counts || {};
    const n =
      Number(c.missingPatient || 0) +
      Number(c.needConfirmPatient || 0) +
      Number(c.needConfirmPlatform || 0);
    badge.textContent = String(n);
    badge.style.display = n > 0 ? "" : "none";
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), n })); } catch {}

    // In-app notification when new alerts appear (best-effort, non-invasive).
    if (prevN !== null && n > prevN && n > 0) {
      toast(`Nuovi alert: +${n - prevN} (totale ${n})`);
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("FisioPro • Note & Alert", { body: `Hai ${n} alert operativi.` });
        }
      } catch {}
    }
  } catch {
    // If inbox can't load, don't show a misleading badge.
    badge.style.display = "none";
  }
}

async function initNotesPage() {
  if (!isNotesPage()) return;

  const loadingEl = document.querySelector("[data-fp-notes-loading]");
  const errorEl = document.querySelector("[data-fp-notes-error]");
  const groupsEl = document.querySelector("[data-fp-notes-groups]");
  const summaryEl = document.querySelector("[data-fp-notes-summary]");
  const refreshBtn = document.querySelector("[data-fp-notes-refresh]");
  const enableNotifyBtn = document.querySelector("[data-fp-notes-enable-notify]");
  const ruleBoxes = Array.from(document.querySelectorAll("[data-fp-notes-rule]"));

  const setActiveRangeBtn = (val) => {
    document.querySelectorAll("[data-fp-notes-range]").forEach((b) => {
      b.classList.toggle("primary", String(b.getAttribute("data-fp-notes-range")) === String(val));
    });
  };

  const getRange = () => String(sessionStorage.getItem("fp_notes_range") || "48h");
  const setRange = (v) => { try { sessionStorage.setItem("fp_notes_range", String(v)); } catch {} };

  const rulesKey = (() => {
    const email = String((window.FP_USER?.email || window.FP_SESSION?.email || "anon")).trim().toLowerCase() || "anon";
    return `fp_notes_rules_v1_${email}`;
  })();
  const defaultRules = {
    contacts: true,
    consent: true,
    insurance: true,
    confirmPatient: true,
    confirmPlatform: true,
    missingPatient: true,
    billing: true,
  };
  const loadRules = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(rulesKey) || "null");
      const obj = raw && typeof raw === "object" ? raw : {};
      return { ...defaultRules, ...obj };
    } catch {
      return { ...defaultRules };
    }
  };
  const saveRules = (next) => {
    try { localStorage.setItem(rulesKey, JSON.stringify(next)); } catch {}
  };
  const getRulesFromUI = () => {
    const cur = loadRules();
    ruleBoxes.forEach((b) => {
      const k = String(b.getAttribute("data-fp-notes-rule") || "").trim();
      if (!k) return;
      cur[k] = Boolean(b.checked);
    });
    return cur;
  };
  const syncRulesUI = (rules) => {
    ruleBoxes.forEach((b) => {
      const k = String(b.getAttribute("data-fp-notes-rule") || "").trim();
      if (!k) return;
      b.checked = Boolean(rules?.[k]);
    });
  };

  const computeRange = (rangeKey) => {
    const now = new Date();
    if (rangeKey === "today") {
      const s = toStartOfDay(now);
      const e = addDaysLocal(s, 1);
      return { start: s, end: e, label: "Oggi" };
    }
    if (rangeKey === "7d") {
      const s = now;
      const e = addDaysLocal(now, 7);
      return { start: s, end: e, label: "Prossimi 7 giorni" };
    }
    // default "48h"
    return { start: now, end: addDaysLocal(now, 2), label: "Prossime 48 ore" };
  };

  const renderGroups = (groups) => {
    if (!groupsEl) return;
    groupsEl.innerHTML = "";

    (groups || []).forEach((g) => {
      const wrap = document.createElement("div");
      wrap.className = "fpNotesGroup";
      wrap.innerHTML = `
        <div class="fpNotesGroupHead">
          <div>${g.title}</div>
          <div class="badge">${g.items.length}</div>
        </div>
        <div class="fpNotesItems"></div>
      `;
      const itemsEl = wrap.querySelector(".fpNotesItems");
      (g.items || []).forEach((it) => {
        const row = document.createElement("div");
        row.className = "fpNotesItem";
        row.innerHTML = `
          <div class="fpNotesItemTop">
            <div>
              <div class="fpNotesItemTitle">${it.title}</div>
              <div class="fpNotesItemMeta">${it.meta || ""}</div>
            </div>
            <div class="fpNotesTiny">${it.badge || ""}</div>
          </div>
          <div class="fpNotesItemActions"></div>
        `;
        const actionsEl = row.querySelector(".fpNotesItemActions");
        (it.actions || []).forEach((a) => {
          const btn = document.createElement(a.kind === "link" ? "a" : "button");
          btn.className = a.primary ? "btn primary" : "btn";
          if (a.kind === "link") {
            btn.setAttribute("href", a.href || "#");
            if (a.target) btn.setAttribute("target", a.target);
          } else {
            btn.type = "button";
            btn.onclick = a.onClick || null;
          }
          btn.textContent = a.label;
          actionsEl.appendChild(btn);
        });
        itemsEl.appendChild(row);
      });
      groupsEl.appendChild(wrap);
    });
  };

  const normalizeTel = (v) => String(v || "").trim().replace(/[^\d+]/g, "");

  const mapWithConcurrency = async (items, limit, fn) => {
    const arr = Array.from(items || []);
    const out = new Array(arr.length);
    const cap = Math.max(1, Math.min(Number(limit) || 8, 16));
    let idx = 0;
    const worker = async () => {
      while (idx < arr.length) {
        const i = idx++;
        try { out[i] = await fn(arr[i], i); } catch (e) { out[i] = null; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(cap, arr.length) }, worker));
    return out;
  };

  const patientCache = new Map();   // patientId -> { Telefono, Email, ... }
  const anamnesiCache = new Map();  // patientId -> { ok, items }
  const insuranceCache = new Map(); // patientId -> { items }

  const getPatient = async (patientId) => {
    const pid = String(patientId || "").trim();
    if (!pid) return null;
    if (patientCache.has(pid)) return patientCache.get(pid);
    const p = await api(`/api/patient?id=${encodeURIComponent(pid)}`);
    patientCache.set(pid, p || null);
    return p || null;
  };
  const getAnamnesi = async (patientId) => {
    const pid = String(patientId || "").trim();
    if (!pid) return null;
    if (anamnesiCache.has(pid)) return anamnesiCache.get(pid);
    const a = await api(`/api/anamnesi?patientId=${encodeURIComponent(pid)}&maxRecords=50`);
    anamnesiCache.set(pid, a || null);
    return a || null;
  };
  const getInsurance = async (patientId) => {
    const pid = String(patientId || "").trim();
    if (!pid) return null;
    if (insuranceCache.has(pid)) return insuranceCache.get(pid);
    const ins = await api(`/api/insurance?patientId=${encodeURIComponent(pid)}`);
    insuranceCache.set(pid, ins || null);
    return ins || null;
  };

  const isClosedStatus = (statoRaw) => {
    const s = String(statoRaw || "").trim().toLowerCase();
    if (!s) return false;
    return (
      s.includes("chius") ||
      s.includes("conclus") ||
      s.includes("liquidat") ||
      s.includes("pagat") ||
      s.includes("ok") ||
      s === "chiusa" ||
      s === "chiuso"
    );
  };

  const isCompletedish = (statoRaw) => {
    const s = String(statoRaw || "").trim().toLowerCase();
    if (!s) return false;
    return (
      s.includes("eseguit") ||
      s.includes("complet") ||
      s.includes("termin") ||
      s.includes("chius") ||
      s.includes("fatto") ||
      s.includes("erogat") ||
      s === "ok"
    );
  };
  const isPast = (iso) => {
    const d = new Date(String(iso || ""));
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() < Date.now();
  };

  const load = async () => {
    if (!groupsEl) return;
    const rules = getRulesFromUI();
    saveRules(rules);

    const rangeKey = getRange();
    setActiveRangeBtn(rangeKey);
    const { start, end, label } = computeRange(rangeKey);

    const data = await window.fpWithLoading({
      loadingEl,
      errorEl,
      run: () => api(`/api/appointments?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`),
      loadingText: "Caricamento inbox…",
    });

    const appts = (data.appointments || []).slice();
    appts.sort((a, b) => String(a.start_at || "").localeCompare(String(b.start_at || ""), "it"));

    const missingPatient = rules.missingPatient ? appts.filter((a) => !a.patient_id) : [];
    const needConfirmPatient = rules.confirmPatient ? appts.filter((a) => a.patient_id && !a.confirmed_by_patient) : [];
    const needConfirmPlatform = rules.confirmPlatform ? appts.filter((a) => a.patient_id && !a.confirmed_in_platform) : [];

    // Fetch patient-level data only for patients in range (bounded).
    const uniquePatientIds = Array.from(new Set(appts.map((a) => String(a.patient_id || "")).filter(Boolean)));
    const maxPatients = 60; // safety cap (keeps page responsive in large ranges)
    const patientIds = uniquePatientIds.slice(0, maxPatients);

    if (rules.contacts || rules.consent || rules.insurance) {
      await mapWithConcurrency(patientIds, 10, async (pid) => {
        // Preload minimal info used by rules (best-effort).
        await getPatient(pid);
        return true;
      });
    }

    const missingContacts = [];
    if (rules.contacts) {
      for (const a of appts) {
        if (!a.patient_id) continue;
        const p = patientCache.get(String(a.patient_id)) || null;
        const tel = normalizeTel(p?.Telefono);
        const email = String(p?.Email || "").trim();
        if (!tel && !email) missingContacts.push(a);
      }
    }

    // Consent/anamnesi + insurance checks (bounded)
    if (rules.consent || rules.insurance) {
      await mapWithConcurrency(patientIds, 8, async (pid) => {
        const ps = [];
        if (rules.consent) ps.push(getAnamnesi(pid));
        if (rules.insurance) ps.push(getInsurance(pid));
        await Promise.allSettled(ps);
        return true;
      });
    }

    const missingConsent = [];
    if (rules.consent) {
      for (const a of appts) {
        if (!a.patient_id) continue;
        const an = anamnesiCache.get(String(a.patient_id)) || null;
        const items = an?.items || [];
        const hasConsent = items.some((x) => Boolean(x?.consenso) || String(x?.dataConsenso || "").trim());
        if (!hasConsent) missingConsent.push(a);
      }
    }

    const openInsurance = [];
    if (rules.insurance) {
      for (const a of appts) {
        if (!a.patient_id) continue;
        const ins = insuranceCache.get(String(a.patient_id)) || null;
        const items = ins?.items || [];
        if (!items.length) continue;
        const hasOpen = items.some((x) => !isClosedStatus(x?.stato));
        if (hasOpen) openInsurance.push(a);
      }
    }

    if (summaryEl) {
      const parts = [label];
      if (rules.missingPatient) parts.push(`Nuovi pazienti da agganciare: ${missingPatient.length}`);
      if (rules.confirmPatient) parts.push(`Conferme paziente: ${needConfirmPatient.length}`);
      if (rules.confirmPlatform) parts.push(`Conferme piattaforma: ${needConfirmPlatform.length}`);
      if (rules.contacts) parts.push(`Contatti mancanti: ${missingContacts.length}`);
      if (rules.consent) parts.push(`Consensi/anamnesi: ${missingConsent.length}`);
      if (rules.insurance) parts.push(`Assicurazioni aperte: ${openInsurance.length}`);
      summaryEl.textContent = parts.join(" • ");
      if (uniquePatientIds.length > maxPatients) {
        summaryEl.textContent += ` • Pazienti analizzati: ${maxPatients}/${uniquePatientIds.length}`;
      }
    }

    const mkApptActions = (a) => {
      const actions = [
        { kind: "link", label: "Apri Agenda", href: "agenda.html", primary: false },
      ];
      if (a.id) {
        actions.push({
          kind: "button",
          label: "Segna confermato (paziente)",
          primary: true,
          onClick: async () => {
            await api(`/api/appointments?id=${encodeURIComponent(a.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ confirmed_by_patient: true }),
            });
            toast("Conferma paziente salvata");
            try { sessionStorage.removeItem("fp_inbox_badge_v1"); } catch {}
            await load();
            await updateInboxBadge();
          },
        });
        actions.push({
          kind: "button",
          label: "Segna conferma (piattaforma)",
          primary: false,
          onClick: async () => {
            await api(`/api/appointments?id=${encodeURIComponent(a.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ confirmed_in_platform: true }),
            });
            toast("Conferma piattaforma salvata");
            try { sessionStorage.removeItem("fp_inbox_badge_v1"); } catch {}
            await load();
            await updateInboxBadge();
          },
        });
        actions.push({
          kind: "button",
          label: "Nota interna",
          primary: false,
          onClick: async () => {
            const prev = String(a.internal_note || a.quick_note || "").trim();
            const txt = prompt("Nota interna (visibile solo internamente):", prev);
            if (txt === null) return;
            await api(`/api/appointments?id=${encodeURIComponent(a.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ quick_note: String(txt || "").trim() }),
            });
            toast("Nota salvata");
            await load();
          },
        });
      }
      if (a.patient_id) {
        actions.push({
          kind: "button",
          label: "Contatti paziente",
          primary: false,
          onClick: async () => {
            try {
              const p = await api(`/api/patient?id=${encodeURIComponent(a.patient_id)}`);
              const telRaw = String(p.Telefono || "").trim();
              const tel = telRaw.replace(/[^\d+]/g, "");
              const wa = tel ? `https://wa.me/${tel.replace(/^\+/, "")}` : "";
              const email = String(p.Email || "").trim();
              const msg = [
                telRaw ? `Tel: ${telRaw}` : "",
                email ? `Email: ${email}` : "",
                wa ? `WhatsApp: ${wa}` : "",
              ].filter(Boolean).join("\n");
              alert(msg || "Contatti non disponibili");
            } catch (e) {
              alert("Contatti non disponibili");
            }
          },
        });
        actions.push({
          kind: "link",
          label: "Scheda paziente",
          href: `paziente.html?id=${encodeURIComponent(a.patient_id)}`,
          primary: false,
        });
        actions.push({
          kind: "link",
          label: "Anamnesi/consensi",
          href: `anamnesi.html?patientId=${encodeURIComponent(a.patient_id)}`,
          primary: false,
        });
        actions.push({
          kind: "link",
          label: "Pratiche assicurative",
          href: `pratiche-assicurative.html?patientId=${encodeURIComponent(a.patient_id)}`,
          primary: false,
        });
        actions.push({
          kind: "link",
          label: "Vendite",
          href: `vendite.html?patientId=${encodeURIComponent(a.patient_id)}`,
          primary: false,
        });
        actions.push({
          kind: "link",
          label: "Erogato",
          href: `erogato.html?patientId=${encodeURIComponent(a.patient_id)}`,
          primary: false,
        });
      }
      if (!a.patient_id) {
        actions.push({ kind: "link", label: "Crea paziente", href: "nuovo-paziente.html", primary: true });
      }
      return actions;
    };

    const groups = [
      {
        title: "Contatti mancanti (rischio perdita paziente)",
        items: missingContacts.map((a) => ({
          title: apptLabel(a),
          meta: "Azione: inserire telefono/email in scheda paziente prima dell'appuntamento.",
          badge: "☎️",
          actions: mkApptActions(a),
        })),
      },
      {
        title: "Consenso informato / anamnesi mancanti",
        items: missingConsent.map((a) => ({
          title: apptLabel(a),
          meta: "Azione: raccogliere consensi e aggiornare anamnesi (privacy ecc.).",
          badge: "📝",
          actions: mkApptActions(a),
        })),
      },
      {
        title: "Nuovi pazienti (appuntamento senza scheda)",
        items: missingPatient.map((a) => ({
          title: apptLabel(a),
          meta: "Azione: crea/aggancia la scheda paziente (quando è in sede o appena possibile).",
          badge: "⚠️",
          actions: mkApptActions(a),
        })),
      },
      {
        title: "Conferme da ottenere (paziente)",
        items: needConfirmPatient.map((a) => ({
          title: apptLabel(a),
          meta: "Azione: contatta e poi marca come confermato.",
          badge: "⏳",
          actions: mkApptActions(a),
        })),
      },
      {
        title: "Conferme in piattaforma (InBuoneMani)",
        items: needConfirmPlatform.map((a) => ({
          title: apptLabel(a),
          meta: "Azione: verifica e marca la conferma in piattaforma.",
          badge: "⏳",
          actions: mkApptActions(a),
        })),
      },
      {
        title: "Pratiche assicurative aperte (verifica stato)",
        items: openInsurance.map((a) => ({
          title: apptLabel(a),
          meta: "Azione: controlla pratica assicurativa e documentazione prima/durante la visita.",
          badge: "🛡️",
          actions: mkApptActions(a),
        })),
      },
      {
        title: "Pagamenti / Erogato da sistemare",
        items: (rules.billing ? appts : [])
          .filter((a) => a.patient_id && isPast(a.start_at))
          .filter((a) => isCompletedish(a.status) || Boolean(a.confirmed_by_patient) || Boolean(a.confirmed_in_platform))
          .filter((a) => !String(a.erogato_id || "").trim() && !String(a.vendita_id || "").trim())
          .map((a) => ({
            title: apptLabel(a),
            meta: "Azione: verificare se va creato/collegato Erogato o Vendita e chiudere il flusso pagamenti.",
            badge: "€",
            actions: mkApptActions(a),
          })),
      },
    ].filter((g) => g.items.length);

    if (!groups.length) {
      renderGroups([{ title: "Tutto sotto controllo", items: [{ title: "Nessun alert nel periodo selezionato.", meta: "", badge: "✅", actions: [] }] }]);
    } else {
      renderGroups(groups);
    }
  };

  document.querySelectorAll("[data-fp-notes-range]").forEach((b) => {
    b.addEventListener("click", () => {
      const v = String(b.getAttribute("data-fp-notes-range") || "48h");
      setRange(v);
      load().catch(() => {});
    });
  });
  refreshBtn && (refreshBtn.onclick = () => load().catch(() => {}));

  // Rules UI: initialize + reload on change
  if (ruleBoxes.length) {
    const saved = loadRules();
    syncRulesUI(saved);
    ruleBoxes.forEach((b) => {
      b.addEventListener("change", () => load().catch(() => {}));
    });
  }

  if (enableNotifyBtn) {
    const updateBtnLabel = () => {
      try {
        const p = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
        enableNotifyBtn.textContent =
          p === "granted" ? "Notifiche attive" :
          p === "denied" ? "Notifiche bloccate" :
          "Abilita notifiche";
        enableNotifyBtn.disabled = p === "granted";
      } catch {}
    };
    updateBtnLabel();
    enableNotifyBtn.onclick = async () => {
      try {
        if (typeof Notification === "undefined") {
          alert("Notifiche non supportate su questo browser.");
          return;
        }
        const p = await Notification.requestPermission();
        updateBtnLabel();
        if (p === "granted") toast("Notifiche abilitate");
      } catch {
        // ignore
      }
    };
  }

  await load();
}

// =====================
// FILTERED LIST PAGES (support ?patientId=recXXX)
// =====================
function fmtItDate(isoOrStr) {
  const s = String(isoOrStr || "").trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  try { return d.toLocaleDateString("it-IT"); } catch { return s; }
}
function boolChip(ok, yes = "OK", no = "Mancante") {
  const label = ok ? yes : no;
  return `<span class="chip"${ok ? "" : ' style="border-color:rgba(255,77,109,.35);background:rgba(255,77,109,.10)"'}>${label}</span>`;
}

async function initSalesPage() {
  if (!isSalesPage()) return;
  const tbody = document.querySelector("[data-sales-tbody]");
  if (!tbody) return;
  const loadingEl = document.querySelector("[data-sales-loading]");
  const errorEl = document.querySelector("[data-sales-error]");
  const patientId = getQueryParam("patientId") || "";
  if (!patientId) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Apri da una scheda paziente o da Note & Alert (manca patientId).</td></tr>`;
    return;
  }

  const p = await api(`/api/patient?id=${encodeURIComponent(patientId)}`).catch(() => null);
  if (p) toast(`Vendite • ${[p.Nome, p.Cognome].filter(Boolean).join(" ").trim() || "Paziente"}`);

  const data = await window.fpWithLoading({
    loadingEl,
    errorEl,
    run: () => api(`/api/sales?patientId=${encodeURIComponent(patientId)}`),
    loadingText: "Caricamento vendite…",
  });

  const items = data.items || [];
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Nessuna vendita.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map((x) => `
    <tr>
      <td>${fmtItDate(x.data)}</td>
      <td>${p ? [p.Nome, p.Cognome].filter(Boolean).join(" ").trim() : "—"}</td>
      <td>${normStr(x.voce) || "—"}</td>
      <td style="text-align:right;">${normStr(x.importo) || "—"}</td>
      <td>${normStr(x.note) || "—"}</td>
    </tr>
  `).join("");
}

async function initErogatoPage() {
  if (!isErogatoPage()) return;
  const tbody = document.querySelector("[data-erogato-tbody]");
  if (!tbody) return;
  const loadingEl = document.querySelector("[data-erogato-loading]");
  const errorEl = document.querySelector("[data-erogato-error]");
  const patientId = getQueryParam("patientId") || "";
  if (!patientId) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Apri da una scheda paziente o da Note & Alert (manca patientId).</td></tr>`;
    return;
  }

  const p = await api(`/api/patient?id=${encodeURIComponent(patientId)}`).catch(() => null);
  if (p) toast(`Erogato • ${[p.Nome, p.Cognome].filter(Boolean).join(" ").trim() || "Paziente"}`);

  const data = await window.fpWithLoading({
    loadingEl,
    errorEl,
    run: () => api(`/api/erogato?patientId=${encodeURIComponent(patientId)}&maxRecords=100`),
    loadingText: "Caricamento erogato…",
  });
  const items = data.items || [];
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Nessuna prestazione erogata.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map((x) => `
    <tr>
      <td>${fmtItDate(x.data)}</td>
      <td>${p ? [p.Nome, p.Cognome].filter(Boolean).join(" ").trim() : "—"}</td>
      <td>${normStr(x.prestazione) || "—"}</td>
      <td>${normStr(x.stato) ? `<span class="chip">${normStr(x.stato)}</span>` : `<span class="chip">—</span>`}</td>
      <td>${normStr(x.note) || "—"}</td>
    </tr>
  `).join("");
}

async function initInsurancePage() {
  if (!isInsurancePage()) return;
  const tbody = document.querySelector("[data-insurance-tbody]");
  if (!tbody) return;
  const loadingEl = document.querySelector("[data-insurance-loading]");
  const errorEl = document.querySelector("[data-insurance-error]");
  const patientId = getQueryParam("patientId") || "";
  if (!patientId) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Apri da una scheda paziente o da Note & Alert (manca patientId).</td></tr>`;
    return;
  }

  const p = await api(`/api/patient?id=${encodeURIComponent(patientId)}`).catch(() => null);
  if (p) toast(`Assicurazioni • ${[p.Nome, p.Cognome].filter(Boolean).join(" ").trim() || "Paziente"}`);

  const data = await window.fpWithLoading({
    loadingEl,
    errorEl,
    run: () => api(`/api/insurance?patientId=${encodeURIComponent(patientId)}`),
    loadingText: "Caricamento pratiche…",
  });
  const items = data.items || [];
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Nessuna pratica.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map((x) => `
    <tr>
      <td>${fmtItDate(x.data)}</td>
      <td>${p ? [p.Nome, p.Cognome].filter(Boolean).join(" ").trim() : "—"}</td>
      <td>${normStr(x.pratica) || "—"}</td>
      <td>${normStr(x.stato) ? `<span class="chip">${normStr(x.stato)}</span>` : `<span class="chip">—</span>`}</td>
      <td>${normStr(x.note) || "—"}</td>
    </tr>
  `).join("");
}

async function initAnamnesiPage() {
  if (!isAnamnesiPage()) return;
  const tbody = document.querySelector("[data-anamnesi-tbody]");
  if (!tbody) return;
  const loadingEl = document.querySelector("[data-anamnesi-loading]");
  const errorEl = document.querySelector("[data-anamnesi-error]");
  const patientId = getQueryParam("patientId") || "";
  if (!patientId) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">Apri da una scheda paziente o da Note & Alert (manca patientId).</td></tr>`;
    return;
  }

  const p = await api(`/api/patient?id=${encodeURIComponent(patientId)}`).catch(() => null);
  const patientName = p ? [p.Nome, p.Cognome].filter(Boolean).join(" ").trim() : "Paziente";
  if (p) toast(`Anamnesi • ${patientName || "Paziente"}`);

  const data = await window.fpWithLoading({
    loadingEl,
    errorEl,
    run: () => api(`/api/anamnesi?patientId=${encodeURIComponent(patientId)}&maxRecords=50`),
    loadingText: "Caricamento anamnesi…",
  });
  const items = data.items || [];
  if (!items.length) {
    tbody.innerHTML = `
      <tr>
        <td><div class="rowlink">${patientName || "—"}</div></td>
        <td>${boolChip(false, "OK", "Mancante")}</td>
        <td>${boolChip(false, "OK", "Mancante")}</td>
        <td>—</td>
      </tr>
    `;
    return;
  }
  // latest first (best-effort by consent date or id)
  const sorted = items.slice().sort((a, b) => String(b.dataConsenso || b.id).localeCompare(String(a.dataConsenso || a.id)));
  const latest = sorted[0] || {};
  const hasAnam = Boolean(String(latest.anamnesiRemota || latest.anamnesiRecente || "").trim());
  const hasCons = Boolean(latest.consenso) || Boolean(String(latest.dataConsenso || "").trim());
  tbody.innerHTML = `
    <tr>
      <td><div class="rowlink">${patientName || "—"}</div></td>
      <td>${boolChip(hasAnam, "OK", "In attesa")}</td>
      <td>${boolChip(hasCons, "OK", "Mancante")}</td>
      <td>${latest.dataConsenso ? fmtItDate(latest.dataConsenso) : "—"}</td>
    </tr>
  `;
}

// =====================
// OPERATIVO (Oggi hub)
// =====================
async function initOperativoPage() {
  if (!isOperativoPage()) return;

  const loadingEl = document.querySelector("[data-op-loading]");
  const errorEl = document.querySelector("[data-op-error]");
  const summaryEl = document.querySelector("[data-op-summary]");
  const btnRefresh = document.querySelector("[data-op-refresh]");

  const kAppts = document.querySelector("[data-op-kpi-appts]");
  const kApptsMini = document.querySelector("[data-op-kpi-appts-mini]");
  const kAlerts = document.querySelector("[data-op-kpi-alerts]");
  const kAlertsMini = document.querySelector("[data-op-kpi-alerts-mini]");
  const kBilling = document.querySelector("[data-op-kpi-billing]");
  const kBillingMini = document.querySelector("[data-op-kpi-billing-mini]");

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);

  const load = async () => {
    const data = await window.fpWithLoading({
      loadingEl,
      errorEl,
      run: () => api(`/api/appointments?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`),
      loadingText: "Caricamento operativo…",
    });

    const appts = data.appointments || [];
    const total = appts.length;
    const missingPatient = appts.filter((a) => !a.patient_id).length;
    const needConfirmPatient = appts.filter((a) => a.patient_id && !a.confirmed_by_patient).length;
    const needConfirmPlatform = appts.filter((a) => a.patient_id && !a.confirmed_in_platform).length;

    const isCompletedish = (statoRaw) => {
      const s = String(statoRaw || "").trim().toLowerCase();
      if (!s) return false;
      return (
        s.includes("eseguit") ||
        s.includes("complet") ||
        s.includes("termin") ||
        s.includes("chius") ||
        s.includes("fatto") ||
        s.includes("erogat") ||
        s === "ok"
      );
    };
    const isPast = (iso) => {
      const d = new Date(String(iso || ""));
      if (Number.isNaN(d.getTime())) return false;
      return d.getTime() < Date.now();
    };
    const billing = appts
      .filter((a) => a.patient_id && isPast(a.start_at))
      .filter((a) => isCompletedish(a.status) || Boolean(a.confirmed_by_patient) || Boolean(a.confirmed_in_platform))
      .filter((a) => !String(a.erogato_id || "").trim() && !String(a.vendita_id || "").trim())
      .length;

    // Alerts KPI: reuse the same definition as the inbox badge
    const alerts = missingPatient + needConfirmPatient + needConfirmPlatform + billing;

    if (kAppts) kAppts.textContent = String(total);
    if (kApptsMini) kApptsMini.textContent = `Senza scheda paziente: ${missingPatient}`;
    if (kAlerts) kAlerts.textContent = String(alerts);
    if (kAlertsMini) kAlertsMini.textContent = `Conferme: ${needConfirmPatient + needConfirmPlatform} • Pagamenti: ${billing}`;
    if (kBilling) kBilling.textContent = String(billing);
    if (kBillingMini) kBillingMini.textContent = `Appuntamenti svolti senza vendita/erogato`;

    if (summaryEl) {
      summaryEl.textContent =
        `Oggi: ${total} appuntamenti • ` +
        `Nuovi pazienti: ${missingPatient} • ` +
        `Conferme: ${needConfirmPatient + needConfirmPlatform} • ` +
        `Pagamenti da chiudere: ${billing}`;
    }

    // Keep sidebar badge in sync
    try { sessionStorage.removeItem("fp_inbox_badge_v1"); } catch {}
    await updateInboxBadge();
  };

  btnRefresh && (btnRefresh.onclick = () => load().catch(() => {}));
  await load();
}
function isDashboardCostiPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/dashboard-costi.html") || p.endsWith("/dashboard-costi.html");
}
function isDashboardControlloPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/dashboard-controllo.html") || p.endsWith("/dashboard-controllo.html");
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

// =====================
// DASHBOARD (KPI "Oggi")
// =====================
function normalizeApptType(v) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
function parseDateSafe(v) {
  const d = new Date(String(v || ""));
  return Number.isNaN(d.getTime()) ? null : d;
}
function overlapMinutesForDay(appt, dayStart, dayEnd) {
  const s = parseDateSafe(appt?.start_at);
  if (!s) return 0;

  let e = parseDateSafe(appt?.end_at);
  if (!e) {
    const raw = appt?.duration;
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (Number.isFinite(n) && n > 0) e = new Date(s.getTime() + n * 60_000);
  }
  if (!e) return 0;

  const start = s < dayStart ? dayStart : s;
  const end = e > dayEnd ? dayEnd : e;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0, Math.round(ms / 60_000));
}

async function initDashboard() {
  if (!isDashboardPage()) return;

  const valueEl = document.querySelector("[data-kpi-today]");
  const miniEl = document.querySelector("[data-kpi-today-mini]");
  if (!valueEl) return;

  valueEl.textContent = "—";
  if (miniEl) miniEl.textContent = "Caricamento…";

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  try {
    const wantedType = "appuntamento paziente";
    // Fast path: backend computes KPI without returning full appointment list.
    try {
      const k = await api(
        `/api/appointments?kpi=1&type=${encodeURIComponent(wantedType)}&start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(dayEnd.toISOString())}`,
      );
      const slots = Number(k?.kpi?.slots || 0);
      valueEl.textContent = String(slots);
      if (miniEl) miniEl.textContent = `Slot da 60' • solo "Appuntamento paziente"`;
      return;
    } catch {}

    // Fallback (compat): compute KPI from full list.
    const data = await api(
      `/api/appointments?start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(dayEnd.toISOString())}`,
    );
    const appts = Array.isArray(data?.appointments) ? data.appointments : [];
    const filtered = appts.filter((a) => normalizeApptType(a?.appointment_type) === wantedType);
    let minutes = 0;
    for (const a of filtered) minutes += overlapMinutesForDay(a, dayStart, dayEnd);
    const slots = minutes <= 0 ? 0 : Math.ceil(minutes / 60);
    valueEl.textContent = String(slots);
    if (miniEl) miniEl.textContent = `Slot da 60' • solo "Appuntamento paziente"`;
  } catch (e) {
    console.error(e);
    if (miniEl) miniEl.textContent = "Impossibile caricare gli appuntamenti di oggi.";
  }
}

// =====================
// CFO DASHBOARDS (Manager only)
// =====================
async function ensureChartJs() {
  if (window.Chart) return;
  if (window.__FP_CHARTJS_LOADING) return await window.__FP_CHARTJS_LOADING;

  window.__FP_CHARTJS_LOADING = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("chartjs_load_failed"));
    document.head.appendChild(s);
  });
  return await window.__FP_CHARTJS_LOADING;
}

function fmtEuro(n) {
  const v = typeof n === "number" && isFinite(n) ? n : Number(n || 0);
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${Math.round(v * 100) / 100} €`;
  }
}

function fmtPct(n) {
  const v = typeof n === "number" && isFinite(n) ? n : Number(n || 0);
  const x = Math.round(v * 10) / 10;
  return `${x}%`;
}

function chartKeyFor(el) {
  const k = el?.getAttribute?.("data-chart-key");
  if (k) return k;
  const id = el?.id || "";
  return id ? `chart:${id}` : `chart:${Math.random().toString(36).slice(2)}`;
}

function destroyChartFor(canvas) {
  const key = chartKeyFor(canvas);
  window.__FP_CHARTS = window.__FP_CHARTS || new Map();
  const prev = window.__FP_CHARTS.get(key);
  if (prev?.destroy) {
    try { prev.destroy(); } catch {}
  }
  return key;
}

function buildPalette(n) {
  const base = [
    "rgba(34,230,195,.75)",
    "rgba(74,163,255,.75)",
    "rgba(255,140,0,.75)",
    "rgba(255,77,109,.75)",
    "rgba(41,211,154,.75)",
    "rgba(180,120,255,.75)",
    "rgba(255,210,77,.75)",
    "rgba(140,200,255,.75)",
  ];
  const out = [];
  for (let i = 0; i < n; i++) out.push(base[i % base.length]);
  return out;
}

function getQueryParam(name) {
  try { return new URL(location.href).searchParams.get(name); } catch { return null; }
}

function setQueryParamAndNavigate(name, value) {
  const u = new URL(location.href);
  if (value) u.searchParams.set(name, value);
  else u.searchParams.delete(name);
  if (typeof window.fpNavigate === "function") window.fpNavigate(u.toString(), { replace: true });
  else location.replace(u.toString());
}

async function initDashboardCosti() {
  if (!isDashboardCostiPage()) return;
  const role = String((window.FP_USER?.role || window.FP_SESSION?.role || "")).trim();
  if (role !== "manager") return;

  const meseSel = document.querySelector("[data-costi-mese]");
  const refreshBtn = document.querySelector("[data-costi-refresh]");
  const loadingEl = document.querySelector("[data-costi-loading]");
  const errorEl = document.querySelector("[data-costi-error]");
  const totalEl = document.querySelector("[data-costi-totale]");
  const tbody = document.querySelector("[data-costi-tbody]");
  const barCanvas = document.querySelector("[data-costi-bar]");
  const pieCanvas = document.querySelector("[data-costi-pie]");
  if (!tbody || !barCanvas || !pieCanvas) return;

  const months = ["", "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
  if (meseSel && !meseSel.dataset.fpInited) {
    meseSel.dataset.fpInited = "1";
    meseSel.innerHTML = months
      .map((m) => `<option value="${String(m).replaceAll('"', "&quot;")}">${m ? m : "Tutti i mesi"}</option>`)
      .join("");
    const qMese = String(getQueryParam("mese") || "");
    meseSel.value = months.includes(qMese) ? qMese : "";
    meseSel.addEventListener("change", () => setQueryParamAndNavigate("mese", meseSel.value));
  }
  refreshBtn && !refreshBtn.dataset.fpInited && (refreshBtn.dataset.fpInited = "1") && refreshBtn.addEventListener("click", () => {
    // reload same route (keeps current query)
    if (typeof window.fpNavigate === "function") window.fpNavigate(location.href, { replace: true });
    else location.reload();
  });

  const show = (el, msg) => { if (!el) return; el.style.display = "block"; if (msg !== undefined) el.textContent = String(msg || ""); };
  const hide = (el) => { if (!el) return; el.style.display = "none"; };

  hide(errorEl);
  show(loadingEl, "Caricamento…");

  try {
    await ensureChartJs();

    const mese = String(getQueryParam("mese") || "").trim();
    const clinica = String(getQueryParam("clinica") || "").trim();
    const qs = new URLSearchParams();
    if (mese) qs.set("mese", mese);
    if (clinica) qs.set("clinica", clinica);

    const data = await api("/api/costi-per-categoria" + (qs.toString() ? `?${qs.toString()}` : ""));
    const rows = Array.isArray(data) ? data : [];

    const total = rows.reduce((s, r) => s + Number(r?.totale || 0), 0);
    if (totalEl) totalEl.textContent = fmtEuro(total);

    // Table
    tbody.innerHTML = "";
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="muted">Nessun dato disponibile.</td></tr>`;
    } else {
      for (const r of rows) {
        const tot = Number(r?.totale || 0);
        const pct = total > 0 ? (tot / total) * 100 : 0;
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span class="rowlink">${String(r?.categoria || "—")}</span></td>
          <td style="text-align:right;">${fmtEuro(tot)}</td>
          <td style="text-align:right;">${fmtPct(pct)}</td>
        `;
        tbody.appendChild(tr);
      }
    }

    // Charts
    const labels = rows.map((r) => String(r?.categoria || "—"));
    const values = rows.map((r) => Number(r?.totale || 0));
    const colors = buildPalette(values.length);

    window.__FP_CHARTS = window.__FP_CHARTS || new Map();

    const barKey = destroyChartFor(barCanvas);
    barCanvas.setAttribute("data-chart-key", barKey);
    window.__FP_CHARTS.set(
      barKey,
      new window.Chart(barCanvas.getContext("2d"), {
        type: "bar",
        data: {
          labels,
          datasets: [{ label: "Totale €", data: values, backgroundColor: colors, borderWidth: 0 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: getComputedStyle(document.body).getPropertyValue("--muted") || undefined } },
            y: { ticks: { color: getComputedStyle(document.body).getPropertyValue("--muted") || undefined } },
          },
        },
      }),
    );

    const pieKey = destroyChartFor(pieCanvas);
    pieCanvas.setAttribute("data-chart-key", pieKey);
    window.__FP_CHARTS.set(
      pieKey,
      new window.Chart(pieCanvas.getContext("2d"), {
        type: "pie",
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { color: getComputedStyle(document.body).getPropertyValue("--muted") || undefined } },
          },
        },
      }),
    );
  } catch (e) {
    console.error(e);
    show(errorEl, e?.message || "Errore");
  } finally {
    hide(loadingEl);
  }
}

async function initDashboardControllo() {
  if (!isDashboardControlloPage()) return;
  const role = String((window.FP_USER?.role || window.FP_SESSION?.role || "")).trim();
  if (role !== "manager") return;

  const refreshBtn = document.querySelector("[data-ctrl-refresh]");
  const loadingEl = document.querySelector("[data-ctrl-loading]");
  const errorEl = document.querySelector("[data-ctrl-error]");
  const tbody = document.querySelector("[data-ctrl-tbody]");
  const lineCanvas = document.querySelector("[data-ctrl-line]");
  if (!tbody || !lineCanvas) return;

  refreshBtn && !refreshBtn.dataset.fpInited && (refreshBtn.dataset.fpInited = "1") && refreshBtn.addEventListener("click", () => {
    if (typeof window.fpNavigate === "function") window.fpNavigate(location.href, { replace: true });
    else location.reload();
  });

  const show = (el, msg) => { if (!el) return; el.style.display = "block"; if (msg !== undefined) el.textContent = String(msg || ""); };
  const hide = (el) => { if (!el) return; el.style.display = "none"; };

  hide(errorEl);
  show(loadingEl, "Caricamento…");

  try {
    await ensureChartJs();

    const clinica = String(getQueryParam("clinica") || "").trim();
    const qs = new URLSearchParams();
    if (clinica) qs.set("clinica", clinica);

    const data = await api("/api/riepilogo-mensile" + (qs.toString() ? `?${qs.toString()}` : ""));
    const rows = Array.isArray(data) ? data : [];

    tbody.innerHTML = "";
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">Nessun dato disponibile.</td></tr>`;
    } else {
      for (const r of rows) {
        const mese = String(r?.Mese || "—");
        const budget = Number(r?.["Totale Mensile"] || 0);
        const reale = Number(r?.["Totale Reale"] || 0);
        const scost = Number(r?.Scostamento || 0);
        const tr = document.createElement("tr");
        if (scost > 0) tr.classList.add("fpRowBad");
        tr.innerHTML = `
          <td><span class="rowlink">${mese}</span></td>
          <td style="text-align:right;">${fmtEuro(budget)}</td>
          <td style="text-align:right;">${fmtEuro(reale)}</td>
          <td style="text-align:right;">${fmtEuro(scost)}</td>
        `;
        tbody.appendChild(tr);
      }
    }

    const labels = rows.map((r) => String(r?.Mese || "—"));
    const budgets = rows.map((r) => Number(r?.["Totale Mensile"] || 0));
    const reals = rows.map((r) => Number(r?.["Totale Reale"] || 0));

    window.__FP_CHARTS = window.__FP_CHARTS || new Map();
    const key = destroyChartFor(lineCanvas);
    lineCanvas.setAttribute("data-chart-key", key);
    window.__FP_CHARTS.set(
      key,
      new window.Chart(lineCanvas.getContext("2d"), {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "Budget", data: budgets, borderColor: "rgba(74,163,255,.95)", backgroundColor: "rgba(74,163,255,.18)", tension: 0.25 },
            { label: "Reale", data: reals, borderColor: "rgba(34,230,195,.95)", backgroundColor: "rgba(34,230,195,.18)", tension: 0.25 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { color: getComputedStyle(document.body).getPropertyValue("--muted") || undefined } },
          },
          scales: {
            x: { ticks: { color: getComputedStyle(document.body).getPropertyValue("--muted") || undefined } },
            y: { ticks: { color: getComputedStyle(document.body).getPropertyValue("--muted") || undefined } },
          },
        },
      }),
    );
  } catch (e) {
    console.error(e);
    show(errorEl, e?.message || "Errore");
  } finally {
    hide(loadingEl);
  }
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
    tr.onclick = () => {
      const href = `paziente.html?id=${encodeURIComponent(p.id)}`;
      if (typeof window.fpNavigate === "function") window.fpNavigate(href);
      else location.href = href;
    };

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
      // Keep initial load fast: cap records returned, especially with empty query.
      const maxRecords = q ? 50 : 30;
      const pageSize = maxRecords;
      const data = await api(
        `/api/airtable?op=searchPatientsFull&maxRecords=${maxRecords}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`
      );
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
  card.querySelector("[data-hc-title]").textContent = appt.patient_name || "";
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
        <div class="oe-modal__top">
          <div class="oe-modal__topActions">
            <button class="oe-chipbtn oe-chipbtn--accent" type="button" data-action-repeat>RIPETI</button>
            <button class="oe-chipbtn" type="button" data-action-notify>NOTIFICHE</button>
            <button class="oe-chipbtn oe-chipbtn--danger" type="button" data-action-delete>ELIMINA</button>
          </div>
          <div class="oe-modal__created" data-created></div>
        </div>

        <div class="oe-modal__patientCenter">
          <div class="oe-modal__patientnameRow">
            <div class="oe-modal__patientname" data-pname></div>
            <div class="oe-badge" data-ptag style="display:none"></div>
          </div>
          <div class="oe-modal__patientActions">
            <a class="oe-chipbtn" data-call href="#" aria-disabled="true">CHIAMA</a>
            <a class="oe-chipbtn oe-chipbtn--wa" data-wa href="#" aria-disabled="true">WhatsApp</a>
            <a class="oe-chipbtn" data-email href="#" aria-disabled="true">EMAIL</a>
            <a class="oe-modal__patientlink" data-plink href="#">Apri scheda paziente</a>
          </div>
        </div>

        <div class="oe-modal__section">
          <div class="oe-modal__dt" data-datetime-label></div>
        </div>

        <div class="oe-grid oe-grid--2">
          <label class="oe-field oe-field--wide">
            <span>Stato appuntamento</span>
            <div class="fp-statuspick" data-statuspick>
              <button type="button" class="fp-statuspick__btn" data-status-btn></button>
              <div class="fp-statuspick__menu" data-status-menu style="display:none">
                <input class="fp-statuspick__search" data-status-search placeholder="Cerca un'opzione" />
                <div class="fp-statuspick__list" data-status-list></div>
              </div>
              <select data-f-status style="display:none"></select>
            </div>
          </label>
        </div>

        <div class="oe-grid oe-grid--3">
          <label class="oe-field">
            <span>Voce prezzario</span>
            <select data-f-service></select>
          </label>
          <label class="oe-field">
            <span>Durata (min)</span>
            <input type="number" min="30" max="120" step="30" inputmode="numeric" data-f-duration />
          </label>
          <label class="oe-field">
            <span>Agenda</span>
            <select data-f-operator></select>
          </label>
        </div>

        <div class="oe-modal__checks">
          <label class="oe-check"><input type="checkbox" data-f-home /> <span>Trattamento domiciliare</span></label>
          <label class="oe-check oe-check--readonly"><input type="checkbox" data-f-confirm-patient disabled /> <span>Confermato dal paziente</span></label>
        </div>

        <div class="oe-grid oe-grid--2">
          <label class="oe-field oe-field--wide">
            <span>Note interne</span>
            <textarea data-f-quick maxlength="255"></textarea>
            <div class="oe-counter"><span data-count-internal>0</span> / 255</div>
          </label>
          <label class="oe-field oe-field--wide">
            <span>Note visibili al paziente</span>
            <textarea data-f-notes maxlength="255"></textarea>
            <div class="oe-counter"><span data-count-patient>0</span> / 255</div>
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

function clampDurationMinutes(v) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return 60;
  const clamped = Math.max(30, Math.min(120, Math.round(n / 30) * 30));
  return clamped;
}

function statusTone(statusRaw) {
  const s = String(statusRaw || "").trim().toLowerCase();
  if (!s) return "muted";
  if (s.includes("programm")) return "yellow";
  if (s.includes("eseg")) return "green";
  if (s.includes("no-show") || s.includes("no show")) return "red";
  if (s.includes("annull")) return "blue";
  return "muted";
}

function renderStatusPicker(modal) {
  const root = modal.querySelector("[data-statuspick]");
  const sel = modal.querySelector("[data-f-status]");
  if (!root || !sel) return;

  const btn = root.querySelector("[data-status-btn]");
  const menu = root.querySelector("[data-status-menu]");
  const list = root.querySelector("[data-status-list]");
  const search = root.querySelector("[data-status-search]");

  const options = Array.from(sel.options || [])
    .filter((o) => String(o.value || "").trim() !== "")
    .map((o) => ({ value: String(o.value || ""), label: String(o.textContent || o.value || "") }));

  const closeMenu = () => { if (menu) menu.style.display = "none"; };
  const openMenu = () => { if (menu) menu.style.display = "block"; if (search) search.focus(); };
  const toggleMenu = () => (menu && menu.style.display === "block" ? closeMenu() : openMenu());

  const setValue = (v) => {
    sel.value = String(v || "");
    const label = options.find((x) => x.value === sel.value)?.label || sel.value || "—";
    const tone = statusTone(sel.value);
    if (btn) {
      btn.innerHTML = `<span class="fp-pill fp-pill--${tone}">${label}</span>`;
    }
  };

  const renderList = () => {
    if (!list) return;
    const q = String(search?.value || "").trim().toLowerCase();
    const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    list.innerHTML = "";

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "fp-statuspick__empty";
      empty.textContent = "Nessun risultato";
      list.appendChild(empty);
      return;
    }

    for (const o of filtered) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fp-statuspick__item";
      const tone = statusTone(o.value);
      b.innerHTML = `<span class="fp-pill fp-pill--${tone}">${o.label}</span>`;
      b.onclick = () => {
        setValue(o.value);
        closeMenu();
      };
      list.appendChild(b);
    }
  };

  if (btn) btn.onclick = (e) => { e.preventDefault(); toggleMenu(); };
  if (search) search.oninput = renderList;

  // Close when clicking outside
  modal.addEventListener("click", (e) => {
    if (!menu || menu.style.display !== "block") return;
    if (root.contains(e.target)) return;
    closeMenu();
  });

  // Initial
  if (!btn.textContent.trim()) setValue(sel.value || "");
  renderList();

  // Expose updater for callers
  root.__fpSetStatusValue = setValue;
}

async function fpConfirmDialog({ title = "Conferma", message = "", confirmText = "Conferma", cancelText = "Annulla", danger = false } = {}) {
  return await new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "oe-modal__backdrop fp-confirm__backdrop";
    back.innerHTML = `
      <div class="oe-modal fp-confirm__modal" role="dialog" aria-modal="true">
        <div class="oe-modal__header">
          <div class="oe-modal__title">${String(title || "Conferma")}</div>
          <button class="oe-modal__x" data-x aria-label="Chiudi">×</button>
        </div>
        <div class="oe-modal__body">
          <div class="fp-confirm__msg">${String(message || "")}</div>
        </div>
        <div class="oe-modal__footer">
          <button class="oe-btn" data-cancel>${String(cancelText || "Annulla")}</button>
          <button class="oe-btn ${danger ? "oe-btn--danger" : "oe-btn--primary"}" data-ok>${String(confirmText || "Conferma")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);

    const close = (val) => {
      try { back.remove(); } catch {}
      resolve(Boolean(val));
    };

    back.querySelector("[data-x]")?.addEventListener("click", () => close(false));
    back.querySelector("[data-cancel]")?.addEventListener("click", () => close(false));
    back.querySelector("[data-ok]")?.addEventListener("click", () => close(true));
    back.addEventListener("click", (e) => { if (e.target === back) close(false); });
  });
}

function setSelectOptions(selectEl, items, { placeholder = "—", allowEmpty = true } = {}) {
  if (!selectEl) return;
  const prev = selectEl.value;
  selectEl.innerHTML = "";
  if (allowEmpty) {
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholder;
    selectEl.appendChild(opt0);
  }
  (items || []).forEach((it) => {
    const opt = document.createElement("option");
    opt.value = it.id;
    opt.textContent = it.name || it.label || it.id;
    selectEl.appendChild(opt);
  });
  if (prev) selectEl.value = prev;
}

function ensureSelectHasValue(selectEl, value, label = null) {
  if (!selectEl) return;
  const v = String(value || "");
  if (!v) return;
  const exists = Array.from(selectEl.options || []).some((o) => String(o.value) === v);
  if (exists) return;
  const opt = document.createElement("option");
  opt.value = v;
  opt.textContent = label || v;
  selectEl.appendChild(opt);
}

function setMultiSelectValues(selectEl, values) {
  const want = new Set((values || []).map((x) => String(x)));
  Array.from(selectEl?.options || []).forEach((opt) => {
    opt.selected = want.has(String(opt.value));
  });
}

function getMultiSelectValues(selectEl) {
  return Array.from(selectEl?.selectedOptions || []).map((o) => String(o.value)).filter(Boolean);
}

function parseCommaList(s) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function ensureModalStaticOptions(modal) {
  if (modal.__staticOptsLoaded) return;
  modal.__staticOptsLoaded = true;

  const serviceSel = modal.querySelector("[data-f-service]");
  const operatorSel = modal.querySelector("[data-f-operator]");
  const treatmentsSel = modal.querySelector("[data-f-treatments]");
  const statusSel = modal.querySelector("[data-f-status]");

  try {
    const [ops, serv, tr] = await Promise.all([
      api("/api/operators"),
      api("/api/services"),
      treatmentsSel ? api("/api/treatments?activeOnly=1") : Promise.resolve({ items: [] }),
    ]);
    setSelectOptions(operatorSel, ops.items || [], { placeholder: "—" });
    setSelectOptions(serviceSel, serv.items || [], { placeholder: "—" });
    // Status is a single-select in Airtable: load choices (Meta API) or inferred values.
    try {
      const st = await api("/api/appointment-field-options?field=Stato appuntamento");
      setSelectOptions(statusSel, (st.items || []).map((x) => ({ id: x.id, name: x.name })), { placeholder: "—", allowEmpty: true });
    } catch (e) {
      console.warn("Status options not available", e);
      setSelectOptions(statusSel, [], { placeholder: "—" });
    }
    renderStatusPicker(modal);

    if (treatmentsSel) {
      treatmentsSel.innerHTML = "";
      (tr.items || []).forEach((it) => {
        const opt = document.createElement("option");
        opt.value = it.id;
        opt.textContent = it.name || it.id;
        treatmentsSel.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn("Modal static options not available", e);
    setSelectOptions(operatorSel, [], { placeholder: "(non disponibile)" });
    setSelectOptions(serviceSel, [], { placeholder: "(non disponibile)" });
    setSelectOptions(statusSel, [], { placeholder: "(non disponibile)" });
    renderStatusPicker(modal);
    if (treatmentsSel) {
      treatmentsSel.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(non disponibile)";
      treatmentsSel.appendChild(opt);
      treatmentsSel.disabled = true;
    }
  }
}

async function loadModalPatientOptions(modal, patientId) {
  const caseSel = modal.querySelector("[data-f-case]");
  const saleSel = modal.querySelector("[data-f-sale]");
  const evalSel = modal.querySelector("[data-f-evals]");
  const erogatoSel = modal.querySelector("[data-f-erogato]");

  // This modal variant doesn't render these advanced fields.
  if (!caseSel && !saleSel && !evalSel && !erogatoSel) return;

  setSelectOptions(caseSel, [], { placeholder: "—" });
  setSelectOptions(saleSel, [], { placeholder: "—" });
  setSelectOptions(erogatoSel, [], { placeholder: "—" });
  if (evalSel) evalSel.innerHTML = "";
  if (!patientId) return;

  try {
    const [cases, sales, evals, erogato] = await Promise.all([
      api(`/api/cases?patientId=${encodeURIComponent(patientId)}`),
      api(`/api/sales?patientId=${encodeURIComponent(patientId)}`),
      api(`/api/evaluations?patientId=${encodeURIComponent(patientId)}&maxRecords=50`),
      api(`/api/erogato?patientId=${encodeURIComponent(patientId)}&maxRecords=100`),
    ]);

    setSelectOptions(
      caseSel,
      (cases.items || []).map((x) => ({ id: x.id, name: [x.data, x.titolo].filter(Boolean).join(" • ") || x.id })),
      { placeholder: "—" },
    );
    setSelectOptions(
      saleSel,
      (sales.items || []).map((x) => ({ id: x.id, name: [x.data, x.voce].filter(Boolean).join(" • ") || x.id })),
      { placeholder: "—" },
    );
    setSelectOptions(
      erogatoSel,
      (erogato.items || []).map((x) => ({ id: x.id, name: [x.data, x.prestazione].filter(Boolean).join(" • ") || x.id })),
      { placeholder: "—" },
    );

    if (evalSel) {
      evalSel.innerHTML = "";
      (evals.items || []).forEach((x) => {
        const opt = document.createElement("option");
        opt.value = x.id;
        opt.textContent = [x.data, x.tipo].filter(Boolean).join(" • ") || x.id;
        evalSel.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn("Modal patient options not available", e);
    setSelectOptions(caseSel, [], { placeholder: "(non disponibile)" });
    setSelectOptions(saleSel, [], { placeholder: "(non disponibile)" });
    setSelectOptions(erogatoSel, [], { placeholder: "(non disponibile)" });
    if (evalSel) {
      evalSel.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(non disponibile)";
      evalSel.appendChild(opt);
      evalSel.disabled = true;
    }
  }
}

async function openModal(modal, appt, onSaved) {
  modal.__current = appt;

  modal.querySelector("[data-pname]").textContent = appt.patient_name || "";
  modal.querySelector("[data-plink]").href = `/pages/paziente.html?id=${encodeURIComponent(appt.patient_id || "")}`;

  await ensureModalStaticOptions(modal);
  // Older advanced selects are still loaded (cases/erogato/etc) only if present in DOM.
  await loadModalPatientOptions(modal, appt.patient_id || "");

  // Header meta
  const createdEl = modal.querySelector("[data-created]");
  if (createdEl) {
    const ct = appt.created_at || "";
    if (ct) {
      const d = new Date(ct);
      createdEl.textContent = isNaN(d.getTime()) ? "" : `Creato il ${d.toLocaleString("it-IT")}`;
    } else {
      createdEl.textContent = "";
    }
  }

  const dtLabel = modal.querySelector("[data-datetime-label]");
  if (dtLabel) {
    const d = new Date(appt.start_at || "");
    dtLabel.textContent = isNaN(d.getTime())
      ? ""
      : d.toLocaleString("it-IT", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  // Tag pill (use appointment_type if available)
  const tagEl = modal.querySelector("[data-ptag]");
  if (tagEl) {
    const tag = String(appt.appointment_type || "").trim();
    if (tag) { tagEl.textContent = tag; tagEl.style.display = ""; }
    else { tagEl.textContent = ""; tagEl.style.display = "none"; }
  }

  // Patient contacts
  const callA = modal.querySelector("[data-call]");
  const waA = modal.querySelector("[data-wa]");
  const emailA = modal.querySelector("[data-email]");
  const setLink = (a, href, text) => {
    if (!a) return;
    a.textContent = text || a.textContent;
    a.href = href || "#";
    if (href) a.removeAttribute("aria-disabled");
    else a.setAttribute("aria-disabled", "true");
  };
  setLink(callA, "", "CHIAMA");
  setLink(waA, "", "WhatsApp");
  setLink(emailA, "", "EMAIL");
  if (appt.patient_id) {
    try {
      const p = await api(`/api/patient?id=${encodeURIComponent(appt.patient_id)}`);
      const telRaw = String(p.Telefono || "").trim();
      const tel = telRaw.replace(/[^\d+]/g, "");
      const telHref = tel ? `tel:${tel}` : "";
      let waHref = tel ? `https://wa.me/${tel.replace(/^\+/, "")}` : "";
      const email = String(p.Email || "").trim();
      const emailHref = email ? `mailto:${email}` : "";
      setLink(callA, telHref, "CHIAMA");
      // Build WhatsApp reminder message with confirmation link (best-effort).
      try {
        const linkData = await api(`/api/patient-confirm-link?id=${encodeURIComponent(appt.id)}`);
        const msg = String(linkData?.message || "").trim();
        if (msg && tel) {
          waHref = `https://wa.me/${tel.replace(/^\+/, "")}?text=${encodeURIComponent(msg)}`;
        }
      } catch {}
      setLink(waA, waHref, telRaw ? `${telRaw} WhatsApp` : "WhatsApp");
      setLink(emailA, emailHref, email || "EMAIL");
    } catch (e) {
      console.warn("Patient contact not available", e);
    }
  }

  const servSel = modal.querySelector("[data-f-service]");
  const opSel = modal.querySelector("[data-f-operator]");
  ensureSelectHasValue(servSel, appt.service_id, appt.service_name || appt.service_id);
  ensureSelectHasValue(opSel, appt.therapist_id, appt.therapist_name || appt.therapist_id);
  if (servSel) servSel.value = appt.service_id || "";
  if (opSel) opSel.value = appt.therapist_id || "";

  const statusSel = modal.querySelector("[data-f-status]");
  ensureSelectHasValue(statusSel, appt.status, appt.status);
  if (statusSel) statusSel.value = appt.status || "";
  modal.querySelector("[data-statuspick]")?.__fpSetStatusValue?.(appt.status || "");

  const durEl = modal.querySelector("[data-f-duration]");
  if (durEl) {
    const raw =
      (appt.duration !== undefined && appt.duration !== null && String(appt.duration).trim() !== "")
        ? appt.duration
        : (String(appt.duration_label || "").replace(/[^\d]/g, "") || "");
    durEl.value = String(clampDurationMinutes(raw));
  }

  modal.querySelector("[data-f-quick]").value = appt.quick_note || appt.internal_note || "";
  modal.querySelector("[data-f-notes]").value = appt.notes || appt.patient_note || "";

  const chkPatient = modal.querySelector("[data-f-confirm-patient]");
  if (chkPatient) chkPatient.checked = Boolean(appt.confirmed_by_patient);
  const chkHome = modal.querySelector("[data-f-home]");
  if (chkHome) chkHome.checked = Boolean(appt.domiciliare);

  const updateCounters = () => {
    const internal = modal.querySelector("[data-f-quick]");
    const patient = modal.querySelector("[data-f-notes]");
    const ci = modal.querySelector("[data-count-internal]");
    const cp = modal.querySelector("[data-count-patient]");
    if (ci && internal) ci.textContent = String((internal.value || "").length);
    if (cp && patient) cp.textContent = String((patient.value || "").length);
  };
  const internalEl = modal.querySelector("[data-f-quick]");
  const patientEl = modal.querySelector("[data-f-notes]");
  if (internalEl) internalEl.oninput = updateCounters;
  if (patientEl) patientEl.oninput = updateCounters;
  updateCounters();

  const close = () => { modal.style.display = "none"; };
  modal.querySelector("[data-close]").onclick = close;
  modal.querySelector("[data-cancel]").onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };

  // Header actions (currently placeholders except delete/location)
  const delBtn = modal.querySelector("[data-action-delete]");
  if (delBtn) delBtn.onclick = async () => {
    const a = modal.__current;
    if (!a) return;
    const ok = await fpConfirmDialog({
      title: "Eliminare appuntamento?",
      message: `Vuoi eliminare l'appuntamento di <b>${String(a.patient_name || "Paziente")}</b>?<br/><br/>Questa operazione non si può annullare.`,
      confirmText: "Elimina",
      cancelText: "Annulla",
      danger: true,
    });
    if (!ok) return;
    try {
      delBtn.disabled = true;
      await api(`/api/appointments?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
      toast("Eliminato");
      close();
      if (typeof onSaved === "function") onSaved({ ...a, __deleted: true });
    } catch (e) {
      console.error(e);
      alert("Errore eliminazione. Riprova.");
    } finally {
      delBtn.disabled = false;
    }
  };

  modal.querySelector("[data-save]").onclick = async () => {
    const a = modal.__current;
    if (!a) return;

    const payload = {
      status: modal.querySelector("[data-f-status]")?.value || "",
      serviceId: modal.querySelector("[data-f-service]").value,
      collaboratoreId: modal.querySelector("[data-f-operator]").value,
      durata: String(clampDurationMinutes(modal.querySelector("[data-f-duration]").value)),
      domiciliare: Boolean(modal.querySelector("[data-f-home]")?.checked),
      notaRapida: modal.querySelector("[data-f-quick]").value,
      note: modal.querySelector("[data-f-notes]").value,
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
      const apptUpdated = updated.appointment || updated;
      if (typeof onSaved === "function") onSaved(apptUpdated);
    } catch (err) {
      console.error(err);
      alert("Errore salvataggio. Riprova.");
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
  if (rightBtn) rightBtn.onclick = () => document.body.classList.toggle("fp-right-expanded");
}

// =====================
// SPA NAV (persist menus, swap center only)
// =====================
function isSpaShell() {
  const app = document.querySelector(".app");
  if (!app) return false;
  return Boolean(app.querySelector(":scope > .sidebar") && app.querySelector(":scope > .main") && app.querySelector(":scope > .rightbar"));
}

function ensureGlobalTopbar() {
  if (!document.querySelector(".app")) return;

  // Create once and keep it persistent across SPA swaps, but refresh the text each route.
  let bar = document.querySelector(".fp-topbar");
  if (!bar) {
    bar = document.createElement("header");
    bar.className = "fp-topbar";
    document.body.insertBefore(bar, document.body.firstChild);
    bar.innerHTML = `
      <div class="fp-topbar__left">
        <button type="button" class="fp-iconbtn" data-toggle-left="1" aria-label="Apri/chiudi menu sinistro">
          <span class="ic">☰</span>
        </button>
        <div class="fp-topbar__brand">
          <div class="fp-topbar__title" data-fp-top-title></div>
          <div class="fp-topbar__sub" data-fp-top-sub></div>
        </div>
      </div>
      <div class="fp-topbar__right">
        <button type="button" class="fp-iconbtn" data-toggle-right="1" aria-label="Apri/chiudi menu destro">
          <span class="ic">≡</span>
        </button>
      </div>
    `;
  }

  // Pull label from left brand if available.
  const brandTitle = String(document.querySelector(".sidebar .brand .title")?.textContent || "").trim();
  const brandSub = String(document.querySelector(".sidebar .brand .sub")?.textContent || "").trim();

  const tEl = bar.querySelector("[data-fp-top-title]");
  const sEl = bar.querySelector("[data-fp-top-sub]");
  if (tEl) tEl.textContent = "FISIOPRO";
  if (sEl) sEl.textContent = brandSub || "";

  document.body.classList.add("fp-has-topbar");
  window.__FP_GLOBAL_TOPBAR_READY = true;
}

function ensureTopbarToggles() {
  // Kept for backwards compatibility; toggles now live in the global .fp-topbar.
  // No-op to avoid duplicated buttons inside the page topbar.
}

function shouldSpaHandleUrl(url) {
  try {
    const u = url instanceof URL ? url : new URL(String(url), location.href);
    if (u.origin !== location.origin) return false;
    if (!u.pathname.startsWith("/pages/")) return false;
    if (!u.pathname.endsWith(".html")) return false;
    // Logout/login should remain a full navigation (session handling).
    if (u.pathname.endsWith("/pages/login.html")) return false;
    if (u.pathname.endsWith("/pages/index.html")) return false;
    return true;
  } catch {
    return false;
  }
}

function parseOnclickLocationHref(onclickRaw) {
  const s = String(onclickRaw || "");
  const m = s.match(/location\.href\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : "";
}

async function loadHtml(url) {
  const u = url instanceof URL ? url : new URL(String(url), location.href);
  const res = await fetch(u.pathname + u.search, { credentials: "include" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text;
}

function extractPageParts(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const app = doc.querySelector(".app");
  const main = app?.querySelector(":scope > .main") || doc.querySelector("main.main") || doc.querySelector("main");
  const rightbar = app?.querySelector(":scope > .rightbar") || doc.querySelector("aside.rightbar");
  const title = String(doc.querySelector("title")?.textContent || "").trim();
  const inlineStyles = Array.from(doc.querySelectorAll("head style"))
    .map((s) => String(s.textContent || ""))
    .join("\n");
  const hasDiary = Boolean(app?.hasAttribute("data-diary"));
  const hasPatientPage = Boolean(doc.querySelector("main[data-patient-page], .main[data-patient-page]"));
  const overlays = Array.from(doc.body?.children || [])
    .filter((el) => el && el.nodeType === 1)
    .filter((el) => !el.classList.contains("app"))
    .filter((el) => el.tagName !== "SCRIPT")
    .filter((el) => !el.classList.contains("toast"))
    .map((el) => el.outerHTML)
    .join("\n");
  return { title, main, rightbar, inlineStyles, hasDiary, hasPatientPage, overlays };
}

function applyRouteStyles(cssText) {
  const id = "fp-route-style";
  const prev = document.getElementById(id);
  if (prev) prev.remove();
  const css = String(cssText || "").trim();
  if (!css) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

function bootstrapRouteStyleControl() {
  // Move existing inline <style> tags into our managed container.
  const styles = Array.from(document.querySelectorAll("head style"));
  if (!styles.length) return;
  const css = styles.map((s) => String(s.textContent || "")).join("\n");
  styles.forEach((s) => s.remove());
  applyRouteStyles(css);
}

function ensureOverlayHost() {
  let host = document.getElementById("fp-route-overlays");
  if (host) return host;
  host = document.createElement("div");
  host.id = "fp-route-overlays";
  document.body.appendChild(host);
  return host;
}

function bootstrapOverlayControl() {
  const host = ensureOverlayHost();
  const nodes = Array.from(document.body.children || [])
    .filter((el) => el && el.nodeType === 1)
    .filter((el) => el.id !== "fp-route-overlays")
    .filter((el) => !el.classList.contains("app"))
    .filter((el) => el.tagName !== "SCRIPT")
    .filter((el) => !el.classList.contains("toast"));

  if (!nodes.length) return;
  host.innerHTML = "";
  nodes.forEach((el) => host.appendChild(el));
}

function removeLegacyRightDrawer() {
  // Hard cleanup for older "white drawer" implementation.
  try { document.body.classList.remove("fp-right-open"); } catch {}
  try { document.body.classList.remove("fp-right-expanded"); } catch {}

  document.querySelectorAll(".fp-rightdetail-back, .fp-rightdetail").forEach((el) => el.remove());
  // It may have been captured inside the overlay host too.
  document.querySelectorAll("#fp-route-overlays .fp-rightdetail-back, #fp-route-overlays .fp-rightdetail").forEach((el) => el.remove());
}

async function ensureDiaryLoaded() {
  const p = location.pathname || "";
  if (!p.endsWith("/pages/agenda.html") && !p.endsWith("/agenda.html")) return;
  const hasDiaryRoot = Boolean(document.querySelector("[data-diary]"));
  const hasGrid = Boolean(document.querySelector("[data-cal-grid]"));
  if (!hasDiaryRoot && !hasGrid) return;

  if (typeof window.fpDiaryInit === "function") {
    window.fpDiaryInit();
    return;
  }

  // If the page already includes diary.js via a <script> tag (classic load),
  // let it execute normally (it auto-inits).
  if (document.querySelector('script[src*="diary.js"]')) return;

  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    // Cache-bust diary.js to ensure UI updates propagate quickly.
    s.src = "/assets/diary.js?v=fpui-20260115g";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("diary_load_failed"));
    document.head.appendChild(s);
  });

  if (typeof window.fpDiaryInit === "function") window.fpDiaryInit();
}

async function runRouteInits() {
  // Ensure global bar exists before wiring sidebar toggles.
  ensureGlobalTopbar();
  removeInnerMenuIcons();
  removeLegacyRightDrawer();
  normalizeRightbar();
  ensureSettingsModals();
  initSidebars();
  ensureUnifiedSidebarMenu(String((window.FP_USER?.role || window.FP_SESSION?.role || "")).trim());
  ensureControlloGestioneMenu();
  activeNav();
  initLogoutLinks();

  const role = String((window.FP_USER?.role || window.FP_SESSION?.role || "")).trim();
  if (role) roleGuard(role);

  // Notify agenda layout to re-measure after shell updates.
  if (isAgendaNow()) {
    try { window.dispatchEvent(new CustomEvent("fpAgendaLayoutReady")); } catch {}
  }

  // Non-blocking: keep navigation/UI responsive, update later.
  updateInboxBadge().catch(() => {});

  // Run ONLY the init relevant to the current page to avoid doing extra work
  // (many init() functions are async and would otherwise create a long await chain).
  const tasks = [];
  if (isNotesPage()) tasks.push(initNotesPage());
  if (isOperativoPage()) tasks.push(initOperativoPage());
  if (isSalesPage()) tasks.push(initSalesPage());
  if (isErogatoPage()) tasks.push(initErogatoPage());
  if (isInsurancePage()) tasks.push(initInsurancePage());
  if (isAnamnesiPage()) tasks.push(initAnamnesiPage());
  if (isAnagraficaPage()) tasks.push(initAnagrafica());
  if (isPatientPage()) tasks.push(initPatientPage());
  if (isAgendaPage()) tasks.push(initAgenda());
  if (isDashboardPage()) tasks.push(initDashboard());
  if (isDashboardCostiPage()) tasks.push(initDashboardCosti());
  if (isDashboardControlloPage()) tasks.push(initDashboardControllo());

  // Diary script is optional; load it without blocking the route init.
  if (isAgendaPage()) ensureDiaryLoaded().catch(() => {});

  await Promise.all(tasks.map((p) => Promise.resolve(p).catch(() => {})));
}

function removeInnerMenuIcons() {
  // Remove any previously injected toggle icons inside the page topbar (Agenda/Dashboard etc).
  const scope = document.querySelector(".main .topbar") || document;
  scope.querySelectorAll(".fp-iconbtn[data-toggle-left], .fp-iconbtn[data-toggle-right]").forEach((el) => el.remove());
  // Remove empty wrapper if it was created
  scope.querySelectorAll(".fp-toprow-left").forEach((wrap) => {
    if (!wrap.querySelector(".h1") && !wrap.textContent.trim()) wrap.remove();
    // If wrapper only contains .h1, unwrap it
    const h1 = wrap.querySelector(":scope > .h1");
    if (h1 && wrap.children.length === 1) {
      wrap.parentElement?.insertBefore(h1, wrap);
      wrap.remove();
    }
  });
}

// (Right drawer removed) - rightbar itself expands/collapses.

function ensureSettingsModals() {
  // Availability
  if (!document.querySelector("[data-fp-av-back]")) {
    const back = document.createElement("div");
    back.className = "fp-set-back";
    back.setAttribute("data-fp-av-back", "1");
    back.innerHTML = `
      <div class="fp-set-panel" role="dialog" aria-modal="true">
        <div class="fp-set-head">
          <div class="fp-set-title"><span style="font-size:18px;">🕒</span> Configura la disponibilità</div>
          <button class="btn" type="button" data-fp-av-close>Chiudi</button>
        </div>
        <div class="fp-set-body">
          <div class="fp-av-top">
            <div style="font-weight:900;">Puoi selezionare più slot cliccando e trascinando la selezione</div>
          </div>
          <div class="fp-av-wrap" style="margin-top:12px;">
            <div class="fp-av-grid" data-fp-av-grid></div>
          </div>
        </div>
        <div class="fp-set-foot">
          <button class="btn" type="button" data-fp-av-reset>Reset</button>
          <button class="btn primary" type="button" data-fp-av-save>Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);
  }

  // Appointments
  if (!document.querySelector("[data-fp-appt-back]")) {
    const back = document.createElement("div");
    back.className = "fp-set-back";
    back.setAttribute("data-fp-appt-back", "1");
    back.innerHTML = `
      <div class="fp-set-panel" role="dialog" aria-modal="true">
        <div class="fp-set-head">
          <div class="fp-set-title"><span style="font-size:18px;">✅</span> Impostazioni Appuntamenti</div>
          <button class="btn" type="button" data-fp-appt-close>Chiudi</button>
        </div>
        <div class="fp-set-body">
          <div class="card" style="padding:14px;">
            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Proponi primo appuntamento a partire da</div>
                <div class="sub">Numero di giorni da oggi (default per proposta appuntamento).</div>
              </div>
              <div class="right">
                <input class="input" style="width:120px;" type="number" min="0" max="365" data-fp-appt-days />
                <div style="color:var(--muted);">giorni</div>
              </div>
            </div>

            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Sposta appuntamenti annullati in alto</div>
                <div class="sub">Mostra gli annullati come banda in alto.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="checkbox" data-fp-appt-cancelband /><span class="slider"></span></label>
              </div>
            </div>

            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Abilita modifica appuntamenti con trascinamento</div>
                <div class="sub">Consente drag&drop su agenda.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="checkbox" data-fp-appt-drag /><span class="slider"></span></label>
              </div>
            </div>

            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Considera gli appuntamenti associati da fatturare</div>
                <div class="sub">Flag utile per flussi amministrativi.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="checkbox" data-fp-appt-billing /><span class="slider"></span></label>
              </div>
            </div>

            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Mostra nome utente in fattura</div>
                <div class="sub">Usa il nome sotto come riferimento.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="checkbox" data-fp-appt-showname /><span class="slider"></span></label>
              </div>
            </div>

            <div class="fp-set-row" style="align-items:flex-start;">
              <div style="min-width:0;">
                <div class="lbl">Nome utente visualizzato</div>
                <div class="sub">Testo mostrato (max 150).</div>
              </div>
              <div class="right" style="flex-direction:column; align-items:flex-end;">
                <input class="input" style="width:min(520px, 78vw);" maxlength="150" data-fp-appt-name />
                <div style="font-size:12px; color:var(--muted);" data-fp-appt-name-count>0 / 150</div>
              </div>
            </div>

            <div class="fp-set-row" style="align-items:flex-start;">
              <div style="min-width:0;">
                <div class="lbl">Informazioni utente</div>
                <div class="sub">Note operative (opzionale).</div>
              </div>
              <div class="right" style="flex-direction:column; align-items:flex-end;">
                <textarea class="textarea" style="width:min(520px, 78vw); min-height: 90px;" maxlength="150" data-fp-appt-info></textarea>
                <div style="font-size:12px; color:var(--muted);" data-fp-appt-info-count>0 / 150</div>
              </div>
            </div>
          </div>
        </div>
        <div class="fp-set-foot">
          <button class="btn" type="button" data-fp-appt-reset>Reset</button>
          <button class="btn primary" type="button" data-fp-appt-save>Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);
  }

  // Theme
  if (!document.querySelector("[data-fp-theme-back]")) {
    const back = document.createElement("div");
    back.className = "fp-set-back";
    back.setAttribute("data-fp-theme-back", "1");
    back.innerHTML = `
      <div class="fp-set-panel" role="dialog" aria-modal="true" style="width:760px;">
        <div class="fp-set-head">
          <div class="fp-set-title"><span style="font-size:18px;">🎨</span> Tema</div>
          <button class="btn" type="button" data-fp-theme-close>Chiudi</button>
        </div>
        <div class="fp-set-body">
          <div class="card" style="padding:14px;">
            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Standard</div>
                <div class="sub">Tema attuale (baseline).</div>
              </div>
              <div class="right">
                <label class="switch"><input type="radio" name="fp_theme" value="standard" data-fp-theme-opt /><span class="slider"></span></label>
              </div>
            </div>
            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Pro (più leggibile)</div>
                <div class="sub">Superfici più chiare, contrasto migliore, bordi più definiti.</div>
              </div>
              <div class="right">
                <label class="switch"><input type="radio" name="fp_theme" value="pro" data-fp-theme-opt /><span class="slider"></span></label>
              </div>
            </div>
          </div>
        </div>
        <div class="fp-set-foot">
          <button class="btn primary" type="button" data-fp-theme-save>Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);
  }

  // Billing / Fatturazione
  if (!document.querySelector("[data-fp-billing-back]")) {
    const back = document.createElement("div");
    back.className = "fp-set-back";
    back.setAttribute("data-fp-billing-back", "1");
    back.innerHTML = `
      <div class="fp-set-panel" role="dialog" aria-modal="true" style="width:820px;">
        <div class="fp-set-head">
          <div class="fp-set-title"><span style="font-size:18px;">🧾</span> Impostazioni fatturazione</div>
          <button class="btn" type="button" data-fp-billing-close>Chiudi</button>
        </div>
        <div class="fp-set-body">
          <div class="card" style="padding:14px;">
            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">IVA predefinita (%)</div>
                <div class="sub">Valore inserito automaticamente nelle nuove righe prestazione.</div>
              </div>
              <div class="right">
                <input class="input" type="number" min="0" step="0.01" style="width:160px;" data-fp-billing-iva />
              </div>
            </div>
            <div class="fp-set-row">
              <div style="min-width:0;">
                <div class="lbl">Tipo documento predefinito</div>
                <div class="sub">Valore iniziale in “Step 3 — Conferma”.</div>
              </div>
              <div class="right">
                <select class="select" style="width:220px;" data-fp-billing-doctype>
                  <option value="fattura">Fattura</option>
                  <option value="ricevuta">Ricevuta</option>
                </select>
              </div>
            </div>
            <div class="fp-set-row" style="align-items:flex-start;">
              <div style="min-width:0;">
                <div class="lbl">Note predefinite (opzionale)</div>
                <div class="sub">Suggerimento per il campo Note nella creazione documento.</div>
              </div>
              <div class="right" style="flex-direction:column; align-items:flex-end;">
                <textarea class="textarea" style="width:min(520px, 78vw); min-height: 90px;" maxlength="240" data-fp-billing-note></textarea>
                <div style="font-size:12px; color:var(--muted);" data-fp-billing-note-count>0 / 240</div>
              </div>
            </div>
          </div>
        </div>
        <div class="fp-set-foot">
          <button class="btn" type="button" data-fp-billing-reset>Reset</button>
          <button class="btn primary" type="button" data-fp-billing-save>Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);
  }
}

function fpSettingsKey(suffix) {
  const email = String((window.FP_USER?.email || window.FP_SESSION?.email || "anon")).trim().toLowerCase() || "anon";
  return `fp_settings_${suffix}_${email}`;
}

function loadBillingSettings() {
  const key = fpSettingsKey("billing");
  let s = null;
  try { s = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
  const out = {
    defaultIvaPercent: 0,
    defaultDocType: "fattura",
    defaultNote: "",
    ...(s && typeof s === "object" ? s : {}),
  };
  const iva = Number(out.defaultIvaPercent);
  out.defaultIvaPercent = Number.isFinite(iva) ? iva : 0;
  out.defaultDocType = String(out.defaultDocType || "fattura") === "ricevuta" ? "ricevuta" : "fattura";
  out.defaultNote = String(out.defaultNote || "");
  return out;
}

// Public (used by pages like fatturazione.html)
window.fpGetBillingSettings = loadBillingSettings;

function openBillingModal() {
  ensureSettingsModals();
  const back = document.querySelector("[data-fp-billing-back]");
  if (!back) return;

  const s = loadBillingSettings();
  const iva = back.querySelector("[data-fp-billing-iva]");
  const doctype = back.querySelector("[data-fp-billing-doctype]");
  const note = back.querySelector("[data-fp-billing-note]");
  const noteCount = back.querySelector("[data-fp-billing-note-count]");
  const close = back.querySelector("[data-fp-billing-close]");
  const reset = back.querySelector("[data-fp-billing-reset]");
  const save = back.querySelector("[data-fp-billing-save]");

  const syncCount = () => {
    if (!note || !noteCount) return;
    const len = String(note.value || "").length;
    noteCount.textContent = `${len} / 240`;
  };

  if (iva) iva.value = String(s.defaultIvaPercent ?? 0);
  if (doctype) doctype.value = s.defaultDocType || "fattura";
  if (note) note.value = s.defaultNote || "";
  syncCount();
  if (note) note.oninput = syncCount;

  back.style.display = "block";
  close && (close.onclick = () => closeBillingModal());
  back.onclick = (e) => { if (e.target === back) closeBillingModal(); };

  reset && (reset.onclick = () => {
    localStorage.removeItem(fpSettingsKey("billing"));
    try { window.dispatchEvent(new CustomEvent("fpBillingSettingsChanged")); } catch {}
    closeBillingModal();
    toast("Reset");
  });

  save && (save.onclick = () => {
    const next = {
      defaultIvaPercent: Number(iva?.value || 0) || 0,
      defaultDocType: String(doctype?.value || "fattura") === "ricevuta" ? "ricevuta" : "fattura",
      defaultNote: String(note?.value || ""),
    };
    try { localStorage.setItem(fpSettingsKey("billing"), JSON.stringify(next)); } catch {}
    closeBillingModal();
    toast("Salvato");
    try { window.dispatchEvent(new CustomEvent("fpBillingSettingsChanged")); } catch {}
  });
}

function closeBillingModal() {
  const back = document.querySelector("[data-fp-billing-back]");
  if (back) back.style.display = "none";
}

function openAvailabilityModal() {
  ensureSettingsModals();
  const back = document.querySelector("[data-fp-av-back]");
  if (!back) return;
  buildAvailabilityUI();
  back.style.display = "block";
}
function closeAvailabilityModal() {
  const back = document.querySelector("[data-fp-av-back]");
  if (back) back.style.display = "none";
}

function openAppointmentsModal() {
  ensureSettingsModals();
  const back = document.querySelector("[data-fp-appt-back]");
  if (!back) return;
  loadAppointmentsSettings();
  back.style.display = "block";
}
function closeAppointmentsModal() {
  const back = document.querySelector("[data-fp-appt-back]");
  if (back) back.style.display = "none";
}

function openThemeModal() {
  ensureSettingsModals();
  const back = document.querySelector("[data-fp-theme-back]");
  if (!back) return;
  const current = loadTheme();
  back.querySelectorAll("[data-fp-theme-opt]").forEach((r) => {
    r.checked = String(r.value) === current;
  });
  back.style.display = "block";
  const panel = back.querySelector(".fp-set-panel");
  const close = back.querySelector("[data-fp-theme-close]");
  const save = back.querySelector("[data-fp-theme-save]");
  close && (close.onclick = () => closeThemeModal());
  back.onclick = (e) => { if (e.target === back) closeThemeModal(); };
  save && (save.onclick = () => {
    const sel = back.querySelector("[data-fp-theme-opt]:checked");
    const val = String(sel?.value || "standard");
    saveTheme(val);
    closeThemeModal();
    toast("Salvato");
  });
}
function closeThemeModal() {
  const back = document.querySelector("[data-fp-theme-back]");
  if (back) back.style.display = "none";
}

function buildAvailabilityUI() {
  const grid = document.querySelector("[data-fp-av-grid]");
  if (!grid) return;

  const days = ["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"];

  // 30-min slots 07:00-21:00 (last start: 20:30)
  const startMin = 7 * 60;
  const endMin = 21 * 60;
  const step = 30;
  const times = [];
  for (let m = startMin; m < endMin; m += step) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    // show label only on the hour to keep the grid compact/clean
    times.push(mm === "00" ? `${hh}:00` : "");
  }

  const stateKey = fpSettingsKey("availability");
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(stateKey) || "null"); } catch {}

  // ranges kept for backwards compatibility, but not shown in UI (user requested).
  const ranges = saved?.ranges || [];

  // Operators (collaborators) list for per-therapist availability.
  // Cache in window to avoid repeated API calls as user opens/closes the modal.
  window.__FP_AV_OPERATORS = window.__FP_AV_OPERATORS || null;
  window.__FP_AV_OPERATOR_ITEMS = window.__FP_AV_OPERATOR_ITEMS || null; // [{id,name}]
  window.__FP_AV_OPNAME_TO_ID = window.__FP_AV_OPNAME_TO_ID || null; // { [name]: id }
  window.__FP_AV_OPERATORS_LOADING = window.__FP_AV_OPERATORS_LOADING || false;
  const ensureOperators = async () => {
    if (Array.isArray(window.__FP_AV_OPERATORS)) return window.__FP_AV_OPERATORS;
    if (window.__FP_AV_OPERATORS_LOADING) return [];
    window.__FP_AV_OPERATORS_LOADING = true;
    try {
      const data = await api("/api/operators");
      const items = (data.items || [])
        .map((x) => ({ id: String(x.id || "").trim(), name: String(x.name || "").trim(), color: String(x.color || "").trim() }))
        .filter((x) => x.id && x.name);
      const names = items.map((x) => x.name);
      const map = {};
      const colorByName = {};
      items.forEach((x) => { map[x.name] = x.id; });
      items.forEach((x) => { if (x.color) colorByName[x.name] = x.color; });
      window.__FP_AV_OPERATOR_ITEMS = items;
      window.__FP_AV_OPNAME_TO_ID = map;
      window.__FP_AV_OPNAME_TO_COLOR = colorByName;
      window.__FP_AV_OPERATORS = names;
      return names;
    } catch {
      window.__FP_AV_OPERATORS = [];
      window.__FP_AV_OPERATOR_ITEMS = [];
      window.__FP_AV_OPNAME_TO_ID = {};
      window.__FP_AV_OPNAME_TO_COLOR = {};
      return [];
    } finally {
      window.__FP_AV_OPERATORS_LOADING = false;
    }
  };

  // slot state model (new):
  // - saved.byTherapist: { [therapistName|DEFAULT]: { [key:"d:r"]: {status:"work"|"off", locationId?:string} } }
  // Back-compat:
  // - saved.slots => treated as DEFAULT
  // - legacy saved.on => treated as DEFAULT work
  const slotsByTherapist = (() => {
    const s = saved && typeof saved === "object" ? saved : null;
    const by = s?.byTherapist && typeof s.byTherapist === "object" ? s.byTherapist : null;
    if (by) return JSON.parse(JSON.stringify(by));
    const out = { DEFAULT: {} };
    const slots = s?.slots && typeof s.slots === "object" ? s.slots : null;
    if (slots) {
      Object.keys(slots).forEach((k) => {
        const v = slots[k];
        if (!v || typeof v !== "object") return;
        const st = String(v.status || "").toLowerCase();
        if (st !== "work" && st !== "off") return;
        out.DEFAULT[String(k)] = { status: st, locationId: String(v.locationId || "") };
      });
    } else {
      const on = Array.isArray(s?.on) ? s.on : [];
      on.forEach((k) => { out.DEFAULT[String(k)] = { status: "work", locationId: "" }; });
    }
    return out;
  })();

  const last = (() => {
    const s = saved && typeof saved === "object" ? saved : null;
    const l = s?.last && typeof s.last === "object" ? s.last : null;
    const st = String(l?.status || "work").toLowerCase();
    return {
      status: st === "off" ? "off" : "work",
      locationId: String(l?.locationId || ""),
      applyAll: Boolean(l?.applyAll ?? false),
    };
  })();

  // current therapist selection (default to lastTherapist if present)
  let currentTherapist = String(saved?.lastTherapist || window.__FP_AV_LAST_THER || "DEFAULT").trim() || "DEFAULT";
  window.__FP_AV_LAST_THER = currentTherapist;

  // Per-operator colors (shared: stored in Airtable via /api/operators.color)
  function normalizeHexColor(s) {
    const x = String(s || "").trim();
    const m = x.match(/^#([0-9a-fA-F]{6})$/);
    return m ? ("#" + m[1].toUpperCase()) : "";
  }
  function hexToRgb(hex) {
    const h = String(hex || "").trim();
    const m = h.match(/^#([0-9a-fA-F]{6})$/);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbaFromHex(hex, alpha) {
    const a = Math.max(0, Math.min(1, Number(alpha)));
    const rgb = hexToRgb(hex);
    if (!rgb) return "";
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
  }
  function hashHue(s) {
    const str = String(s || "");
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function defaultHslaForName(name, alpha) {
    const n = String(name || "").trim();
    if (!n || n === "DEFAULT") return `rgba(34,230,195,${Math.max(0, Math.min(1, Number(alpha)))})`;
    const hue = hashHue(n);
    return `hsla(${hue} 78% 58% / ${Math.max(0, Math.min(1, Number(alpha)))})`;
  }
  function operatorHexForTherapistName(name) {
    const n = String(name || "").trim();
    if (!n || n === "DEFAULT") return "";
    const cMap = window.__FP_AV_OPNAME_TO_COLOR && typeof window.__FP_AV_OPNAME_TO_COLOR === "object" ? window.__FP_AV_OPNAME_TO_COLOR : {};
    return normalizeHexColor(cMap[n]);
  }
  function workBgForTherapist(name) {
    const hex = operatorHexForTherapistName(name);
    if (hex) return rgbaFromHex(hex, 0.22) || defaultHslaForName(name, 0.22);
    return defaultHslaForName(name, 0.22);
  }
  function workOutlineForTherapist(name) {
    const hex = operatorHexForTherapistName(name);
    if (hex) return rgbaFromHex(hex, 0.40) || defaultHslaForName(name, 0.40);
    return defaultHslaForName(name, 0.40);
  }

  const ensureTherBucket = (ther) => {
    const k = String(ther || "").trim() || "DEFAULT";
    if (!slotsByTherapist[k] || typeof slotsByTherapist[k] !== "object") slotsByTherapist[k] = {};
    return slotsByTherapist[k];
  };
  const getSlotRec = (ther, key) => {
    const t = String(ther || "").trim() || "DEFAULT";
    const k = String(key || "");
    const specific = slotsByTherapist?.[t]?.[k] || null;
    if (specific) return specific;
    return slotsByTherapist?.DEFAULT?.[k] || null;
  };
  const setSlotRec = (ther, key, rec) => {
    const t = String(ther || "").trim() || "DEFAULT";
    const k = String(key || "");
    ensureTherBucket(t);
    if (!rec) delete slotsByTherapist[t][k];
    else slotsByTherapist[t][k] = rec;
  };

  // header row
  const headCells = days
    .map((d, idx) => `
      <div class="fp-av-dayhead">
        <div class="d">${d}</div>
      </div>
    `)
    .join("");

  // Top toolbar (collaborator picker)
  const top = document.querySelector(".fp-av-top");
  if (top) {
    top.innerHTML = `
      <div class="fp-av-toolbar">
        <div class="left">
          <div style="font-weight:1000;">Puoi selezionare più slot cliccando e trascinando la selezione</div>
          <div style="opacity:.75;">•</div>
          <label style="display:flex; align-items:center; gap:12px; margin-left:12px;">
            <span>Collaboratore:</span>
            <select data-av-ther style="font-size:14px;">
              <option value="DEFAULT">Tutti (default)</option>
            </select>
          </label>
        </div>
      </div>
    `;
  }

  grid.innerHTML = `
    <div class="fp-av-dayhead" style="background:rgba(0,0,0,.10); border-right:1px solid rgba(255,255,255,.08); border-bottom:1px solid rgba(255,255,255,.08);"></div>
    ${headCells}
    <div class="fp-av-timecol">
      ${times.map((t) => `<div class="fp-av-time">${t}</div>`).join("")}
    </div>
    ${days
      .map((_, dIdx) => {
        return `
          <div style="display:grid; grid-template-rows: repeat(${times.length}, 18px);">
            ${times.map((t, rIdx) => {
              const key = `${dIdx}:${rIdx}`;
              const st = getSlotRec(currentTherapist, key)?.status || "";
              const cls = st === "work" ? "work" : "";
              const style = st === "work"
                ? `style="background:${workBgForTherapist(currentTherapist)}; outline:1px solid ${workOutlineForTherapist(currentTherapist)};"`
                : "";
              return `<div class="fp-av-cell ${cls}" ${style} data-av-cell="${key}"></div>`;
            }).join("")}
          </div>
        `;
      })
      .join("")}
  `;

  // --- Editor overlay (OsteoEasy-like) ---
  const back = document.querySelector("[data-fp-av-back]");
  const panelBody = back?.querySelector(".fp-set-body");
  if (!back || !panelBody) return;

  // Clean previous editor (rebuilds)
  panelBody.querySelectorAll(".fp-av-editor").forEach((el) => el.remove());

  const editor = document.createElement("div");
  editor.className = "fp-av-editor";
  editor.style.display = "none";
  editor.innerHTML = `
    <div class="fp-av-editor__head">
      <div class="fp-av-editor__title"><span style="font-size:22px;">🕒</span> <span data-av-ed-title>0 slot selezionati</span></div>
      <button type="button" class="fp-av-editor__x" data-av-ed-x aria-label="Chiudi">×</button>
    </div>
    <div class="fp-av-editor__body">
      <div class="fp-av-editor__row">
        <div class="fp-av-editor__radio">
          <label><input type="radio" name="avStatus" value="off" data-av-ed-status /> Non lavorativo</label>
          <label><input type="radio" name="avStatus" value="work" data-av-ed-status /> Lavorativo</label>
        </div>
      </div>
      <div class="fp-av-editor__row">
        <label style="display:flex; gap:10px; align-items:center; font-weight:900;">
          <input type="checkbox" data-av-ed-all />
          <span>Applica a tutti i collaboratori</span>
        </label>
      </div>
      <div class="fp-av-editor__locs" data-av-ed-locs>
        <div class="fp-av-editor__label">Luogo di lavoro:</div>
        <div data-av-ed-loclist style="margin-top:10px;"></div>
      </div>
    </div>
    <div class="fp-av-editor__foot">
      <button type="button" class="btn" data-av-ed-cancel>Annulla</button>
      <button type="button" class="fp-av-ok" data-av-ed-ok>OK</button>
    </div>
  `;
  panelBody.appendChild(editor);

  const selKeys = new Set();
  const getCellByKey = (key) => grid.querySelector(`[data-av-cell="${String(key).replaceAll('"', '\\"')}"]`);
  const setCellVisualState = (cellEl, st) => {
    if (!cellEl) return;
    cellEl.classList.remove("work", "off", "on");
    cellEl.removeAttribute("style");
    if (st === "work") {
      cellEl.classList.add("work");
      cellEl.style.background = workBgForTherapist(currentTherapist);
      cellEl.style.outline = `1px solid ${workOutlineForTherapist(currentTherapist)}`;
    }
  };

  const clearSelection = () => {
    selKeys.forEach((k) => {
      const el = getCellByKey(k);
      if (el) el.classList.remove("sel");
    });
    selKeys.clear();
  };

  const setSelected = (cellEl, isSelected) => {
    const key = String(cellEl?.getAttribute("data-av-cell") || "");
    if (!key) return;
    cellEl.classList.toggle("sel", isSelected);
    if (isSelected) selKeys.add(key);
    else selKeys.delete(key);
  };

  const titleEl = editor.querySelector("[data-av-ed-title]");
  const locsWrap = editor.querySelector("[data-av-ed-locs]");
  const locList = editor.querySelector("[data-av-ed-loclist]");
  const statusInputs = Array.from(editor.querySelectorAll("[data-av-ed-status]"));
  const btnX = editor.querySelector("[data-av-ed-x]");
  const btnCancel = editor.querySelector("[data-av-ed-cancel]");
  const btnOk = editor.querySelector("[data-av-ed-ok]");
  const chkAll = editor.querySelector("[data-av-ed-all]");

  let editorStatus = last.status;     // "work" | "off"
  let editorLocId = last.locationId;  // string (optional)
  let editorApplyAll = Boolean(last.applyAll);
  let locations = null;              // loaded lazily
  let locationsLoading = false;

  const renderEditorTitle = () => {
    const n = selKeys.size;
    if (titleEl) titleEl.textContent = `${n} slot selezionat${n === 1 ? "o" : "i"}`;
  };

  const renderLocButtons = () => {
    if (!locList) return;
    locList.innerHTML = "";

    const disabled = editorStatus !== "work";
    const wrapCls = disabled ? "isDisabled" : "";

    if (!locationsLoading && !locations) {
      // fetch once
      locationsLoading = true;
      locList.innerHTML = `<div style="color:rgba(0,0,0,.55); font-weight:800;">Caricamento sedi…</div>`;
      // Requested: availability "Luogo di lavoro" must come from AZIENDA primary field "Sede".
      api("/api/locations?table=AZIENDA&nameField=Sede")
        .then((data) => {
          const items = Array.isArray(data?.items) ? data.items : [];
          locations = items.map((x) => ({ id: String(x.id || x.ID || x.sedeId || ""), name: String(x.name || x.nome || x.label || x.id || "") }))
            .filter((x) => x.id && x.name);
        })
        .catch(() => { locations = []; })
        .finally(() => { locationsLoading = false; renderLocButtons(); });
      return;
    }

    if (locationsLoading) {
      locList.innerHTML = `<div style="color:rgba(0,0,0,.55); font-weight:800;">Caricamento sedi…</div>`;
      return;
    }

    if (!locations || locations.length === 0) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `fp-av-locbtn isDisabled`;
      b.textContent = "Sedi non disponibili";
      locList.appendChild(b);
      return;
    }

    // If no location selected yet, preselect first one (only in work mode).
    if (editorStatus === "work" && !editorLocId) editorLocId = locations[0].id;

    locations.forEach((loc) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `fp-av-locbtn ${wrapCls} ${editorLocId === loc.id ? "isSelected" : ""}`.trim();
      btn.innerHTML = `
        <span>${loc.name}</span>
        <span style="font-weight:900; opacity:${editorLocId === loc.id ? "1" : ".0"};">✓</span>
      `;
      btn.onclick = () => {
        if (editorStatus !== "work") return;
        editorLocId = loc.id;
        renderLocButtons();
      };
      locList.appendChild(btn);
    });
  };

  const syncEditorControls = () => {
    statusInputs.forEach((inp) => {
      inp.checked = String(inp.value) === editorStatus;
    });
    if (chkAll) chkAll.checked = editorApplyAll;
    if (locsWrap) locsWrap.style.display = editorStatus === "work" ? "" : "none";
    renderLocButtons();
  };

  const openEditor = () => {
    renderEditorTitle();
    syncEditorControls();
    editor.style.display = "block";
  };
  const closeEditor = () => {
    editor.style.display = "none";
  };

  btnX && (btnX.onclick = () => { closeEditor(); });
  btnCancel && (btnCancel.onclick = () => { clearSelection(); closeEditor(); });
  statusInputs.forEach((inp) => {
    inp.addEventListener("change", () => {
      editorStatus = String(inp.value) === "off" ? "off" : "work";
      syncEditorControls();
    });
  });
  chkAll && chkAll.addEventListener("change", () => {
    editorApplyAll = Boolean(chkAll.checked);
  });

  btnOk && (btnOk.onclick = () => {
    // Apply to all selected slots
    const applyTo = (therList) => {
      selKeys.forEach((key) => {
        therList.forEach((ther) => {
          if (editorStatus === "off") setSlotRec(ther, key, { status: "off", locationId: "" });
          else setSlotRec(ther, key, { status: "work", locationId: String(editorLocId || "") });
        });
        // update visuals for current therapist only
        setCellVisualState(getCellByKey(key), editorStatus);
      });
    };
    if (editorApplyAll) {
      const ops = Array.isArray(window.__FP_AV_OPERATORS) ? window.__FP_AV_OPERATORS : [];
      const all = ["DEFAULT", ...ops];
      applyTo(all);
    } else {
      applyTo([currentTherapist]);
    }
    // persist last choices for next selection
    last.status = editorStatus;
    last.locationId = String(editorLocId || "");
    last.applyAll = Boolean(editorApplyAll);
    clearSelection();
    closeEditor();
  });

  // --- Selection interactions (drag selects, does not toggle state) ---
  let dragging = false;
  let dragMode = "add"; // "add" | "remove"

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    if (selKeys.size > 0) openEditor();
    else closeEditor();
  };

  // avoid stacking listeners on rebuild
  if (window.__FP_AV_MOUSEUP) {
    try { window.removeEventListener("mouseup", window.__FP_AV_MOUSEUP); } catch {}
  }
  window.__FP_AV_MOUSEUP = onMouseUp;
  window.addEventListener("mouseup", window.__FP_AV_MOUSEUP);

  grid.querySelectorAll("[data-av-cell]").forEach((c) => {
    c.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // plain drag: replace selection; with modifiers, add to existing selection
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (!additive) clearSelection();
      dragging = true;
      dragMode = c.classList.contains("sel") ? "remove" : "add";
      setSelected(c, dragMode === "add");
    });
    c.addEventListener("mouseenter", () => {
      if (!dragging) return;
      setSelected(c, dragMode === "add");
    });
  });

  // Escape closes editor + clears selection
  const onKeyDown = (e) => {
    if (e.key !== "Escape") return;
    clearSelection();
    closeEditor();
  };
  if (window.__FP_AV_KEYDOWN) {
    try { window.removeEventListener("keydown", window.__FP_AV_KEYDOWN); } catch {}
  }
  window.__FP_AV_KEYDOWN = onKeyDown;
  window.addEventListener("keydown", window.__FP_AV_KEYDOWN);

  // If Agenda "colori collaboratori" change, refresh availability UI (if open).
  const onAgendaPrefsChanged = () => {
    try {
      const b = document.querySelector("[data-fp-av-back]");
      if (b && b.style.display === "block") buildAvailabilityUI();
    } catch {}
  };
  if (window.__FP_AV_AGENDA_PREFS) {
    try { window.removeEventListener("fpAgendaPrefsChanged", window.__FP_AV_AGENDA_PREFS); } catch {}
  }
  window.__FP_AV_AGENDA_PREFS = onAgendaPrefsChanged;
  window.addEventListener("fpAgendaPrefsChanged", window.__FP_AV_AGENDA_PREFS);

  // wire modal controls
  const close = back.querySelector("[data-fp-av-close]");
  const reset = back.querySelector("[data-fp-av-reset]");
  const save = back.querySelector("[data-fp-av-save]");

  close && (close.onclick = () => { clearSelection(); closeEditor(); closeAvailabilityModal(); });
  back.onclick = (e) => {
    if (e.target !== back) return;
    clearSelection();
    closeEditor();
    closeAvailabilityModal();
  };
  reset && (reset.onclick = () => {
    localStorage.removeItem(stateKey);
    try { window.dispatchEvent(new CustomEvent("fpAvailabilityChanged")); } catch {}
    buildAvailabilityUI();
  });
  save && (save.onclick = () => {
    const nextRanges = Array.isArray(ranges) ? ranges : [];
    try {
      localStorage.setItem(stateKey, JSON.stringify({ ranges: nextRanges, byTherapist: slotsByTherapist, last, lastTherapist: currentTherapist }));
    } catch {}
    clearSelection();
    closeEditor();
    closeAvailabilityModal();
    toast("Salvato");
    try { window.dispatchEvent(new CustomEvent("fpAvailabilityChanged")); } catch {}
  });

  // Fill collaborator selector once operators load (async)
  (async () => {
    const sel = top?.querySelector?.("[data-av-ther]");
    if (!sel) return;
    sel.value = currentTherapist;
    const ops = await ensureOperators();
    // rebuild options (keep current selection)
    const cur = String(sel.value || currentTherapist || "DEFAULT");
    sel.innerHTML = `<option value="DEFAULT">Tutti (default)</option>` + ops.map((n) => `<option value="${String(n).replaceAll('"', "&quot;")}">${String(n).replaceAll("<", "&lt;")}</option>`).join("");
    sel.value = cur;
    currentTherapist = String(sel.value || "DEFAULT");
    window.__FP_AV_LAST_THER = currentTherapist;
    // refresh cell classes for current therapist
    grid.querySelectorAll("[data-av-cell]").forEach((c) => {
      const key = String(c.getAttribute("data-av-cell") || "");
      const st = getSlotRec(currentTherapist, key)?.status || "";
      setCellVisualState(c, st === "work" ? "work" : "");
    });
    sel.onchange = () => {
      currentTherapist = String(sel.value || "DEFAULT");
      window.__FP_AV_LAST_THER = currentTherapist;
      clearSelection();
      closeEditor();
      grid.querySelectorAll("[data-av-cell]").forEach((c) => {
        const key = String(c.getAttribute("data-av-cell") || "");
        const st = getSlotRec(currentTherapist, key)?.status || "";
        setCellVisualState(c, st === "work" ? "work" : "");
      });
    };
  })();
}

function loadAppointmentsSettings() {
  const key = fpSettingsKey("appointments");
  let s = null;
  try { s = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
  const obj = s && typeof s === "object" ? s : {};

  const back = document.querySelector("[data-fp-appt-back]");
  if (!back) return;
  const panel = back.querySelector(".fp-set-panel");
  if (!panel) return;

  const days = panel.querySelector("[data-fp-appt-days]");
  const cancelband = panel.querySelector("[data-fp-appt-cancelband]");
  const drag = panel.querySelector("[data-fp-appt-drag]");
  const billing = panel.querySelector("[data-fp-appt-billing]");
  const showname = panel.querySelector("[data-fp-appt-showname]");
  const name = panel.querySelector("[data-fp-appt-name]");
  const info = panel.querySelector("[data-fp-appt-info]");
  const nameCount = panel.querySelector("[data-fp-appt-name-count]");
  const infoCount = panel.querySelector("[data-fp-appt-info-count]");

  if (days) days.value = String(obj.days ?? 7);
  if (cancelband) cancelband.checked = Boolean(obj.cancelband ?? true);
  if (drag) drag.checked = Boolean(obj.drag ?? true);
  if (billing) billing.checked = Boolean(obj.billing ?? true);
  if (showname) showname.checked = Boolean(obj.showname ?? false);
  if (name) name.value = String(obj.name ?? "");
  if (info) info.value = String(obj.info ?? "");

  const syncCounts = () => {
    if (nameCount) nameCount.textContent = `${String(name?.value || "").length} / 150`;
    if (infoCount) infoCount.textContent = `${String(info?.value || "").length} / 150`;
  };
  name?.addEventListener("input", syncCounts);
  info?.addEventListener("input", syncCounts);
  syncCounts();

  const close = panel.querySelector("[data-fp-appt-close]");
  const reset = panel.querySelector("[data-fp-appt-reset]");
  const save = panel.querySelector("[data-fp-appt-save]");
  close && (close.onclick = closeAppointmentsModal);
  back.onclick = (e) => { if (e.target === back) closeAppointmentsModal(); };
  reset && (reset.onclick = () => {
    localStorage.removeItem(key);
    loadAppointmentsSettings();
    try { window.dispatchEvent(new CustomEvent("fpAppointmentsSettingsChanged")); } catch {}
  });
  save && (save.onclick = () => {
    const next = {
      days: Number(days?.value || 0),
      cancelband: Boolean(cancelband?.checked),
      drag: Boolean(drag?.checked),
      billing: Boolean(billing?.checked),
      showname: Boolean(showname?.checked),
      name: String(name?.value || "").trim(),
      info: String(info?.value || "").trim(),
    };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
    closeAppointmentsModal();
    toast("Salvato");
    try { window.dispatchEvent(new CustomEvent("fpAppointmentsSettingsChanged")); } catch {}
  });
}

function isAgendaNow() {
  return Boolean(document.querySelector("[data-diary]")) || (location.pathname || "").endsWith("/pages/agenda.html");
}

function isBillingNow() {
  const p = location.pathname || "";
  return p.endsWith("/pages/fatturazione.html") || p.endsWith("/fatturazione.html");
}

function isManagerNow() {
  const p = location.pathname || "";
  // Manager "home" lives under /pages/manager.html; CFO dashboards live under /manager/*
  return p.endsWith("/pages/manager.html") || p.includes("/manager/");
}

function ensureManagerSettingsModal() {
  if (document.querySelector("[data-fp-mgr-back]")) return;

  const back = document.createElement("div");
  back.className = "fp-set-back";
  back.setAttribute("data-fp-mgr-back", "1");
  back.innerHTML = `
    <div class="fp-set-panel" role="dialog" aria-modal="true" style="width:920px;">
      <div class="fp-set-head">
        <div class="fp-set-title"><span style="font-size:18px;">⚙️</span> Impostazioni Manager</div>
        <button class="btn" type="button" data-fp-mgr-close>Chiudi</button>
      </div>
      <div class="fp-set-body">
        <div class="card" style="padding:14px;">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div style="min-width:0;">
              <div style="font-weight:950;">Collaboratori</div>
              <div style="margin-top:4px; color:var(--muted);">
                Aggiungi / disattiva collaboratori e gestisci il flag “Attivo”.
              </div>
            </div>
            <button class="btn" type="button" data-mgr-refresh>Aggiorna</button>
          </div>

          <div style="margin-top:12px; display:grid; grid-template-columns: 1.3fr 1fr; gap:12px;">
            <label class="field" style="gap:6px;">
              <span class="fpFormLabel">Cerca</span>
              <input class="input" data-mgr-q placeholder="Nome / email…" />
            </label>
            <label class="field" style="gap:6px;">
              <span class="fpFormLabel">Mostra</span>
              <select class="select" data-mgr-filter>
                <option value="all">Tutti</option>
                <option value="active">Solo attivi</option>
                <option value="inactive">Solo non attivi</option>
              </select>
            </label>
          </div>

          <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border);">
            <div style="font-weight:900;">Nuovo collaboratore</div>
            <div style="margin-top:10px; display:grid; grid-template-columns: 1.2fr 1fr 220px 140px; gap:10px; align-items:end;">
              <label class="field" style="gap:6px;">
                <span class="fpFormLabel">Nome</span>
                <input class="input" data-mgr-new-name placeholder="Es. Mario Rossi" />
              </label>
              <label class="field" style="gap:6px;">
                <span class="fpFormLabel">Email</span>
                <input class="input" data-mgr-new-email placeholder="nome@azienda.it" />
              </label>
              <label class="field" style="gap:6px;">
                <span class="fpFormLabel">Ruolo</span>
                <select class="select" data-mgr-new-role>
                  <option value="Fisioterapista">Fisioterapista</option>
                  <option value="Front office">Front office</option>
                  <option value="Back office">Back office</option>
                  <option value="CEO">CEO</option>
                </select>
              </label>
              <label class="field" style="gap:6px;">
                <span class="fpFormLabel">Attivo</span>
                <label class="switch" style="margin-top:6px;">
                  <input type="checkbox" checked data-mgr-new-active />
                  <span class="slider"></span>
                </label>
              </label>
            </div>
            <div style="margin-top:10px; display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
              <button class="btn primary" type="button" data-mgr-new-save>Aggiungi</button>
            </div>
            <div style="margin-top:8px; color:var(--muted); font-size:13px;">
              Nota: “Rimuovere” un collaboratore = renderlo <b>non attivo</b> (soft delete).
            </div>
          </div>

          <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border);">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
              <div style="font-weight:900;">Elenco</div>
              <div style="color:var(--muted); font-size:13px;" data-mgr-count>—</div>
            </div>
            <div style="margin-top:10px;" data-mgr-list></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(back);

  // Close behavior
  const close = () => { back.style.display = "none"; };
  back.querySelector("[data-fp-mgr-close]")?.addEventListener("click", close);
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
}

async function openManagerSettingsModal() {
  ensureManagerSettingsModal();
  const back = document.querySelector("[data-fp-mgr-back]");
  if (!back) return;

  const qEl = back.querySelector("[data-mgr-q]");
  const fEl = back.querySelector("[data-mgr-filter]");
  const listEl = back.querySelector("[data-mgr-list]");
  const countEl = back.querySelector("[data-mgr-count]");
  const btnRefresh = back.querySelector("[data-mgr-refresh]");

  const newName = back.querySelector("[data-mgr-new-name]");
  const newEmail = back.querySelector("[data-mgr-new-email]");
  const newRole = back.querySelector("[data-mgr-new-role]");
  const newActive = back.querySelector("[data-mgr-new-active]");
  const btnNewSave = back.querySelector("[data-mgr-new-save]");

  let items = [];
  const roleOpts = ["Fisioterapista", "Front office", "Back office", "CEO"];

  const esc = (x) =>
    String(x ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  async function load() {
    try {
      listEl.innerHTML = `<div style="padding:12px; color:var(--muted); font-weight:800;">Caricamento…</div>`;
      const data = await window.fpApi("/api/manager-collaborators");
      items = Array.isArray(data.items) ? data.items : [];
      render();
    } catch (e) {
      console.error(e);
      listEl.innerHTML = `<div style="padding:12px; color:rgba(255,214,222,.95); font-weight:900;">Errore caricamento collaboratori</div>`;
    }
  }

  function filtered() {
    const q = String(qEl?.value || "").trim().toLowerCase();
    const mode = String(fEl?.value || "all");
    return (items || []).filter((x) => {
      const active = Boolean(x.active);
      if (mode === "active" && !active) return false;
      if (mode === "inactive" && active) return false;
      if (!q) return true;
      return (
        String(x.name || "").toLowerCase().includes(q) ||
        String(x.email || "").toLowerCase().includes(q) ||
        String(x.roleLabel || "").toLowerCase().includes(q) ||
        String(x.id || "").toLowerCase().includes(q)
      );
    });
  }

  function render() {
    const rows = filtered();
    if (countEl) countEl.textContent = `${rows.length} / ${(items || []).length}`;
    if (!rows.length) {
      listEl.innerHTML = `<div style="padding:12px; color:var(--muted); font-weight:800;">Nessun collaboratore.</div>`;
      return;
    }
    listEl.innerHTML = rows
      .map((x) => {
        const id = String(x.id || "");
        const name = String(x.name || "");
        const email = String(x.email || "");
        const role = String(x.roleLabel || "");
        const active = Boolean(x.active);
        return `
          <div data-mgr-row="${esc(id)}" class="card" style="padding:12px; margin-bottom:10px;">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;">
              <div style="min-width:0;">
                <div style="font-weight:950;">${esc(name)}</div>
                <div style="margin-top:4px; color:var(--muted); font-size:13px;">${esc(email)} • <span style="opacity:.85;">${esc(id)}</span></div>
              </div>
              <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <label class="field" style="gap:6px; min-width:220px;">
                  <span class="fpFormLabel">Ruolo</span>
                  <select class="select" data-mgr-role>
                    ${roleOpts.map((r) => `<option value="${esc(r)}" ${r === role ? "selected" : ""}>${esc(r)}</option>`).join("")}
                  </select>
                </label>
                <label class="field" style="gap:6px;">
                  <span class="fpFormLabel">Attivo</span>
                  <label class="switch" style="margin-top:6px;">
                    <input type="checkbox" ${active ? "checked" : ""} data-mgr-active />
                    <span class="slider"></span>
                  </label>
                </label>
                <button class="btn ${active ? "" : "primary"}" type="button" data-mgr-toggle>${active ? "Disattiva" : "Riattiva"}</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // bind row events
    listEl.querySelectorAll("[data-mgr-row]").forEach((row) => {
      const id = String(row.getAttribute("data-mgr-row") || "");
      const roleSel = row.querySelector("[data-mgr-role]");
      const activeChk = row.querySelector("[data-mgr-active]");
      const btnToggle = row.querySelector("[data-mgr-toggle]");

      const find = () => (items || []).find((x) => String(x.id || "") === id) || null;

      const patch = async (p) => {
        await window.fpApi("/api/manager-collaborators", { method: "PATCH", body: JSON.stringify({ id, ...p }) });
        const it = find();
        if (it) {
          if (p.roleLabel !== undefined) it.roleLabel = String(p.roleLabel || "");
          if (p.active !== undefined) it.active = Boolean(p.active);
        }
      };

      roleSel?.addEventListener("change", async () => {
        const v = String(roleSel.value || "");
        try { await patch({ roleLabel: v }); toast("Salvato"); } catch (e) { console.error(e); toast("Errore"); }
      });
      activeChk?.addEventListener("change", async () => {
        const v = Boolean(activeChk.checked);
        try { await patch({ active: v }); toast("Salvato"); load().catch(() => {}); } catch (e) { console.error(e); toast("Errore"); }
      });
      btnToggle?.addEventListener("click", async () => {
        const it = find();
        const next = !(it && it.active);
        try { await patch({ active: next }); toast("Salvato"); load().catch(() => {}); } catch (e) { console.error(e); toast("Errore"); }
      });
    });
  }

  btnRefresh?.addEventListener("click", () => load().catch(() => {}));
  qEl?.addEventListener("input", render);
  fEl?.addEventListener("change", render);

  btnNewSave?.addEventListener("click", async () => {
    const name = String(newName?.value || "").trim();
    const email = String(newEmail?.value || "").trim().toLowerCase();
    const roleLabel = String(newRole?.value || "").trim();
    const active = Boolean(newActive?.checked);
    if (!name || !email || !roleLabel) return toast("Compila Nome, Email e Ruolo");
    try {
      btnNewSave.disabled = true;
      await window.fpApi("/api/manager-collaborators", { method: "POST", body: JSON.stringify({ name, email, roleLabel, active }) });
      toast("Creato");
      if (newName) newName.value = "";
      if (newEmail) newEmail.value = "";
      await load();
    } catch (e) {
      console.error(e);
      toast("Errore creazione");
    } finally {
      btnNewSave.disabled = false;
    }
  });

  back.style.display = "block";
  await load();
}

function normalizeRightbar() {
  const rb = document.querySelector(".app > .rightbar");
  if (!rb) return;

  const isAgenda = isAgendaNow();
  const isBilling = isBillingNow();
  const isMgr = isManagerNow() && String((window.FP_USER?.role || window.FP_SESSION?.role || "")).trim() === "manager";

  rb.className = "rightbar fp-rbar";

  // Manager pages: keep only the settings gear, and open Manager settings (not Agenda).
  if (isMgr) {
    rb.innerHTML = `
      <button class="rbBtn" data-open-manager-settings title="Impostazioni Manager">
        <span class="rbIcon">⚙️</span>
        <span class="rbLabel">Impostazioni Manager</span>
      </button>
    `;
    return;
  }

  // On Fatturazione we want billing-specific settings (and no “agenda” items).
  if (isBilling) {
    rb.innerHTML = `
      <button class="rbBtn" data-open-billing title="Impostazioni fatturazione">
        <span class="rbIcon">🧾</span>
        <span class="rbLabel">Impostazioni fatturazione</span>
      </button>
      <button class="rbBtn" data-open-theme title="Tema">
        <span class="rbIcon">🎨</span>
        <span class="rbLabel">Tema</span>
      </button>
    `;
    return;
  }

  rb.innerHTML = `
    <button class="rbBtn" ${isAgenda ? 'data-open-prefs' : ""} title="Impostazioni Agenda">
      <span class="rbIcon">⚙️</span>
      <span class="rbLabel">Impostazioni Agenda</span>
    </button>
    <button class="rbBtn" data-open-availability title="Impostazioni Disponibilità">
      <span class="rbIcon">🕒</span>
      <span class="rbLabel">Impostazioni Disponibilità</span>
    </button>
    <button class="rbBtn" data-open-appointments title="Impostazioni Appuntamenti">
      <span class="rbIcon">✅</span>
      <span class="rbLabel">Impostazioni Appuntamenti</span>
    </button>
    <button class="rbBtn" data-open-theme title="Tema">
      <span class="rbIcon">🎨</span>
      <span class="rbLabel">Tema</span>
    </button>
  `;
}

async function swapCenterTo(url, opts = {}) {
  const replace = Boolean(opts.replace);
  const u = url instanceof URL ? url : new URL(String(url), location.href);

  // Only swap if we are in the layout shell.
  if (!isSpaShell()) {
    if (replace) location.replace(u.toString());
    else location.href = u.toString();
    return;
  }

  // Avoid parallel navigations.
  if (window.__FP_SPA_INFLIGHT) return;
  window.__FP_SPA_INFLIGHT = true;

  try {
    const html = await loadHtml(u);
    const { title, main, rightbar, inlineStyles, hasDiary, hasPatientPage, overlays } = extractPageParts(html);

    // Apply route-specific styles (from <head><style>…</style>).
    applyRouteStyles(inlineStyles);

    const curMain = document.querySelector(".app > .main");
    const curRight = document.querySelector(".app > .rightbar");
    const curApp = document.querySelector(".app");
    if (!curMain || !curRight) throw new Error("spa_shell_missing");

    // Sync per-page flags that scripts rely on.
    if (curApp) {
      if (hasDiary) curApp.setAttribute("data-diary", "");
      else curApp.removeAttribute("data-diary");
    }
    if (hasPatientPage) curMain.setAttribute("data-patient-page", "");
    else curMain.removeAttribute("data-patient-page");

    // Swap non-menu overlays (modals, backdrops, etc.)
    ensureOverlayHost().innerHTML = String(overlays || "");

    if (main) curMain.innerHTML = main.innerHTML;
    else curMain.innerHTML = `<section class="card"><div class="body">Pagina non supportata.</div></section>`;

    if (rightbar) {
      curRight.className = rightbar.className;
      curRight.innerHTML = rightbar.innerHTML;
    } else {
      curRight.className = "rightbar";
      curRight.innerHTML = "";
    }

    if (title) document.title = title;

    if (replace) history.replaceState({ fpSpa: 1 }, "", u.pathname + u.search);
    else history.pushState({ fpSpa: 1 }, "", u.pathname + u.search);

    await runRouteInits();
  } finally {
    window.__FP_SPA_INFLIGHT = false;
  }
}

function setupSpaRouter() {
  if (window.__FP_SPA_ROUTER_READY) return;
  window.__FP_SPA_ROUTER_READY = true;

  bootstrapRouteStyleControl();
  bootstrapOverlayControl();

  // Public helper for code that wants SPA navigation.
  window.fpNavigate = (href, opts = {}) => {
    const u = new URL(String(href), location.href);
    if (!shouldSpaHandleUrl(u)) {
      location.href = u.toString();
      return;
    }
    swapCenterTo(u, opts).catch(() => (location.href = u.toString()));
  };

  try { history.replaceState({ fpSpa: 1 }, "", location.pathname + location.search); } catch {}

  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const a = e.target?.closest?.("a[href]");
      if (a) {
        const href = a.getAttribute("href") || "";
        if (!href || href.startsWith("#")) return;
        const u = new URL(href, location.href);
        if (!shouldSpaHandleUrl(u)) return;
        e.preventDefault();
        swapCenterTo(u).catch(() => (location.href = u.toString()));
        return;
      }

      const openRight = e.target?.closest?.("[data-open-right-detail]");
      if (openRight) {
        e.preventDefault();
        document.body.classList.toggle("fp-right-expanded");
        return;
      }

      const openMgr = e.target?.closest?.("[data-open-manager-settings]");
      if (openMgr) {
        e.preventDefault();
        openManagerSettingsModal().catch(() => {});
        return;
      }

      const openAvail = e.target?.closest?.("[data-open-availability]");
      if (openAvail) {
        e.preventDefault();
        openAvailabilityModal();
        return;
      }

      const openAppt = e.target?.closest?.("[data-open-appointments]");
      if (openAppt) {
        e.preventDefault();
        openAppointmentsModal();
        return;
      }

      const openBilling = e.target?.closest?.("[data-open-billing]");
      if (openBilling) {
        e.preventDefault();
        openBillingModal();
        return;
      }

      const openTheme = e.target?.closest?.("[data-open-theme]");
      if (openTheme) {
        e.preventDefault();
        openThemeModal();
        return;
      }

      const btn = e.target?.closest?.("button[onclick]");
      if (btn) {
        const href = parseOnclickLocationHref(btn.getAttribute("onclick"));
        if (!href) return;
        const u = new URL(href, location.href);
        if (!shouldSpaHandleUrl(u)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        swapCenterTo(u).catch(() => (location.href = u.toString()));
      }
    },
    true,
  );

  window.addEventListener("popstate", () => {
    if (!shouldSpaHandleUrl(location.href)) return;
    swapCenterTo(location.href, { replace: true }).catch(() => (location.href = location.href));
  });
}

// =====================
// PAZIENTE (Scheda paziente) - within shell
// =====================
function isPatientPage() {
  const p = location.pathname || "";
  return p.endsWith("/pages/paziente.html") || p.endsWith("/paziente.html");
}

function fmtItDateTime(iso) {
  const s = normStr(iso);
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  try {
    return d.toLocaleString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s;
  }
}

async function initPatientPage() {
  if (!isPatientPage()) return;
  const root = document.querySelector("[data-patient-page]");
  if (!root) return;
  if (root.dataset.fpInited === "1") return;
  root.dataset.fpInited = "1";

  const url = new URL(location.href);
  const id = url.searchParams.get("id");

  const statusEl = document.querySelector("[data-patient-status]");
  const errEl = document.querySelector("[data-patient-error]");
  const rowsEl = document.querySelector("[data-patient-appt-rows]");

  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.style.display = "block";
    statusEl.textContent = msg;
  };
  const setError = (msg) => {
    if (!errEl) return;
    errEl.style.display = "block";
    errEl.textContent = msg;
  };

  const backBtn = document.querySelector("[data-patient-back]");
  if (backBtn) {
    backBtn.onclick = () => {
      if (history.length > 1) history.back();
      else if (typeof window.fpNavigate === "function") window.fpNavigate("/pages/anagrafica.html");
      else location.href = "/pages/anagrafica.html";
    };
  }

  if (!id) {
    setError("Manca id paziente nell’URL.");
    if (statusEl) statusEl.style.display = "none";
    return;
  }

  try {
    setStatus("Caricamento…");

    const p = await api("/api/patient?id=" + encodeURIComponent(id));
    const fullName = [p.Nome, p.Cognome].filter(Boolean).join(" ").trim();
    const titleEl = document.querySelector("[data-patient-title]");
    if (titleEl) titleEl.textContent = fullName ? ("Scheda: " + fullName) : "Scheda paziente";

    const setText = (sel, val) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = normStr(val) || "—";
    };
    setText("[data-patient-nome]", p.Nome);
    setText("[data-patient-cognome]", p.Cognome);
    setText("[data-patient-tel]", p.Telefono || p["Telefono"]);
    setText("[data-patient-email]", p.Email || p["Email"]);
    setText("[data-patient-dob]", p["Data di nascita"]);
    setText("[data-patient-note]", p.Note);

    setStatus("Carico storico appuntamenti…");
    const a = await api("/api/patient-appointments?id=" + encodeURIComponent(id));
    const recs = a.records || [];

    if (rowsEl) {
      rowsEl.innerHTML = "";
      if (!recs.length) {
        rowsEl.innerHTML = `<tr><td colspan="4" class="muted">Nessun appuntamento trovato.</td></tr>`;
      } else {
        for (const r of recs) {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${fmtItDateTime(r["Data e ora INIZIO"])}</td>
            <td>${fmtItDateTime(r["Data e ora FINE"])}</td>
            <td>${normStr(r.Durata) || "—"}</td>
            <td>${normStr(r.Email) || "—"}</td>
          `;
          rowsEl.appendChild(tr);
        }
      }
    }

    if (statusEl) {
      statusEl.textContent = "OK";
      setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 600);
    }
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.style.display = "none";
    setError(e.message || "Errore");
  }
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
      <div class="oe-event__title">${(appt.patient_name || "")}</div>
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
        const next = updated && updated.__deleted
          ? appointments.filter(x => x.id !== updated.id)
          : appointments.map(x => x.id === updated.id ? updated : x);
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
    if (typeof window.fpNavigate === "function") window.fpNavigate(u.toString(), { replace: true });
    else location.href = u.toString();
  };
  if (btnPrev) btnPrev.onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set("date", toISODate(addDays(weekStart, -7)));
    if (typeof window.fpNavigate === "function") window.fpNavigate(u.toString(), { replace: true });
    else location.href = u.toString();
  };
  if (btnNext) btnNext.onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set("date", toISODate(addDays(weekStart, 7)));
    if (typeof window.fpNavigate === "function") window.fpNavigate(u.toString(), { replace: true });
    else location.href = u.toString();
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

  // SPA router: keep left/right menus mounted, swap only center content.
  setupSpaRouter();

  // Apply theme ASAP after auth (per-user).
  try { applyTheme(loadTheme()); } catch {}

  initLogoutLinks();
  // Non-blocking: load logo from Airtable if configured.
  initBrandLogo();
  setUserBadges(user);
  roleGuard(user.role);
  activeNav();
  await runRouteInits();
})();
