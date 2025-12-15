import { getAuth } from "./_auth.js";

export default async function handler(req, res) {
  const { user } = getAuth(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.status(200).json({ user: { email: user.email, role: user.role, name: user.name } });
}
