// Lightweight auth bootstrap + shared /api/auth-me promise.
// Many pages include both auth-guard.js (in <head>) and app.js (at the bottom).
// This ensures /api/auth-me is fetched at most once per page load.
(function () {
  function isLoginLikePage() {
    const p = location.pathname || "";
    return p === "/" || p.endsWith("/index.html") || p.endsWith("/pages/login.html");
  }

  async function fetchAuthMe() {
    const r = await fetch("/api/auth-me", { credentials: "include" });
    const data = await r.json().catch(() => ({}));
    // Normalize shape
    if (!r.ok) return { ok: false, ...(data || {}) };
    return data || { ok: false };
  }

  // Expose a shared promise so other scripts can reuse it (app.js, pages/index.html).
  window.fpAuthMe = async function fpAuthMe() {
    if (window.__FP_AUTH_ME_DATA?.ok) return window.__FP_AUTH_ME_DATA;
    if (window.__FP_AUTH_ME_PROMISE) return await window.__FP_AUTH_ME_PROMISE;

    window.__FP_AUTH_ME_PROMISE = (async () => {
      const data = await fetchAuthMe().catch(() => ({ ok: false }));
      window.__FP_AUTH_ME_DATA = data;

      if (data?.ok) {
        window.FP_SESSION = data.session || null;
        window.FP_USER = data.user || null;
      } else {
        window.FP_SESSION = null;
        window.FP_USER = null;
      }
      return data;
    })();

    return await window.__FP_AUTH_ME_PROMISE;
  };

  // Default behavior: protect non-login pages.
  (async function () {
    const data = await window.fpAuthMe();
    if (!data?.ok && !isLoginLikePage()) {
      window.location.replace("/");
    }
  })();
})();
