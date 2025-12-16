export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: false }));
  }

  const cookie = [
    "fp_session=",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Set-Cookie", cookie);
  res.end(JSON.stringify({ ok: true }));
}
