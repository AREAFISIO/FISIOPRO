// src/lib/session.ts
import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

export type SessionPayload = {
  email: string;
  role: "Fisioterapista" | "Front office" | "Manager";
  nome?: string;
  iat: number;
};

export function signSession(payload: Omit<SessionPayload, "iat">) {
  const full: SessionPayload = { ...payload, iat: Date.now() };
  const json = JSON.stringify(full);
  const b64 = Buffer.from(json).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function verifySession(token: string): SessionPayload | null {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;

  const expected = crypto.createHmac("sha256", SECRET).update(b64).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    return JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }
}
