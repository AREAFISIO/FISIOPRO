// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { airtableFindCollaboratoreByEmail } from "@/lib/airtable";
import { signSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim();
    const codice = String(body.codice || "").trim();

    if (!email || !codice) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const rec = await airtableFindCollaboratoreByEmail(email);
    if (!rec) return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });

    const attivo = Boolean(rec.fields.Attivo);
    const ruolo = (rec.fields.Ruolo || "").trim();
    const codiceDb = String(rec.fields["Codice accesso"] || "").trim();

    const ruoloValido =
      ruolo === "Fisioterapista" || ruolo === "Front office" || ruolo === "Manager";

    if (!attivo || !ruoloValido || !codiceDb || codiceDb !== codice) {
      return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
    }

    const token = signSession({
      email,
      role: ruolo as any,
      nome: rec.fields.Nome || undefined,
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set("fp_session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12, // 12 ore
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
