const qEl = document.getElementById("q");
const listEl = document.getElementById("list");
const selectedEl = document.getElementById("selected");
const errorEl = document.getElementById("error");
const btnReset = document.getElementById("btnReset");

function showError(msg) {
  if (!msg) {
    errorEl.style.display = "none";
    errorEl.textContent = "";
    return;
  }
  errorEl.style.display = "block";
  errorEl.textContent = msg;
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderList(items, title = null) {
  if (!items || items.length === 0) {
    listEl.classList.add("empty");
    listEl.innerHTML = "Nessun risultato.";
    return;
  }

  listEl.classList.remove("empty");
  listEl.innerHTML = "";

  if (title) {
    const h = document.createElement("div");
    h.style.margin = "0 0 10px 2px";
    h.style.color = "#5b6b85";
    h.style.fontSize = "12px";
    h.style.fontWeight = "800";
    h.textContent = title;
    listEl.appendChild(h);
  }

  items.forEach((p) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <strong>${escapeHtml(p.name || "Senza nome")}</strong>
      <div class="meta">${escapeHtml(p.phone || "—")} · ${escapeHtml(p.email || "—")}</div>
    `;
    div.addEventListener("click", () => {
      selectedEl.classList.remove("empty");
      selectedEl.innerHTML = `
        <div style="font-weight:900;font-size:18px">${escapeHtml(p.name || "")}</div>
        <div style="margin-top:6px;color:#5b6b85;font-size:13px">
          ID: ${escapeHtml(p.id)}<br/>
          Tel: ${escapeHtml(p.phone || "—")}<br/>
          Email: ${escapeHtml(p.email || "—")}
        </div>
      `;
    });
    listEl.appendChild(div);
  });
}

let timer = null;

async function fetchJson(url) {
  const r = await fetch(url);
  return await r.json();
}

async function listPatientsFallback() {
  try {
    const data = await fetchJson("/api/airtable?op=listPatients");
    if (data.ok) {
      renderList(data.items, "Esempio: primi 10 pazienti (fallback)");
    } else {
      renderList([]);
      showError("API ok ma lista fallita: " + (data.error || data.step || "sconosciuto"));
    }
  } catch (e) {
    renderList([]);
    showError("Errore rete (fallback): " + String(e));
  }
}

async function search(q) {
  showError("");

  try {
    const data = await fetchJson(`/api/airtable?op=searchPatients&q=${encodeURIComponent(q)}`);

    if (!data.ok) {
      renderList([]);
      showError(`Errore ricerca: ${data.error || data.step || "sconosciuto"}`);
      return;
    }

    // se zero risultati → fallback: mostra comunque primi 10
    if (!data.items || data.items.length === 0) {
      await listPatientsFallback();
      return;
    }

    renderList(data.items);
  } catch (e) {
    renderList([]);
    showError("Errore ricerca: " + String(e));
  }
}

// all'avvio: mostra primi 10 automaticamente
document.addEventListener("DOMContentLoaded", async () => {
  await listPatientsFallback();
});

qEl.addEventListener("input", () => {
  const q = qEl.value.trim();
  clearTimeout(timer);
  timer = setTimeout(() => search(q), 250);
});

btnReset.addEventListener("click", async () => {
  qEl.value = "";
  showError("");
  selectedEl.classList.add("empty");
  selectedEl.textContent = "Seleziona un paziente per caricare i record.";
  await listPatientsFallback();
});
