import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { apiError } from "@/server/api";
import { createRevamp, deleteRevamp, updateRevamp } from "@/server/data/vm";
import { getStoreMap } from "@/server/data/stores";
import { CATEGORIES } from "@/lib/categories";
import { VM_STAGES, VM_STATUSES } from "@/components/wip/vmStages";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const stage = z.enum(VM_STAGES.map((s) => s.key) as [string, ...string[]]);
const status = z.enum(VM_STATUSES.map((s) => s.key) as [string, ...string[]]);
const cat = z.string().refine((c) => CATEGORIES.some((x) => x.key === c), "unknown category");

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), branch_code: z.string().min(1).max(40), category: cat, owner: z.string().max(80).nullish(), target_date: date.nullish(), start_date: date.nullish(), stage: stage.optional(), note: z.string().max(1000).nullish() }),
  z.object({ op: z.literal("update"), id: z.number().int().positive(), stage: stage.optional(), status: status.optional(), owner: z.string().max(80).nullish(), target_date: date.nullish(), start_date: date.nullish(), live_date: date.nullish(), note: z.string().max(1000).nullish() }),
  z.object({ op: z.literal("delete"), id: z.number().int().positive() }),
]);

/**
 * VM revamp writes. Create / delete: admins. Stage, status, dates and notes: any signed-in user (the people running the
 * revamp on the ground). Every write is logged to audit_log and appended to the revamp's note trail.
 */
export async function POST(req: Request) {
  try {
    const u = await requireUser();
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const p = Body.safeParse(await req.json());
    if (!p.success) return NextResponse.json({ error: p.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 422 });
    const b = p.data;
    if (b.op === "create" || b.op === "delete") await requireUser("admin");
    if (b.op === "create") {
      const { byCode } = await getStoreMap();
      if (!byCode.has(b.branch_code)) return NextResponse.json({ error: `Unknown store "${b.branch_code}"` }, { status: 422 });
      const id = await createRevamp({ ...b, stage: b.stage as never }, u.username);
      return NextResponse.json({ ok: true, id });
    }
    if (b.op === "delete") { await deleteRevamp(b.id, u.username); return NextResponse.json({ ok: true }); }
    const { op: _op, id, ...patch } = b;
    await updateRevamp(id, patch as never, u.username);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
