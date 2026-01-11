// Lightweight loader to defer the heavy app bundle (app.js) for faster first paint.
// - On "Agenda" (data-diary) load immediately.
// - Else: load on idle (or shortly after) to keep UI responsive.
(function () {
  try {
    const cs = document.currentScript;
    const baseSrc = String(cs?.getAttribute("data-src") || "/assets/app.js").trim() || "/assets/app.js";
    const v = String(cs?.getAttribute("data-v") || "").trim();
    const fullSrc = v ? `${baseSrc}?v=${encodeURIComponent(v)}` : baseSrc;

    if (window.__FP_APP_JS_LOADING) return;
    window.__FP_APP_JS_LOADING = true;

    const inject = () => {
      try {
        if (window.__FP_APP_JS_INJECTED) return;
        window.__FP_APP_JS_INJECTED = true;
        const s = document.createElement("script");
        s.src = fullSrc;
        s.defer = true;
        s.async = true;
        document.body.appendChild(s);
      } catch {}
    };

    const isAgenda = Boolean(document.querySelector("[data-diary]"));
    if (isAgenda) {
      // Agenda needs the app runtime ASAP to fetch and render appointments.
      inject();
      return;
    }

    // Don't wait too long: we want a fast first paint, but still start app.js quickly.
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(inject, { timeout: 400 });
    } else {
      setTimeout(inject, 50);
    }
  } catch {
    // Fail open: if loader breaks, do nothing (page still works via HTML).
  }
})();

