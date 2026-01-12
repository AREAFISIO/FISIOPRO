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

    // Best of both worlds:
    // - if the user interacts quickly (click/tap/keys), load immediately to avoid "blocked" navigation
    // - otherwise load on idle soon after first paint
    const onFirstInteraction = () => {
      try {
        window.removeEventListener("pointerdown", onFirstInteraction, true);
        window.removeEventListener("keydown", onFirstInteraction, true);
        window.removeEventListener("touchstart", onFirstInteraction, true);
        window.removeEventListener("mousedown", onFirstInteraction, true);
        window.removeEventListener("wheel", onFirstInteraction, { capture: true });
      } catch {}
      inject();
    };
    try {
      window.addEventListener("pointerdown", onFirstInteraction, true);
      window.addEventListener("touchstart", onFirstInteraction, true);
      window.addEventListener("mousedown", onFirstInteraction, true);
      window.addEventListener("keydown", onFirstInteraction, true);
      // passive scroll interaction
      window.addEventListener("wheel", onFirstInteraction, { capture: true, passive: true });
    } catch {}

    if ("requestIdleCallback" in window) window.requestIdleCallback(inject, { timeout: 400 });
    else setTimeout(inject, 50);
  } catch {
    // Fail open: if loader breaks, do nothing (page still works via HTML).
  }
})();

