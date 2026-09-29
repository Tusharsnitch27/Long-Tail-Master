import { NextResponse } from "next/server";
import { appUrl, SESSION_COOKIE } from "@/lib/session";

export async function GET() {
  const res = NextResponse.redirect(`${appUrl()}/login?signedout=1`);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
