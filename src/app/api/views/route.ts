import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { apiError } from "@/server/api";

const Body = z.object({ name: z.string().trim().min(1).max(80), path: z.string().startsWith("/").max(200), query: z.string().max(2000), shared: z.boolean().default(false) });

export async function GET() {
  try {
    const u = await requireUser();
    if (!dbConfigured()) return NextResponse.json({ rows: [] });
    const rows = await q("select id, name, path, query, shared, owner_email from saved_views where owner_email = $1 or shared order by shared, name", [u.email]);
    return NextResponse.json({ rows });
  } catch (e) { return apiError(e); }
}

export async function POST(req: Request) {
  try {
    const u = await requireUser();
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const p = Body.safeParse(await req.json());
    if (!p.success) return NextResponse.json({ error: p.error.issues[0].message }, { status: 422 });
    const shared = p.data.shared && (u.role === "editor" || u.role === "admin");
    const rows = await q("insert into saved_views(owner_email, name, path, query, shared) values ($1,$2,$3,$4,$5) returning id", [u.email, p.data.name, p.data.path, p.data.query, shared]);
    return NextResponse.json({ id: rows[0].id });
  } catch (e) { return apiError(e); }
}

export async function DELETE(req: Request) {
  try {
    const u = await requireUser();
    const id = Number(new URL(req.url).searchParams.get("id"));
    await q("delete from saved_views where id = $1 and (owner_email = $2 or $3)", [id, u.email, u.role === "admin"]);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
