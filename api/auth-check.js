import { ensureRes, requireRoles } from "./_auth.js";
import { setPrivateCache } from "./_common.js";

// /api/auth-check
// Verifica sessione esistente (cookie HttpOnly) e autorizza solo role=Manager.
// Output richiesto: { ok: true, role: "Manager" }
export default async function handler(req, res) {
  ensureRes(res);
  setPrivateCache(res, 10);

  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const session = requireRoles(req, res, ["manager"]);
  if (!session) return; // 401/403 già gestito

  return res.status(200).json({
    ok: true,
    role: "Manager",
    // info extra non-breaking (utile al frontend, opzionale)
    user: {
      email: String(session.email || "").toLowerCase(),
      nome: session.nome || "",
      cognome: session.cognome || "",
      role: "manager",
      roleLabel: session.roleLabel || session.role || "Manager",
    },
  });
}

