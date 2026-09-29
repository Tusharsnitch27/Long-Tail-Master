import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { appUrl, OAUTH_COOKIE, safeNext, secureCookies } from "@/lib/session";

// Step 1: redirect to Google with state + PKCE
export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${appUrl()}/login?error=config`);
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl()}/api/auth/callback/google`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier, next }), {
    httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/api/auth", maxAge: 600,
  });
  return res;
}
