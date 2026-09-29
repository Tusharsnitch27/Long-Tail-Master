import "server-only";
import { addDays, startOfWeek, startOfMonth, diffDays } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { groupFacts, summarize, monthOutlook } from "./analytics";
import { catLabel } from "./views";
import type { Ctx } from "./context";
import type { Fact } from "./data/facts";

export const exceptionRanges = (asOf: string) => [{ from: addDays(asOf, -45), to: asOf }];

/** Per store × category signals used by every store-facing exception list. */
export function storeSignals(ctx: Ctx, facts: Fact[]) {
  const a = ctx.asOf;
  const ws = startOfWeek(a);
  const y = { from: a, to: a };
  const wtd = { from: ws, to: a };
  const lwSame = { from: addDays(ws, -7), to: addDays(a, -7) };
  const mtd = { from: startOfMonth(a), to: a };
  const ex = ctx.settings.exceptions;
  const net = new Map(ctx.filters.cats.map((c) => [c, summarize(facts.filter((f) => f.c === c), mtd).salesPerStoreDay]));
  const out = [];
  for (const [k, fs] of groupFacts(facts, (f) => `${f.b}|${f.c}`)) {
    const [b, c] = k.split("|");
    const st = ctx.byCode.get(b);
    const yd = summarize(fs, y), w = summarize(fs, wtd), lw = summarize(fs, lwSame), m = summarize(fs, mtd), mo = monthOutlook(fs, a);
    if ((m.target ?? 0) <= 0 && m.sales === 0 && w.sales === 0) continue;
    const lastSale = fs.filter((f) => f.s > 0 && f.d <= a).reduce<string | null>((x, f) => (!x || f.d > x ? f.d : x), null);
    const perDay = safeDiv(m.sales, m.days);
    const rel = safeDiv(perDay, net.get(c) ?? null);
    const rrrMultiple = safeDiv(mo.requiredRunRate, mo.currentRunRate);
    const flags: string[] = [];
    if ((yd.target ?? 0) > 0 && yd.sales <= 0) flags.push("Zero sale yesterday");
    else if (yd.ach != null && yd.ach < ctx.settings.thresholds.atRisk) flags.push("Below daily target");
    if ((w.target ?? 0) > 0 && w.sales <= 0) flags.push("Zero sale this week");
    else if (w.ach != null && w.ach < ctx.settings.thresholds.atRisk) flags.push("Below weekly target");
    const wow = growth(w.sales, lw.sales);
    if (wow != null && wow <= ex.wowDecline && lw.sales > 0) flags.push("Major WoW decline");
    if ((m.target ?? 0) > 0 && rel != null && rel < ex.lowPenetration) flags.push("Low category productivity");
    if (rrrMultiple != null && rrrMultiple >= ex.highRunRateMultiple && mo.remainingDays > 0) flags.push("High required run rate");
    out.push({
      b, c, store: st?.short_name ?? `Branch ${b}`, city: st?.city ?? null, region: st?.region ?? null, am: st?.am ?? null, category: catLabel(c),
      ySales: yd.sales, yTarget: yd.target, yAch: yd.ach, wSales: w.sales, wTarget: w.target, wAch: w.ach, lwSales: lw.sales, wow,
      mSales: m.sales, mTarget: m.target, mAch: m.ach, mGap: m.gap, mGapPct: m.target ? (m.target - m.sales) / m.target : null,
      rrr: mo.requiredRunRate, runRate: mo.currentRunRate, rrrMultiple, relProductivity: rel, lastSale, daysSince: lastSale ? diffDays(lastSale, a) : null,
      flags, flagText: flags.join(" · "), flagCount: flags.length,
      // priority: rupee gap to MTD target, amplified by the number of simultaneous problems
      score: flags.length ? Math.max(m.gap ?? 0, 0) * (1 + flags.length / 2) + flags.length : 0,
    });
  }
  return out;
}
export type StoreSignal = ReturnType<typeof storeSignals>[number];
