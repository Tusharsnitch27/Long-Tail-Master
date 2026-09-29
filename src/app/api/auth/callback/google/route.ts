import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { appUrl, OAUTH_COOKIE, SESSION_COOKIE, SESSION_DAYS, secureCookies, signSession } from "@/lib/session";
import { isAllowed } from "@/server/access";
import { dbConfigured, q } from "@/server/db";

const g = globalThis as unknown as { __googleJwks?: ReturnType<typeof createRemoteJWKSet> };
const fail = (code: string) => {
  const res = NextResponse.redirect(`${appUrl()}/login?error=${code}`);
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
  return res;
};

// Step 2: Google redirects back with ?code&state
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("error")) return fail("cancelled");
  const code = u.searchParams.get("code");
  let saved: { state: string; verifier: string; next: string };
  try {
    saved = JSON.parse((await cookies()).get(OAUTH_COOKIE)?.value ?? "");
  } catch {
    return fail("expired");
  }
  if (!code || !saved?.state || u.searchParams.get("state") !== saved.state) return fail("state");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: `${appUrl()}/api/auth/callback/google`,
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) {
    console.error("[auth] token exchange failed", tokenRes.status, await tokenRes.text());
    return fail("google");
  }
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) return fail("google");

  g.__googleJwks ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(id_token, g.__googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: process.env.GOOGLE_CLIENT_ID,
    }));
  } catch (e) {
    console.error("[auth] id_token verification failed", e);
    return fail("google");
  }
  const email = String(claims.email ?? "").toLowerCase();
  if (!email || claims.email_verified !== true) return fail("unverified");
  if (!(await isAllowed(email))) {
    console.warn(`[auth] denied sign-in for ${email}`);
    if (dbConfigured()) await q("insert into audit_log(actor, action, entity) values ($1,'denied','login')", [email]).catch(() => {});
    return fail("denied");
  }

  const token = await signSession({ email, name: claims.name as string | undefined, picture: claims.picture as string | undefined });
  const res = NextResponse.redirect(`${appUrl()}${saved.next || "/"}`);
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
  if (dbConfigured()) await q("insert into audit_log(actor, action, entity) values ($1,'login','session')", [email]).catch(() => {});
  return res;
}
