// Minimal bootstrap for the login page.
// We avoid loading the large app.js bundle here to keep the login fast.
(async function () {
  try {
    const data = (typeof window.fpAuthMe === "function")
      ? await window.fpAuthMe()
      : await (async () => {
          const r = await fetch("/api/auth-me", { credentials: "include" });
          return await r.json().catch(() => ({}));
        })();

    // Keep existing behavior: if already logged in, go to agenda.
    if (data?.ok) window.location.replace("/pages/agenda.html");
  } catch {
    // noop: show login form
  }
})();

