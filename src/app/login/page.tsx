"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [codice, setCodice] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(sp.get("error"));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, codice }),
    });

    setLoading(false);

    if (!r.ok) {
      setErr("Credenziali non valide o utente non attivo.");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f7f7f8" }}>
      <form onSubmit={onSubmit} style={{ width: 380, background: "white", padding: 20, borderRadius: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>FisioPro</div>
        <div style={{ opacity: 0.7, marginTop: 6, marginBottom: 14 }}>Accedi con Email e Codice.</div>

        <label style={{ display: "block", fontWeight: 700, marginTop: 10 }}>Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", marginTop: 6 }}
          placeholder="nome@dominio.it"
        />

        <label style={{ display: "block", fontWeight: 700, marginTop: 12 }}>Codice accesso</label>
        <input
          value={codice}
          onChange={(e) => setCodice(e.target.value)}
          type="password"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", marginTop: 6 }}
          placeholder="••••••••"
        />

        {err && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "#fff5f5", border: "1px solid #fed7d7" }}>
            {err}
          </div>
        )}

        <button
          disabled={loading}
          style={{ marginTop: 14, width: "100%", padding: 12, borderRadius: 14, fontWeight: 800, border: "0", cursor: "pointer" }}
        >
          {loading ? "Accesso..." : "Accedi"}
        </button>
      </form>
    </div>
  );
}
