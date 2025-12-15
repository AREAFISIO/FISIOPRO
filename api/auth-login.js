import { findCollaboratorByEmail, signToken } from "./_auth.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: "email and code required" });

    const u = await findCollaboratorByEmail(email);
    if (!u || !u.active) return res.status(401).json({ error: "Invalid credentials or inactive user" });

    if (String(code).trim() !== String(u.code).trim()) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!u.role) {
      return res.status(400).json({
        error: "Ruolo non valido in Airtable",
        ruolo_trovato: u.role_raw,
        ruoli_ammessi: ["Fisioterapista", "Front office", "Manager"],
      });
    }

    const token = signToken({ email: u.email, role: u.role, name: u.name || u.email });
    res.status(200).json({
      token,
      user: { email: u.email, role: u.role, name: u.name || u.email, roleLabel: u.role_raw }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
