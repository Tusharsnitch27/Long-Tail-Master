import { NextResponse } from "next/server";
import { checkLogin } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { safeNext, secureCookies, SESSION_COOKIE, SESSION_DAYS, signSession } from "@/lib/session";

// Relative Location: behind a reverse proxy req.url carries the internal host (e.g. 0.0.0.0:3000).
const redirectTo = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

// Failed-attempt throttle per username and per client IP (process memory).
const g = globalThis as unknown as { __loginFails?: Map<string, number[]> };
const fails: Map<string, number[]> = (g.__loginFails ??= new Map());
const WINDOW = 15 * 60_000, MAX = 8;
const recent = (k: string) => (fails.get(k) ?? []).filter((t) => Date.now() - t < WINDOW);

/** HTML form POST (works without JS): username, password, next → 303 redirect. */
export async function POST(req: Request) {
  const form = await req.formData();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const back = (error: string) => redirectTo(`/login?error=${error}&next=${encodeURIComponent(next)}${username ? `&u=${encodeURIComponent(username)}` : ""}`);

  if (!username || !password) return back("missing");
  if (recent(`u:${username}`).length >= MAX || recent(`ip:${ip}`).length >= MAX * 3) return back("locked");

  const user = await checkLogin(username, password).catch((e) => { console.error("[auth] login error", e); return undefined; });
  if (user === undefined) return back("server");
  if (!user) {
    for (const k of [`u:${username}`, `ip:${ip}`]) fails.set(k, [...recent(k), Date.now()]);
    if (dbConfigured()) await q("insert into audit_log(actor, action, entity) values ($1,'login_failed','session')", [username]).catch(() => {});
    return back("invalid");
  }
  fails.delete(`u:${username}`);
  const res = redirectTo(next);
  res.cookies.set(SESSION_COOKIE, await signSession({ username: user.username, name: user.name }), {
    httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400,
  });
  if (dbConfigured()) await q("insert into audit_log(actor, action, entity) values ($1,'login','session')", [user.username]).catch(() => {});
  return res;
}
