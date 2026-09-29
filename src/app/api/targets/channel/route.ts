import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { saveChannelTargets } from "@/server/data/channelTargets";
import { CATEGORIES } from "@/lib/categories";
import { apiError } from "@/server/api";

const Row = z.object({
  channel: z.enum(["online", "marketplace"]),
  category: z.string().refine((c) => c === "*" || CATEGORIES.some((x) => x.key === c), "unknown category"),
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "month must be YYYY-MM-01"),
  target: z.number().min(0).max(1e10).nullable(),
});

export async function POST(req: Request) {
  try {
    const u = await requireUser("admin");
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const p = z.object({ rows: z.array(Row).min(1).max(50) }).safeParse(await req.json());
    if (!p.success) return NextResponse.json({ error: p.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    await saveChannelTargets(p.data.rows, u.username);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
