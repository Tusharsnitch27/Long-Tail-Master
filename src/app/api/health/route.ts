import { NextResponse } from "next/server";
import { dbConfigured, q } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = "not_configured";
  if (dbConfigured()) {
    try { await q("select 1"); db = "ok"; } catch { db = "error"; }
  }
  return NextResponse.json({ status: "ok", db, time: new Date().toISOString() }, { status: db === "error" ? 503 : 200 });
}
