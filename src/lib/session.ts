// Signed session cookie (HS256 JWT). Edge/Node safe — used by proxy.ts and server code.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "lt_session";
export const OAUTH_COOKIE = "lt_oauth";
export const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 7);

export interface Session { email: string; name?: string; picture?: string }

function secret() {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("NEXTAUTH_SECRET (≥32 chars) is required for sign-in");
  return new TextEncoder().encode(s);
}

/** Public base URL, e.g. https://longtail.snitch-workflow.com (scheme added if missing). */
export function appUrl() {
  const raw = (process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").trim().replace(/\/$/, "");
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}
export const secureCookies = () => appUrl().startsWith("https://");

export async function signSession(s: Session) {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setSubject(s.email).setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`).sign(secret());
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.email === "string" ? { email: payload.email, name: payload.name as string, picture: payload.picture as string } : null;
  } catch {
    return null;
  }
}

/** Only allow same-site relative redirects after login. */
export const safeNext = (n: string | null | undefined) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/api/") ? n : "/");
