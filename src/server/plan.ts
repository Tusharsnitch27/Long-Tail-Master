import "server-only";
import { diffDays, eachDay, endOfMonth, startOfMonth, addMonths, minDate, addDays } from "@/lib/dates";
import { safeDiv, type Thresholds } from "@/lib/metrics";
import type { Fact } from "./data/facts";
import type { ChannelDay } from "./data/channels";
import { channelMetrics, ucChannel, type ChKey } from "./channelData";
import { channelMonthTarget, type ChannelTarget } from "./data/channelTargets";

export type PlanChannel = ChKey | "all";
export type ExecStatus = "ahead" | "on_track" | "at_risk" | "behind" | "no_target";
export const EXEC_LABEL: Record<ExecStatus, string> = { ahead: "Ahead of Plan", on_track: "On Track", at_risk: "At Risk", behind: "Behind Plan", no_target: "Target not configured" };

export interface Plan {
  channel: PlanChannel;
  month: string;
  asOf: string;
  /** channels whose target is included (Overall only sums channels that have a target) */
  covered: ChKey[];
  missing: ChKey[];
  targetNote: string | null;
  monthTarget: number | null;
  mtdTarget: number | null;
  mtdRevenue: number; // all channels in scope (for display)
  coveredRevenue: number; // revenue of channels that have a target (achievement basis)
  achievement: number | null; // covered revenue ÷ MTD target (to date)
  targetAchievedPct: number | null; // covered revenue ÷ month target
  expectedPct: number | null; // share of the month target phased into the days so far
  timeElapsedPct: number;
  daysInMonth: number; elapsed: number; remainingDays: number;
  gapToDate: number | null; remaining: number | null;
  currentRunRate: number; requiredRunRate: number | null; runRateGap: number | null;
  projected: number; projectedAch: number | null; projectedGap: number | null;
  pace: "ahead" | "on_pace" | "behind" | null;
  status: ExecStatus;
}

/** Month plan for a channel (or overall) as of the last complete day. Targets are never inferred. */
export function computePlan(facts: Fact[], uc: ChannelDay[], asOf: string, channel: PlanChannel, chTargets: ChannelTarget[], cats: string[], th: Thresholds): Plan {
  const ms = startOfMonth(asOf), me = endOfMonth(asOf);
  const daysInMonth = diffDays(ms, me) + 1, elapsed = diffDays(ms, asOf) + 1, remainingDays = daysInMonth - elapsed;
  const mtd = { from: ms, to: asOf };
  const chans: ChKey[] = channel === "all" ? ["stores", "online", "marketplace"] : [channel];
  const parts = chans.map((k) => {
    const rev = channelMetrics(facts, uc, mtd, k).revenue;
    if (k === "stores") {
      let month = 0, toDate = 0, has = false;
      for (const f of facts) if (f.d >= ms && f.d <= me && f.t != null) { has = true; month += f.t; if (f.d <= asOf) toDate += f.t; }
      return { k, rev, month: has && month > 0 ? month : null, toDate: has ? toDate : null, phased: true };
    }
    const month = channelMonthTarget(chTargets, k, cats);
    return { k, rev, month, toDate: month == null ? null : (month * elapsed) / daysInMonth, phased: false };
  });
  const covered = parts.filter((p) => p.month != null);
  const mtdRevenue = parts.reduce((a, p) => a + p.rev, 0);
  const coveredRevenue = covered.reduce((a, p) => a + p.rev, 0);
  const monthTarget = covered.length ? covered.reduce((a, p) => a + (p.month ?? 0), 0) : null;
  const mtdTarget = covered.length ? covered.reduce((a, p) => a + (p.toDate ?? 0), 0) : null;
  // projection: per channel — phasing-aware where a target shape exists, otherwise the current daily rate
  const projOf = (p: (typeof parts)[number]) => (p.month != null && p.toDate ? (p.rev / p.toDate) * p.month : (p.rev / elapsed) * daysInMonth);
  const projected = parts.reduce((a, p) => a + projOf(p), 0);
  const projectedCovered = covered.reduce((a, p) => a + projOf(p), 0);
  const currentRunRate = mtdRevenue / elapsed;
  const remaining = monthTarget == null ? null : Math.max(monthTarget - coveredRevenue, 0);
  const requiredRunRate = remaining == null ? null : remainingDays > 0 ? remaining / remainingDays : null;
  const coveredRate = coveredRevenue / elapsed;
  const achievement = safeDiv(coveredRevenue, mtdTarget);
  const targetAchievedPct = safeDiv(coveredRevenue, monthTarget);
  const expectedPct = safeDiv(mtdTarget, monthTarget);
  const projectedAch = safeDiv(projectedCovered, monthTarget);
  const pace = targetAchievedPct == null || expectedPct == null ? null : targetAchievedPct >= expectedPct * 1.02 ? "ahead" : targetAchievedPct >= expectedPct * 0.98 ? "on_pace" : "behind";
  const status: ExecStatus = projectedAch == null ? "no_target" : projectedAch >= th.ahead ? "ahead" : projectedAch >= th.onTrack ? "on_track" : projectedAch >= th.atRisk ? "at_risk" : "behind";
  const missing = parts.filter((p) => p.month == null).map((p) => p.k);
  return {
    channel, month: ms, asOf, covered: covered.map((p) => p.k), missing,
    targetNote: !covered.length ? "Target not configured" : missing.length && channel === "all" ? `Target covers ${covered.map((p) => p.k).join(" + ")} only; ${missing.join(", ")} target not configured` : null,
    monthTarget, mtdTarget, mtdRevenue, coveredRevenue, achievement, targetAchievedPct, expectedPct, timeElapsedPct: elapsed / daysInMonth,
    daysInMonth, elapsed, remainingDays, gapToDate: mtdTarget == null ? null : mtdTarget - coveredRevenue, remaining,
    currentRunRate: covered.length ? coveredRate : currentRunRate, requiredRunRate, runRateGap: requiredRunRate == null ? null : safeDiv(requiredRunRate - coveredRate, coveredRate),
    projected, projectedAch, projectedGap: monthTarget == null ? null : monthTarget - projectedCovered, pace, status,
  };
}

/** Cumulative month curves for the executive trend: current month vs previous month (same day-of-month) vs target pace. */
export function cumulativeCurves(facts: Fact[], uc: ChannelDay[], asOf: string, channel: PlanChannel, plan: Plan) {
  const ms = startOfMonth(asOf), me = endOfMonth(asOf);
  const pm = addMonths(ms, -1), pme = endOfMonth(pm);
  const chans: ChKey[] = channel === "all" ? ["stores", "online", "marketplace"] : [channel];
  const day = (d: string) => {
    let rev = 0, units = 0, cov = 0;
    for (const k of chans) { const m = channelMetrics(facts, uc, { from: d, to: d }, k); rev += m.revenue; units += m.units; if (plan.covered.includes(k)) cov += m.revenue; }
    return { rev, units, cov };
  };
  const tgtShape = new Map<string, number>();
  if (plan.covered.includes("stores")) for (const f of facts) if (f.d >= ms && f.d <= me && f.t != null) tgtShape.set(f.d, (tgtShape.get(f.d) ?? 0) + f.t);
  const evenPart = plan.covered.filter((k) => k !== "stores").length && plan.monthTarget != null
    ? (plan.monthTarget - [...tgtShape.values()].reduce((a, v) => a + v, 0)) / plan.daysInMonth : 0;
  let cr = 0, cu = 0, cc = 0, pr = 0, pu = 0, ct = 0;
  const pmDays = eachDay(pm, pme);
  return eachDay(ms, me).map((d, i) => {
    const pd = pmDays[i];
    if (pd) { const x = day(pd); pr += x.rev; pu += x.units; }
    ct += (tgtShape.get(d) ?? 0) + evenPart;
    const isPast = d <= asOf;
    if (isPast) { const x = day(d); cr += x.rev; cu += x.units; cc += x.cov; }
    return {
      day: String(i + 1),
      revenue: isPast ? cr : null, units: isPast ? cu : null, prevRevenue: pd ? pr : null, prevUnits: pd ? pu : null,
      // revenue of the channels that carry a target — the like-for-like line for target pace
      targetBasis: isPast && plan.monthTarget != null ? cc : null,
      targetPace: plan.monthTarget != null ? ct : null,
      achievement: isPast && plan.monthTarget != null && ct > 0 ? cc / ct : null, // covered channels only
    };
  });
}

export const prevMonthSameDays = (asOf: string) => { const pm = addMonths(startOfMonth(asOf), -1); return { from: pm, to: minDate(addDays(pm, Number(asOf.slice(8)) - 1), endOfMonth(pm)) }; };
export { ucChannel };
