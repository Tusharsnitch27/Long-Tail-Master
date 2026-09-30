import "server-only";
import { diffDays, eachDay, endOfMonth, startOfMonth, addMonths, minDate, addDays } from "@/lib/dates";
import { safeDiv, type Thresholds } from "@/lib/metrics";
import { catByKey } from "@/lib/categories";
import type { Fact } from "./data/facts";
import type { ChannelDay } from "./data/channels";
import { channelMetrics, ucChannel, CH_LABEL, type ChKey } from "./channelData";
import type { TargetBook } from "./data/targetBook";

export type PlanChannel = ChKey | "all";
export type ExecStatus = "ahead" | "on_track" | "at_risk" | "behind" | "no_target";
export const EXEC_LABEL: Record<ExecStatus, string> = { ahead: "Ahead of plan", on_track: "On track", at_risk: "At risk", behind: "Behind plan", no_target: "Target not set" };

/** One channel × category slice of the month plan. */
export interface PlanPart { k: ChKey; c: string; rev: number; month: number | null; toDate: number | null; storeSum?: number; catTarget?: number | null }

export interface Plan {
  channel: PlanChannel;
  month: string;
  asOf: string;
  parts: PlanPart[];
  /** channels with at least one category target */
  covered: ChKey[];
  missing: ChKey[];
  /** "channel · category" pairs without a target */
  missingPairs: string[];
  targetNote: string | null;
  monthTarget: number | null;
  mtdTarget: number | null;
  mtdRevenue: number;
  coveredRevenue: number;
  achievement: number | null;
  targetAchievedPct: number | null;
  expectedPct: number | null;
  timeElapsedPct: number;
  daysInMonth: number; elapsed: number; remainingDays: number;
  gapToDate: number | null; remaining: number | null;
  currentRunRate: number; requiredRunRate: number | null; runRateGap: number | null;
  projected: number; projectedAch: number | null; projectedGap: number | null;
  pace: "ahead" | "on_pace" | "behind" | null;
  status: ExecStatus;
  /** Stores: plan category target vs Σ store targets differ by >1% (the plan is used) */
  mismatches: { c: string; catTarget: number; storeSum: number }[];
}

/**
 * Month plan as of the last complete day. Targets are never inferred.
 * Stores: the Control Centre (plan) category target; phased by the Stores daily split, else by the shape of the store
 * targets, else evenly. Store targets alone are used only when the plan has no Stores target. Online / Marketplace: month target × daily split.
 */
export function computePlan(facts: Fact[], uc: ChannelDay[], asOf: string, channel: PlanChannel, book: TargetBook, cats: string[], th: Thresholds): Plan {
  const ms = startOfMonth(asOf), me = endOfMonth(asOf);
  const daysInMonth = diffDays(ms, me) + 1, elapsed = diffDays(ms, asOf) + 1, remainingDays = daysInMonth - elapsed;
  const mtd = { from: ms, to: asOf };
  const chans: ChKey[] = channel === "all" ? ["stores", "online", "marketplace"] : [channel];
  const parts: PlanPart[] = [];
  const mismatches: Plan["mismatches"] = [];
  for (const k of chans) for (const c of cats) {
    const f = facts.filter((x) => x.c === c), u = uc.filter((x) => x.c === c);
    const rev = channelMetrics(f, u, mtd, k).revenue;
    const catT = book.month(k, [c], ms);
    if (k === "stores") {
      // the plan's category target always wins; store targets (Snowflake or uploaded) only phase it across days and stores
      let storeSum = 0, storeToDate = 0, has = false;
      for (const x of f) if (x.d >= ms && x.d <= me && x.t != null) { has = true; storeSum += x.t; if (x.d <= asOf) storeToDate += x.t; }
      if (catT != null && has && storeSum > 0 && Math.abs(catT - storeSum) > Math.max(catT, storeSum) * 0.01) mismatches.push({ c, catTarget: catT, storeSum });
      const shape = !book.hasSplit("stores", ms) && has && storeSum > 0;
      const month = catT ?? (has && storeSum > 0 ? storeSum : null);
      const toDate = month == null ? null : catT == null ? storeToDate : shape ? (catT * storeToDate) / storeSum : catT * book.cumShare("stores", asOf);
      parts.push({ k, c, rev, month, toDate, storeSum: has ? storeSum : 0, catTarget: catT });
    } else {
      parts.push({ k, c, rev, month: catT, toDate: catT != null ? catT * book.cumShare(k, asOf) : null });
    }
  }
  const covered = parts.filter((p) => p.month != null);
  const mtdRevenue = parts.reduce((a, p) => a + p.rev, 0);
  const coveredRevenue = covered.reduce((a, p) => a + p.rev, 0);
  const monthTarget = covered.length ? covered.reduce((a, p) => a + (p.month ?? 0), 0) : null;
  const mtdTarget = covered.length ? covered.reduce((a, p) => a + (p.toDate ?? 0), 0) : null;
  // projection: phasing-aware where a target exists (MTD achievement × month target), else the current daily rate
  const projOf = (p: PlanPart) => (p.month != null && p.toDate ? (p.rev / p.toDate) * p.month : (p.rev / elapsed) * daysInMonth);
  const projected = parts.reduce((a, p) => a + projOf(p), 0);
  const projectedCovered = covered.reduce((a, p) => a + projOf(p), 0);
  const remaining = monthTarget == null ? null : Math.max(monthTarget - coveredRevenue, 0);
  const requiredRunRate = remaining == null ? null : remainingDays > 0 ? remaining / remainingDays : null;
  const coveredRate = coveredRevenue / elapsed;
  const achievement = safeDiv(coveredRevenue, mtdTarget);
  const targetAchievedPct = safeDiv(coveredRevenue, monthTarget);
  const expectedPct = safeDiv(mtdTarget, monthTarget);
  const projectedAch = safeDiv(projectedCovered, monthTarget);
  const pace = targetAchievedPct == null || expectedPct == null ? null : targetAchievedPct >= expectedPct * 1.02 ? "ahead" : targetAchievedPct >= expectedPct * 0.98 ? "on_pace" : "behind";
  const status: ExecStatus = projectedAch == null ? "no_target" : projectedAch >= th.ahead ? "ahead" : projectedAch >= th.onTrack ? "on_track" : projectedAch >= th.atRisk ? "at_risk" : "behind";
  const coveredCh = chans.filter((k) => covered.some((p) => p.k === k));
  const missingPairs = parts.filter((p) => p.month == null).map((p) => `${CH_LABEL[p.k]} · ${catByKey(p.c)?.label ?? p.c}`);
  const note = !covered.length ? "Target not set for this selection"
    : missingPairs.length ? `Target excludes ${missingPairs.length <= 3 ? missingPairs.join(", ") : `${missingPairs.length} channel × category slices`} (no target set) — achievement compares like for like` : null;
  return {
    channel, month: ms, asOf, parts, covered: coveredCh, missing: chans.filter((k) => !coveredCh.includes(k)), missingPairs, targetNote: note,
    monthTarget, mtdTarget, mtdRevenue, coveredRevenue, achievement, targetAchievedPct, expectedPct, timeElapsedPct: elapsed / daysInMonth,
    daysInMonth, elapsed, remainingDays, gapToDate: mtdTarget == null ? null : mtdTarget - coveredRevenue, remaining,
    currentRunRate: covered.length ? coveredRate : mtdRevenue / elapsed, requiredRunRate, runRateGap: requiredRunRate == null ? null : safeDiv(requiredRunRate - coveredRate, coveredRate),
    projected, projectedAch, projectedGap: monthTarget == null ? null : monthTarget - projectedCovered, pace, status, mismatches,
  };
}

const storeDayIdx = new WeakMap<Fact[], Map<string, number>>();
function storeDayTarget(facts: Fact[], c: string, d: string) {
  let m = storeDayIdx.get(facts);
  if (!m) { m = new Map(); for (const f of facts) if (f.t != null) m.set(`${f.c}|${f.d}`, (m.get(`${f.c}|${f.d}`) ?? 0) + f.t); storeDayIdx.set(facts, m); }
  return m.get(`${c}|${d}`) ?? 0;
}

/** Daily target for the covered slices of a plan (for daily charts / tables). */
export function dailyTarget(plan: Plan, facts: Fact[], book: TargetBook, day: string) {
  if (startOfMonth(day) !== plan.month) return null;
  let t = 0, any = false;
  for (const p of plan.parts) {
    if (p.month == null) continue;
    any = true;
    if (p.k === "stores") {
      const storeDay = storeDayTarget(facts, p.c, day);
      if (p.catTarget == null) t += storeDay;
      else if (!book.hasSplit("stores", day) && (p.storeSum ?? 0) > 0) t += (p.catTarget * storeDay) / (p.storeSum as number);
      else t += p.catTarget * book.share("stores", day);
    } else t += p.month * book.share(p.k, day);
  }
  return any ? t : null;
}

/** Cumulative month curves: current month vs previous month (same day-of-month) vs target pace. */
export function cumulativeCurves(facts: Fact[], uc: ChannelDay[], asOf: string, channel: PlanChannel, plan: Plan, book: TargetBook) {
  const ms = startOfMonth(asOf), me = endOfMonth(asOf);
  const pm = addMonths(ms, -1), pme = endOfMonth(pm);
  const chans: ChKey[] = channel === "all" ? ["stores", "online", "marketplace"] : [channel];
  const coveredPairs = new Set(plan.parts.filter((p) => p.month != null).map((p) => `${p.k}|${p.c}`));
  const day = (d: string) => {
    let rev = 0, units = 0, cov = 0;
    for (const k of chans) for (const c of new Set(plan.parts.map((p) => p.c))) {
      const m = channelMetrics(facts.filter((f) => f.c === c), uc.filter((x) => x.c === c), { from: d, to: d }, k);
      rev += m.revenue; units += m.units; if (coveredPairs.has(`${k}|${c}`)) cov += m.revenue;
    }
    return { rev, units, cov };
  };
  let cr = 0, cu = 0, cc = 0, pr = 0, pu = 0, ct = 0;
  const pmDays = eachDay(pm, pme);
  return eachDay(ms, me).map((d, i) => {
    const pd = pmDays[i];
    if (pd) { const x = day(pd); pr += x.rev; pu += x.units; }
    ct += dailyTarget(plan, facts, book, d) ?? 0;
    const isPast = d <= asOf;
    if (isPast) { const x = day(d); cr += x.rev; cu += x.units; cc += x.cov; }
    return {
      day: String(i + 1),
      revenue: isPast ? cr : null, units: isPast ? cu : null, prevRevenue: pd ? pr : null, prevUnits: pd ? pu : null,
      targetBasis: isPast && plan.monthTarget != null ? cc : null,
      targetPace: plan.monthTarget != null ? ct : null,
      achievement: isPast && plan.monthTarget != null && ct > 0 ? cc / ct : null,
    };
  });
}

export const prevMonthSameDays = (asOf: string) => { const pm = addMonths(startOfMonth(asOf), -1); return { from: pm, to: minDate(addDays(pm, Number(asOf.slice(8)) - 1), endOfMonth(pm)) }; };
export { ucChannel };
