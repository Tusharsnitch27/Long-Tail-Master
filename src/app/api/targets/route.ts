import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { applyOverrides, targetHistory } from "@/server/data/targets";
import { getStoreMap } from "@/server/data/stores";
import { validateOverrides } from "@/server/targetInput";
import { apiError } from "@/server/api";

export async function POST(req: Request) {
  try {
    const user = await requireUser("editor");
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured — targets cannot be saved." }, { status: 503 });
    const body = (await req.json()) as { rows?: unknown[] };
    if (!Array.isArray(body.rows) || body.rows.length === 0) return NextResponse.json({ error: "rows[] required" }, { status: 400 });
    if (body.rows.length > 5000) return NextResponse.json({ error: "max 5000 rows per request" }, { status: 400 });
    const { byCode, byName } = await getStoreMap();
    const { ok, errors } = validateOverrides(body.rows, byCode, byName);
    if (errors.length) return NextResponse.json({ error: "validation failed", errors }, { status: 422 });
    const res = await applyOverrides(ok, user.email, "manual");
    return NextResponse.json(res);
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(req: Request) {
  try {
    await requireUser("viewer");
    const u = new URL(req.url);
    const rows = await targetHistory(Number(u.searchParams.get("limit") ?? 200), {
      category: u.searchParams.get("category") ?? undefined,
      branch_code: u.searchParams.get("branch_code") ?? undefined,
    });
    return NextResponse.json({ rows });
  } catch (e) {
    return apiError(e);
  }
}
