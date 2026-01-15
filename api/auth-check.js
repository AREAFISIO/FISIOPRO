import { ensureRes, requireRoles } from "./_auth.js";
import { setPrivateCache } from "./_common.js";

// /api/auth-check
// Verifica sessione esistente (cookie HttpOnly) e autorizza solo role=Manager (normalized).
// Nota: a livello UI vogliamo mostrare il ruolo reale/composto (es. "CEO e Fisioterapista"),
// quindi NON restituiamo più "Manager" hardcoded.
export default async function handler(req, res) {
  ensureRes(res);
  setPrivateCache(res, 10);

  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const session = requireRoles(req, res, ["manager"]);
  if (!session) return; // 401/403 già gestito

  const roleLabel = String(session.roleLabel || "").trim() || "CEO";
  return res.status(200).json({
    ok: true,
    role: roleLabel,
    roleNormalized: "manager",
    // info extra non-breaking (utile al frontend, opzionale)
    user: {
      email: String(session.email || "").toLowerCase(),
      nome: session.nome || "",
      cognome: session.cognome || "",
      role: "manager",
      roleLabel,
    },
  });
}

