import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { apiError } from "@/server/api";
import { deleteFutureInward, saveFutureInwards } from "@/server/data/futureInwards";
import { CATEGORIES } from "@/lib/categories";
import { INWARD_STATUSES } from "@/components/wip/vmStages";

const cat = z.string().transform((c) => CATEGORIES.find((x) => x.key === c.toLowerCase() || x.label.toLowerCase() === c.toLowerCase() || x.salesCategory.toLowerCase() === c.toLowerCase())?.key ?? c)
  .refine((c) => CATEGORIES.some((x) => x.key === c), "unknown category");
const Row = z.object({
  id: z.number().int().positive().nullish(),
  category: cat,
  design: z.string().trim().min(1, "design is required").max(200),
  sku_group: z.string().trim().max(40).nullish(),
  kind: z.enum(["new", "repeat"]),
  qty: z.number().int().min(0).max(1e7),
  expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected_date must be YYYY-MM-DD").nullish(),
  warehouse: z.string().trim().max(60).nullish(),
  status: z.enum(INWARD_STATUSES).default("planned"),
  note: z.string().max(500).nullish(),
});
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("save"), source: z.enum(["manual", "upload"]).default("manual"), rows: z.array(Row).min(1).max(3000) }),
  z.object({ op: z.literal("delete"), id: z.number().int().positive() }),
]);

/** Future inwards: any signed-in user can add / edit (category teams own the plan); delete is admin-only. Logged to audit_log. */
export async function POST(req: Request) {
  try {
    const u = await requireUser();
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const p = Body.safeParse(await req.json());
    if (!p.success) return NextResponse.json({ error: p.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 422 });
    const b = p.data;
    if (b.op === "delete") { await requireUser("admin"); await deleteFutureInward(b.id, u.username); return NextResponse.json({ ok: true }); }
    const rows = b.rows.map((r) => ({ ...r, sku_group: r.sku_group || null, expected_date: r.expected_date || null, warehouse: r.warehouse || null, note: r.note || null }));
    return NextResponse.json({ ok: true, ...(await saveFutureInwards(rows, u.username, b.source)) });
  } catch (e) { return apiError(e); }
}
