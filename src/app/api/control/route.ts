import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { saveMonthTargets, saveSplit, saveStoreTargets, splitCoverage } from "@/server/data/targetBook";
import { actualSplit, recommend, splitFactors, CHANNELS } from "@/server/splitModel";
import { getFreshness } from "@/server/data/freshness";
import { getSettings } from "@/server/settings";
import { startOfMonth } from "@/lib/dates";
import { saveProductMeta } from "@/server/data/metafields";
import { getStoreMap } from "@/server/data/stores";
import { CATEGORIES } from "@/lib/categories";
import { apiError } from "@/server/api";

const cat = z.string().refine((c) => CATEGORIES.some((x) => x.key === c), "unknown category");
const month = z.string().regex(/^\d{4}-\d{2}-01$/, "month must be YYYY-MM-01");
const channel = z.enum(["stores", "online", "marketplace"]);
const source = z.enum(["manual", "upload"]).default("manual");

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("month_targets"), source, rows: z.array(z.object({ channel, category: cat, month, target: z.number().min(0).max(1e11).nullable(), note: z.string().max(300).nullish() })).min(1).max(2000) }),
  z.object({ type: z.literal("splits"), source, channel, state: z.string().min(1).max(60), month, weights: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weight: z.number().min(0).max(1e6) })).max(31).nullable() }),
  z.object({ type: z.literal("store_targets"), source, rows: z.array(z.object({ branch_code: z.string().min(1), category: cat, month, target: z.number().min(0).max(1e10).nullable() })).min(1).max(5000) }),
  z.object({ type: z.literal("split_generate"), months: z.array(month).min(1).max(24), overwrite: z.boolean().default(false), dryRun: z.boolean().default(true) }),
  z.object({ type: z.literal("meta"), rows: z.array(z.object({ sku: z.string().min(3).max(40), attrs: z.record(z.string(), z.string().max(200)) })).min(1).max(5000) }),
]);

/** Control Centre writes (admin only). Every change is written to the audit log. */
export async function POST(req: Request) {
  try {
    const u = await requireUser("admin");
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const p = Body.safeParse(await req.json());
    if (!p.success) return NextResponse.json({ error: p.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 422 });
    const b = p.data;
    if (b.type === "month_targets") return NextResponse.json({ ok: true, ...(await saveMonthTargets(b.rows, u.username, b.source)) });
    if (b.type === "splits") {
      if (b.weights && b.weights.reduce((a, x) => a + x.weight, 0) <= 0) return NextResponse.json({ error: "Split weights must add up to more than zero." }, { status: 422 });
      await saveSplit(b.channel, b.state, b.month, b.weights, u.username, b.source);
      return NextResponse.json({ ok: true });
    }
    if (b.type === "store_targets") {
      const { byCode, byName } = await getStoreMap();
      const errors: string[] = [];
      const rows = b.rows.map((r, i) => {
        const s = byCode.get(r.branch_code) ?? byName.get(r.branch_code.toUpperCase()) ?? byName.get(`SNITCH - ${r.branch_code}`.toUpperCase());
        if (!s) errors.push(`row ${i + 1}: unknown store "${r.branch_code}"`);
        return { ...r, branch_code: s?.branch_code ?? r.branch_code };
      });
      if (errors.length) return NextResponse.json({ error: errors.slice(0, 8).join("; ") + (errors.length > 8 ? ` (+${errors.length - 8} more)` : "") }, { status: 422 });
      return NextResponse.json({ ok: true, rows: await saveStoreTargets(rows, u.username, b.source) });
    }
    if (b.type === "split_generate") {
      // past / current months → actual shape of sales; upcoming → recommendation. Hand-made splits are kept unless overwrite.
      const [{ asOf }, settings, cov] = await Promise.all([getFreshness(), getSettings(), splitCoverage(b.months[0], b.months[b.months.length - 1])]);
      const cur = startOfMonth(asOf);
      const f = await splitFactors(asOf, settings.enabledCategories);
      const plan: { month: string; channel: string; from: string; to: string; skip: boolean }[] = [];
      for (const m of b.months) for (const k of CHANNELS) {
        const existing = cov.find((c) => c.channel === k && c.state === "*" && c.month === m)?.source ?? null;
        const to = m <= cur ? "actual" : "recommended";
        plan.push({ month: m, channel: k, from: existing ?? "even", to, skip: !b.overwrite && (existing === "manual" || existing === "upload") });
      }
      if (b.dryRun) return NextResponse.json({ ok: true, plan });
      let written = 0;
      for (const x of plan) {
        if (x.skip) continue;
        const k = x.channel as (typeof CHANNELS)[number];
        const w = x.to === "actual" ? (await actualSplit(x.month, k, asOf, settings.enabledCategories, f)) ?? recommend(x.month, k, f) : recommend(x.month, k, f);
        await saveSplit(k, "*", x.month, w, u.username, x.to as "actual" | "recommended");
        written++;
      }
      return NextResponse.json({ ok: true, written, plan });
    }
    await saveProductMeta(b.rows, u.username);
    return NextResponse.json({ ok: true, rows: b.rows.length });
  } catch (e) { return apiError(e); }
}
