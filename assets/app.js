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

  // trova primo tab visibile
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

  // demo local: se in futuro vuoi solo API, lo sostituiamo
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
// BOOT
// =====================
(async function boot() {
  const user = await ensureAuth();
  if (!user) return;

  // badge user in alto se c'è un elemento #userBadge
  const badge = document.querySelector("[data-user-badge]");
  if (badge) badge.textContent = `${user.name} • ${user.role}`;

  roleGuard(user.role);
  activeNav();
  initTabs();
  initSearch();
  renderCasesLocalDemo();
})();
