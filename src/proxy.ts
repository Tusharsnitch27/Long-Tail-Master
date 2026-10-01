import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/session";

// Fast gate: every page/API needs a valid signed session. The allowlist itself is enforced server-side (getUser).
export async function proxy(req: NextRequest) {
  if (process.env.AUTH_MODE === "dev") return NextResponse.next();
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // a cookie that no longer verifies means the 8-hour session ran out
  const expired = req.cookies.has(SESSION_COOKIE);
  url.search = `?${expired ? "error=session&" : ""}next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
