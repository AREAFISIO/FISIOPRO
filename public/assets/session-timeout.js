(function () {
  const INACTIVITY_MINUTES = 30;
  const INACTIVITY_MS = INACTIVITY_MINUTES * 60 * 1000;

  let timer = null;

  async function doLogout() {
    try {
      await fetch("/api/auth-logout", { method: "POST", credentials: "include" });
    } catch (e) {}
    window.location.href = "/?timeout=1";
  }

  function resetTimer() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(doLogout, INACTIVITY_MS);
  }

  ["click", "mousemove", "keydown", "scroll", "touchstart"].forEach((event) => {
    window.addEventListener(event, resetTimer, { passive: true });
  });

  resetTimer();
})();
