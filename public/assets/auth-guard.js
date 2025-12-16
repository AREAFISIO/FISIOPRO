(async function () {
  try {
    const r = await fetch("/api/auth-me");
    const data = await r.json();

    if (!data.ok) {
      window.location.href = "/";
      return;
    }

    // sessione disponibile globalmente
    window.FP_SESSION = data.session;

    // esempio: stampa
    console.log("LOGGATO:", data.session.email, data.session.role);

  } catch (e) {
    window.location.href = "/";
  }
})();
