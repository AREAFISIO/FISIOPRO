import { normalizeRole, requireSession, setJson } from "./_auth.js";

export default async function handler(req, res) {
  const session = requireSession(req);
  if (!session) return setJson(res, 200, { ok: false, session: null, user: null });

  // Backward/forward compatible: expose both `session` and `user`.
  const user = {
    email: String(session.email || "").toLowerCase(),
    role: normalizeRole(session.role),
    roleLabel: session.roleLabel || session.role || "",
    nome: session.nome || "",
  };

  return setJson(res, 200, { ok: true, session: { ...session, role: user.role, email: user.email }, user });
}
