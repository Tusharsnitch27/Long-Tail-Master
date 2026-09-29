import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { invalidate } from "@/lib/cache";
import { apiError } from "@/server/api";

const Body = z.object({ key: z.string().min(1).max(200), status: z.enum(["open", "done", "dismissed"]), note: z.string().max(500).nullish() });

export async function POST(req: Request) {
  try {
    const u = await requireUser();
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const p = Body.safeParse(await req.json());
    if (!p.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
    await q(`insert into action_status(key, status, note, updated_by, updated_at) values ($1,$2,$3,$4,now())
             on conflict (key) do update set status = excluded.status, note = coalesce(excluded.note, action_status.note), updated_by = excluded.updated_by, updated_at = now()`,
      [p.data.key, p.data.status, p.data.note ?? null, u.username]);
    invalidate("actstatus");
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
