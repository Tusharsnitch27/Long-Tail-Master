import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, can } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { apiError } from "@/server/api";
import { addRemark, deactivateRemark, getRemark, listRemarks, REMARK_KINDS, REMARK_SCOPES } from "@/server/data/remarks";
import { CATEGORIES } from "@/lib/categories";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  scope: z.enum(REMARK_SCOPES as [string, ...string[]]),
  scope_id: z.string().max(200).nullish(),
  category: z.enum(CATEGORIES.map((c) => c.key) as [string, ...string[]]).nullish(),
  kind: z.enum(REMARK_KINDS as [string, ...string[]]),
  until: Day.nullish(),
  day: Day.nullish(),
  text: z.string().trim().min(3, "Write a short remark").max(600),
  action_key: z.string().max(200).nullish(),
}).superRefine((b, ctx) => {
  const need = (f: string, m: string) => ctx.addIssue({ code: "custom", path: [f], message: m });
  if (["action", "store", "product"].includes(b.scope) && !b.scope_id) need("scope_id", `A ${b.scope} is required for this scope`);
  if (b.scope === "store_category" && (!b.scope_id || !b.category)) need("scope_id", "Store and category are required");
  if (b.scope === "category" && !b.category && !b.scope_id) need("category", "Category is required");
  if (b.scope === "date" && !b.day) need("day", "Pick the date the remark is about");
  if (b.kind === "snooze" && !b.until) need("until", "Pick a date to snooze until");
  if (b.kind === "not_applicable" && (b.scope === "date" || b.scope === "general")) need("kind", "Not applicable needs an action, store, store × category, product or category");
});

/** Active team remarks. */
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ rows: await listRemarks() });
  } catch (e) { return apiError(e); }
}

/** Add a remark (any signed-in user). */
export async function POST(req: Request) {
  try {
    const u = await requireUser();
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "invalid", issues: p.error.issues }, { status: 400 });
    const b = p.data;
    const row = await addRemark({
      scope: b.scope as never, kind: b.kind as never, text: b.text, action_key: b.action_key ?? null,
      scope_id: b.scope === "category" ? (b.category ?? b.scope_id ?? null) : b.scope === "date" ? b.day ?? null : b.scope === "general" ? null : b.scope_id ?? null,
      category: b.scope === "category" ? (b.category ?? b.scope_id ?? null) : b.category ?? null,
      until: b.kind === "snooze" ? b.until ?? null : b.until ?? null,
      day: b.scope === "date" ? b.day ?? null : b.day ?? null,
    }, u.username);
    return NextResponse.json({ ok: true, remark: row });
  } catch (e) { return apiError(e); }
}

/** Deactivate a remark (its author or an admin). ?id=123 or {"id":123}. */
export async function DELETE(req: Request) {
  try {
    const u = await requireUser();
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const fromQs = new URL(req.url).searchParams.get("id");
    const body = fromQs ? null : await req.json().catch(() => null);
    const id = Number(fromQs ?? body?.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const r = await getRemark(id);
    if (!r) return NextResponse.json({ error: "Remark not found" }, { status: 404 });
    if (r.created_by !== u.username && !can(u, "admin")) return NextResponse.json({ error: "Only the author or an admin can remove this remark" }, { status: 403 });
    await deactivateRemark(id, u.username);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
