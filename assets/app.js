// ====== Utils ======
const LS = {
  get: (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
  },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

function toast(msg){
  const t = document.querySelector(".toast");
  if(!t) return;
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.style.display="none", 1600);
}

// ====== Active nav ======
(function () {
  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll('[data-nav]').forEach(a => {
    const href = (a.getAttribute("href") || "").split("/").pop();
    if (href === path) a.classList.add("active");
  });
})();

// ====== Tabs ======
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

// ====== Search filter table ======
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

// ====== Seed demo data (una volta) ======
(function seed(){
  const seeded = LS.get("seeded", false);
  if(seeded) return;

  const patients = [
    { id:"899461", nome:"Adriana", cognome:"Abbate", email:"adri.abbate@tiscali.it", cell:"+39 3505107857" },
    { id:"889012", nome:"Usama", cognome:"Abdelall", email:"usamaabdelnaby@icloud.com", cell:"+39 3458542226" },
    { id:"774221", nome:"Ghalia", cognome:"Abousalah Eddine", email:"ghaliaabousalaheddine78@gmail.com", cell:"+39 3381738304" }
  ];

  const cases = [
    { id:"CC-0001", patientId:"899461", titolo:"Lombalgia post gravidanza", stato:"Bozza", updatedAt: Date.now()-86400000, note:"Dolore lombare, valutazione iniziale." },
  ];

  LS.set("patients", patients);
  LS.set("cases", cases);
  LS.set("seeded", true);
})();

// ====== Render LISTA CASI ======
(function renderCases(){
  const el = document.querySelector("[data-cases-tbody]");
  if(!el) return;

  const cases = LS.get("cases", []);
  const patients = LS.get("patients", []);
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
})();

// ====== Editor Caso: carica/salva ======
(function caseEditor(){
  const form = document.querySelector("[data-case-form]");
  if(!form) return;

  const url = new URL(location.href);
  const caseId = url.searchParams.get("id");

  const cases = LS.get("cases", []);
  const patients = LS.get("patients", []);

  // popola select pazienti
  const sel = document.querySelector("[data-patient-select]");
  if(sel){
    sel.innerHTML = `<option value="">Seleziona...</option>` + patients.map(p =>
      `<option value="${p.id}">${p.nome} ${p.cognome} • ${p.id}</option>`
    ).join("");
  }

  let current = null;

  if(caseId){
    current = cases.find(c => c.id === caseId) || null;
    if(current){
      // riempi campi
      form.querySelector("[name='caseId']").value = current.id;
      form.querySelector("[name='patientId']").value = current.patientId || "";
      form.querySelector("[name='titolo']").value = current.titolo || "";
      form.querySelector("[name='stato']").value = current.stato || "Bozza";
      form.querySelector("[name='note']").value = current.note || "";
      // immagine
      const imgData = current.bodyImage || "";
      const img = document.querySelector("[data-body-img]");
      if(imgData && img) img.src = imgData;
    }
  } else {
    // nuovo caso: id automatico
    const next = "CC-" + String(Math.floor(1000 + Math.random()*9000));
    form.querySelector("[name='caseId']").value = next;
    form.querySelector("[name='stato']").value = "Bozza";
  }

  // upload immagine body
  const file = document.querySelector("[data-body-file]");
  const img = document.querySelector("[data-body-img]");
  if(file && img){
    file.addEventListener("change", async (e)=>{
      const f = e.target.files?.[0];
      if(!f) return;
      const dataUrl = await readAsDataURL(f);
      img.src = dataUrl;
      toast("Immagine caricata");
    });
  }

  // salva bozza / salva definitivo
  document.querySelectorAll("[data-save]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const mode = btn.getAttribute("data-save"); // draft | final
      const data = Object.fromEntries(new FormData(form).entries());
      const bodyImg = document.querySelector("[data-body-img]")?.src || "";

      const payload = {
        id: data.caseId,
        patientId: data.patientId,
        titolo: data.titolo,
        stato: mode === "final" ? "Definitivo" : (data.stato || "Bozza"),
        note: data.note,
        updatedAt: Date.now(),
        bodyImage: (bodyImg && bodyImg.startsWith("data:")) ? bodyImg : (current?.bodyImage || "")
      };

      const all = LS.get("cases", []);
      const idx = all.findIndex(c => c.id === payload.id);
      if(idx >= 0) all[idx] = { ...all[idx], ...payload };
      else all.push(payload);

      LS.set("cases", all);
      toast(mode === "final" ? "Caso salvato (definitivo)" : "Bozza salvata");
      // se nuovo, aggiorna URL così rientri sullo stesso record
      if(!caseId) location.href = `caso-nuovo.html?id=${encodeURIComponent(payload.id)}`;
    });
  });

  function readAsDataURL(file){
    return new Promise((res, rej)=>{
      const r = new FileReader();
      r.onload = ()=> res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
})();
