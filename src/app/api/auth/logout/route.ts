import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function GET() {
  // relative Location so it works behind the reverse proxy
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login?signedout=1" } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
