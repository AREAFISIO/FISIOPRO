async function fpLogout() {
  await fetch("/api/auth-logout", { method: "POST", credentials: "include" });
  window.location.href = "/";
}
window.fpLogout = fpLogout;
