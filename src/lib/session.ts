// Signed session cookie (HS256 JWT). Edge/Node safe — used by proxy.ts and server code.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "lt_session";
export const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 7);

export interface Session { username: string; name?: string }

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
    .setExpirationTime(`${SESSION_DAYS}d`).sign(secret());
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? { username: payload.sub, name: payload.name as string | undefined } : null;
  } catch {
    return null;
  }
}

/** Only allow same-site relative redirects after login. */
export const safeNext = (n: string | null | undefined) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/api/") ? n : "/");
