(async function () {
  try {
    const r = await fetch("/api/auth-me", { credentials: "include" });
    const data = await r.json();

    if (!data.ok) {
      window.location.href = "/";
      return;
    }

    // sessione disponibile globalmente
    window.FP_SESSION = data.session || null;
    window.FP_USER = data.user || null;

    // esempio: stampa
    const u = data.user || data.session || {};
    console.log("LOGGATO:", u.email, u.role);

  } catch (e) {
    window.location.href = "/";
  }
})();
