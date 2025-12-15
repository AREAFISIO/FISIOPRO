// Evidenzia link attivo (in base al pathname)
(function () {
  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll('[data-nav]').forEach(a => {
    const href = (a.getAttribute("href") || "").split("/").pop();
    if (href === path) a.classList.add("active");
  });
})();

// Filtro live tabella (se presente)
(function () {
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
})();

// Tabs (mock): mostra/nasconde sezioni data-tab
(function () {
  const tabs = document.querySelectorAll("[data-tabbtn]");
  if (!tabs.length) return;

  const show = (key) => {
    document.querySelectorAll("[data-tabpanel]").forEach(p => {
      p.style.display = (p.getAttribute("data-tabpanel") === key) ? "" : "none";
    });
    tabs.forEach(t => t.classList.toggle("active", t.getAttribute("data-tabbtn") === key));
  };

  tabs.forEach(t => t.addEventListener("click", () => show(t.getAttribute("data-tabbtn"))));
  show(tabs[0].getAttribute("data-tabbtn"));
})();
