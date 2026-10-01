// Signed session cookie (HS256 JWT). Edge/Node safe — used by proxy.ts and server code.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "lt_session";
/** Sessions are hard-capped at 8 hours from sign-in (no sliding renewal), then the user signs in again. SESSION_HOURS can only shorten it. */
export const SESSION_HOURS = Math.min(8, Math.max(0.25, Number(process.env.SESSION_HOURS ?? 8) || 8));
export const SESSION_SECONDS = Math.round(SESSION_HOURS * 3600);

export interface Session { username: string; name?: string; exp?: number }

function secret() {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("NEXTAUTH_SECRET (≥32 chars) is required for sign-in");
  return new TextEncoder().encode(s);
}

/** Cookies are Secure unless the public URL is plain http (local dev). */
export const secureCookies = () => {
  const url = (process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "").trim();
  return url ? !url.startsWith("http://") : process.env.NODE_ENV === "production";
};

export async function signSession(s: Session) {
  return new SignJWT({ name: s.name }).setProtectedHeader({ alg: "HS256" }).setSubject(s.username).setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_SECONDS).sign(secret());
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? { username: payload.sub, name: payload.name as string | undefined, exp: payload.exp } : null;
  } catch {
    return null;
  }
}

/** Only allow same-site relative redirects after login. */
export const safeNext = (n: string | null | undefined) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/api/") ? n : "/");
