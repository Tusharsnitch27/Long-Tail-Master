import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { invalidate } from "@/lib/cache";
import { apiError } from "@/server/api";

const Body = z.object({ email: z.string().email().transform((e) => e.toLowerCase()), role: z.enum(["viewer", "editor", "admin"]), active: z.boolean().default(true) });

export async function POST(req: Request) {
  try {
    const actor = await requireUser("admin");
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const p = Body.safeParse(await req.json());
    if (!p.success) return NextResponse.json({ error: p.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    const { email, role, active } = p.data;
    if (email === actor.email && (role !== "admin" || !active)) return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });
    await q(`insert into app_users(email, role, active) values ($1,$2,$3) on conflict (email) do update set role = excluded.role, active = excluded.active`, [email, role, active]);
    await q("insert into audit_log(actor, action, entity, entity_id, detail) values ($1,'upsert','user',$2,$3)", [actor.email, email, JSON.stringify({ role, active })]);
    invalidate(`user:${email}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
