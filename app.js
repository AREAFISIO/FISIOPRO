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

function renderList(items) {
  if (!items || items.length === 0) {
    listEl.classList.add("empty");
    listEl.innerHTML = "Nessun risultato.";
    return;
  }
  listEl.classList.remove("empty");
  listEl.innerHTML = "";

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
        <div style="margin-top:10px;font-size:13px;color:#5b6b85">
          Step successivo: caricare “Trattamenti / Valutazioni” dal paziente selezionato.
        </div>
      `;
    });
    listEl.appendChild(div);
  });
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

let timer = null;

async function search(q) {
  showError("");
  if (!q) {
    renderList([]);
    return;
  }

  try {
    const r = await fetch(`/api/airtable?op=searchPatients&q=${encodeURIComponent(q)}`);
    const data = await r.json();

    if (!data.ok) {
      showError(`Errore ricerca: ${data.error || data.step || "sconosciuto"}`);
      renderList([]);
      return;
    }

    renderList(data.items);
  } catch (e) {
    showError("Errore ricerca: " + String(e));
    renderList([]);
  }
}

qEl.addEventListener("input", () => {
  const q = qEl.value.trim();
  clearTimeout(timer);
  timer = setTimeout(() => search(q), 250);
});

btnReset.addEventListener("click", () => {
  qEl.value = "";
  showError("");
  renderList([]);
  selectedEl.classList.add("empty");
  selectedEl.textContent = "Seleziona un paziente per caricare i record.";
});
