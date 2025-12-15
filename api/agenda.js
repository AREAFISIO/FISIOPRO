<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>FisioPro • Agenda</title>
  <link rel="stylesheet" href="../assets/app.css" />
  <style>
    .weekGrid{
      display:grid;
      grid-template-columns: 120px repeat(7, 1fr);
      gap:12px;
      align-items:start;
    }
    .dayCol{
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 16px;
      padding: 10px;
      min-height: 520px;
    }
    .dayHead{
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
      margin-bottom:10px;
    }
    .dayHead .dtitle{ font-weight:900; }
    .appt{
      border: 1px solid rgba(255,255,255,.10);
      background: rgba(255,255,255,.04);
      border-radius: 14px;
      padding: 10px;
      margin-bottom:10px;
      cursor:pointer;
    }
    .appt:hover{ background: rgba(255,255,255,.06); }
    .appt .t{ font-weight:900; }
    .appt .m{ color: var(--muted); font-size: 14px; margin-top:6px; line-height:1.4; }
    .appt .chips{ display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
    .legend{ color: var(--muted); font-size: 13px; line-height:1.6; }
    @media (max-width: 1200px){
      .weekGrid{ grid-template-columns: 1fr; }
      .dayCol{ min-height: auto; }
    }
  </style>
</head>

<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="dot"></div><div><div class="title">FISIOPRO</div><div class="sub">Agenda</div></div></div>

    <nav class="nav">
      <div class="section">Generale</div>
      <a data-nav href="index.html" data-role="physio,front,manager">Pazienti</a>
      <a data-nav href="agenda.html" class="active" data-role="physio,front,manager">Agenda</a>
      <a data-nav href="casi-clinici.html" data-role="physio,manager">Casi clinici</a>

      <div class="section">Front Office</div>
      <a data-nav href="front-office.html" data-role="front,manager">Dashboard Front-Office</a>
      <a data-nav href="vendite.html" data-role="front,manager">Vendite</a>
      <a data-nav href="erogato.html" data-role="front,manager">Erogato</a>
      <a data-nav href="pratiche-assicurative.html" data-role="front,manager">Assicurazioni</a>

      <div class="section">Sistema</div>
      <a data-nav href="impostazioni.html" data-role="manager">Configurazione</a>
      <a data-nav href="login.html">Logout</a>
    </nav>
  </aside>

  <main class="main">
    <div class="topbar">
      <div class="toprow">
        <div class="h1">Agenda <span class="pill" data-user-badge>—</span></div>
        <div class="actions">
          <button class="btn" id="todayBtn">Oggi</button>
          <button class="btn" id="prevBtn">Indietro</button>
          <button class="btn" id="nextBtn">Avanti</button>
          <button class="btn primary" data-role="front,manager" onclick="alert('TODO: form nuovo appuntamento')">Nuovo</button>
        </div>
      </div>
    </div>

    <section class="card">
      <div class="head">
        <h2 id="rangeTitle">Settimana</h2>
        <span class="chip" id="rangeChip">—</span>
      </div>

      <div class="body">
        <div class="toolbar">
          <div class="search">Cerca <input id="q" placeholder="Paziente, prestazione, operatore..." /></div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <span class="chip" id="countChip">0 appuntamenti</span>
          </div>
        </div>

        <div id="loading" class="legend">Caricamento appuntamenti…</div>
        <div id="error" class="legend" style="display:none; color:#ffb3b3;"></div>

        <div style="margin-top:12px;">
          <div class="weekGrid" id="grid"></div>
        </div>

        <div style="margin-top:12px;" class="legend">
          Click su un appuntamento: se c’è `patientId`, apre la scheda paziente.
        </div>
      </div>
    </section>
  </main>

  <aside class="rightbar">
    <div class="righttitle">Filtri</div>
    <div class="card" style="padding:14px;">
      <div class="legend">
        Prossimo step (quando vuoi): filtro “solo i miei appuntamenti” per Fisioterapista, in base al campo Operatore.
      </div>
    </div>
  </aside>
</div>

<div class="toast"></div>
<script src="../assets/app.js"></script>

<script>
  function token(){ return localStorage.getItem("token") || ""; }

  async function apiGet(url){
    const r = await fetch(url, { headers: { "Authorization": "Bearer " + token() }});
    const data = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error || ("HTTP "+r.status));
    return data;
  }

  function z(n){ return String(n).padStart(2,"0"); }
  function iso(d){ return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }

  function startOfWeekMonday(d){
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // lun=0 ... dom=6
    x.setDate(x.getDate() - day);
    x.setHours(0,0,0,0);
    return x;
  }

  function addDays(d, n){
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function itDayLabel(d){
    const days = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
    return `${days[(d.getDay()+6)%7]} ${z(d.getDate())}/${z(d.getMonth()+1)}`;
  }

  function apptHtml(a){
    const patient = a.patientName || (a.patientId ? ("ID " + a.patientId.slice(-6)) : "Paziente");
    const when = (a.time && a.time !== "00:00") ? a.time : (a.datetime ? a.datetime.slice(11,16) : "");
    const title = `${when}  •  ${patient}`;
    const line = [a.prestazione, a.operatore].filter(Boolean).join(" • ");
    const note = (a.note || "").toString().slice(0,80);
    return `
      <div class="appt" data-id="${a.id}" data-patient="${a.patientId || ""}">
        <div class="t">${title}</div>
        <div class="m">${line || ""}${note ? "<br/>" + note : ""}</div>
        <div class="chips">
          ${a.durata ? `<span class="chip">${a.durata} min</span>` : ""}
          ${a.prestazione ? `<span class="chip">${a.prestazione}</span>` : ""}
        </div>
      </div>
    `;
  }

  let weekStart = startOfWeekMonday(new Date());
  let all = [];
  let filtered = [];

  function render(){
    const grid = document.getElementById("grid");
    grid.innerHTML = "";

    // col ore (solo placeholder, puoi eliminarla)
    grid.insertAdjacentHTML("beforeend", `<div class="legend" style="padding-top:10px;">Settimana</div>`);

    for(let i=0;i<7;i++){
      const day = addDays(weekStart, i);
      const dayIso = iso(day);
      const items = filtered.filter(x => (x.date || "").slice(0,10) === dayIso);

      const col = document.createElement("div");
      col.className = "dayCol";
      col.innerHTML = `
        <div class="dayHead">
          <div class="dtitle">${itDayLabel(day)}</div>
          <span class="chip">${items.length}</span>
        </div>
        ${items.length ? items.map(apptHtml).join("") : `<div class="legend">Nessun appuntamento</div>`}
      `;
      grid.appendChild(col);
    }

    // click appuntamento → paziente
    grid.querySelectorAll(".appt").forEach(el=>{
      el.addEventListener("click", ()=>{
        const pid = el.getAttribute("data-patient");
        if(pid) location.href = "paziente.html?id=" + encodeURIComponent(pid);
      });
    });

    document.getElementById("countChip").textContent = `${filtered.length} appuntamenti`;
  }

  function applyFilter(){
    const q = document.getElementById("q").value.trim().toLowerCase();
    if(!q){ filtered = all.slice(); render(); return; }
    filtered = all.filter(a=>{
      const s = [
        a.patientName, a.patientId, a.prestazione, a.operatore, a.note, a.datetime
      ].filter(Boolean).join(" ").toLowerCase();
      return s.includes(q);
    });
    render();
  }

  async function loadWeek(){
    document.getElementById("loading").style.display = "";
    document.getElementById("error").style.display = "none";

    const from = iso(weekStart);
    const to = iso(addDays(weekStart, 6));

    document.getElementById("rangeTitle").textContent = "Agenda settimanale";
    document.getElementById("rangeChip").textContent = `${from} → ${to}`;

    try{
      const { items } = await apiGet(`/api/agenda?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      all = (items || []).map(x=>{
        // normalizza date se Airtable restituisce ISO datetime
        const dt = (x.datetime || x.date || "");
        const date = (x.date && x.date.length>=10) ? x.date.slice(0,10) : (dt ? dt.slice(0,10) : "");
        return { ...x, date };
      });
      filtered = all.slice();
      document.getElementById("loading").style.display = "none";
      render();
    }catch(e){
      document.getElementById("loading").style.display = "none";
      const err = document.getElementById("error");
      err.style.display = "";
      err.textContent = "Errore agenda: " + e.message + ". Controlla nomi campi (Data/Operatore/Prestazione/Paziente) e env.";
    }
  }

  document.getElementById("q").addEventListener("input", applyFilter);

  document.getElementById("todayBtn").onclick = () => {
    weekStart = startOfWeekMonday(new Date());
    loadWeek();
  };
  document.getElementById("prevBtn").onclick = () => {
    weekStart = addDays(weekStart, -7);
    loadWeek();
  };
  document.getElementById("nextBtn").onclick = () => {
    weekStart = addDays(weekStart, 7);
    loadWeek();
  };

  loadWeek();
</script>
</body>
</html>
