import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { saveSetting } from "@/server/settings";
import { CATEGORIES } from "@/lib/categories";
import { apiError } from "@/server/api";

const Body = z.object({
  thresholds: z.object({ ahead: z.number().min(0.5).max(3), onTrack: z.number().min(0.3).max(3), atRisk: z.number().min(0).max(3) })
    .refine((t) => t.ahead >= t.onTrack && t.onTrack >= t.atRisk, "thresholds must be ordered: ahead ≥ on track ≥ at risk"),
  exceptions: z.object({ wowDecline: z.number().min(-1).max(0), lowPenetration: z.number().min(0).max(1), highRunRateMultiple: z.number().min(1).max(20), fewStores: z.number().int().min(1).max(200) }),
  enabledCategories: z.array(z.string().refine((c) => CATEGORIES.some((x) => x.key === c))).min(1),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser("admin");
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const p = Body.safeParse(await req.json());
    if (!p.success) return NextResponse.json({ error: p.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    for (const k of ["thresholds", "exceptions", "enabledCategories"] as const) await saveSetting(k, p.data[k], user.email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
