async function fpLogout() {
  await fetch("/api/auth-logout", { method: "POST" });
  window.location.href = "/";
}
window.fpLogout = fpLogout;
