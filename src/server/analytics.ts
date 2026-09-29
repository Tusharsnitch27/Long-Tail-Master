import "server-only";
import type { Fact } from "./data/facts";
import type { Store } from "./data/stores";
import { type Filters, STORE_DIMS } from "@/lib/filters";
import { type Range, inRange, rangeDays, eachDay, startOfMonth, endOfMonth, diffDays, addDays } from "@/lib/dates";
import { safeDiv, growth, targetStatus, type Thresholds, type TargetStatus } from "@/lib/metrics";

export interface Metrics {
  sales: number;
  qty: number;
  bills: number | null;
  mrp: number;
  target: number | null;
  ach: number | null;
  gap: number | null;
  asp: number | null;
  atv: number | null;
  upt: number | null;
  disc: number | null;
  days: number;
  stores: number;
  storesSelling: number;
  storesWithTarget: number;
  salesPerStore: number | null;
  unitsPerStore: number | null;
  salesPerDay: number | null;
  salesPerStoreDay: number | null;
  unitsPerStoreDay: number | null;
}

/** Predicate over branch codes for the active store filters (null = no store filter). */
export function storeMatcher(f: Filters, byCode: Map<string, Store>): ((b: string) => boolean) | null {
  const dims = STORE_DIMS.map((d) => ({ field: d.field, values: new Set((f[d.key as keyof Filters] as string[]).map((v) => v.toUpperCase())) })).filter((d) => d.values.size);
  const storeSet = f.stores.length ? new Set(f.stores) : null;
  if (!storeSet && !dims.length) return null;
  return (b: string) => {
    if (storeSet && !storeSet.has(b)) return false;
    if (!dims.length) return true;
    const s = byCode.get(b);
    return !!s && dims.every((d) => d.values.has(String(s[d.field as keyof Store] ?? "").toUpperCase()));
  };
}

/** Keep facts matching category + store filters. */
export function filterFacts(facts: Fact[], f: Filters, byCode: Map<string, Store>): Fact[] {
  const catSet = new Set(f.cats);
  const m = storeMatcher(f, byCode);
  return facts.filter((x) => catSet.has(x.c) && (!m || m(x.b)));
}

export function summarize(facts: Fact[], range: Range): Metrics {
  let sales = 0, qty = 0, bills = 0, hasBills = false, mrp = 0, target = 0, hasTarget = false;
  const stores = new Set<string>(), selling = new Set<string>(), withTarget = new Set<string>();
  for (const f of facts) {
    if (!inRange(f.d, range)) continue;
    sales += f.s; qty += f.q; mrp += f.m;
    if (f.n != null) { bills += f.n; hasBills = true; }
    if (f.t != null) { target += f.t; hasTarget = true; if (f.t > 0) withTarget.add(f.b); }
    if (f.s !== 0 || f.q !== 0) selling.add(f.b);
    if (f.s !== 0 || (f.t ?? 0) > 0) stores.add(f.b);
  }
  const days = rangeDays(range);
  const t = hasTarget ? target : null;
  return {
    sales, qty, bills: hasBills ? bills : null, mrp, target: t,
    ach: safeDiv(sales, t), gap: t == null ? null : t - sales,
    asp: safeDiv(sales, qty), atv: hasBills ? safeDiv(sales, bills) : null, upt: hasBills ? safeDiv(qty, bills) : null,
    disc: mrp > 0 ? 1 - sales / mrp : null,
    days, stores: stores.size, storesSelling: selling.size, storesWithTarget: withTarget.size,
    salesPerStore: safeDiv(sales, stores.size), unitsPerStore: safeDiv(qty, stores.size),
    salesPerDay: safeDiv(sales, days),
    salesPerStoreDay: safeDiv(sales, stores.size * days), unitsPerStoreDay: safeDiv(qty, stores.size * days),
  };
}

export function groupFacts<K extends string>(facts: Fact[], key: (f: Fact) => K): Map<K, Fact[]> {
  const m = new Map<K, Fact[]>();
  for (const f of facts) { const k = key(f); let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(f); }
  return m;
}

/** Month context for a day: full-month target, target-to-date, projection and required run rate. */
export function monthOutlook(facts: Fact[], asOf: string) {
  const ms = startOfMonth(asOf), me = endOfMonth(asOf);
  let mtdSales = 0, mtdTarget = 0, monthTarget = 0, hasT = false;
  for (const f of facts) {
    if (f.d < ms || f.d > me) continue;
    if (f.t != null) { monthTarget += f.t; hasT = true; if (f.d <= asOf) mtdTarget += f.t; }
    if (f.d <= asOf) mtdSales += f.s;
  }
  const remainingDays = diffDays(asOf, me);
  const elapsed = diffDays(ms, asOf) + 1;
  const mt = hasT ? monthTarget : null;
  // Phasing-aware projection: MTD achievement applied to the full-month target; linear run-rate when no target.
  const projected = mt && mtdTarget > 0 ? (mtdSales / mtdTarget) * mt : (mtdSales / elapsed) * (elapsed + remainingDays);
  const remaining = mt == null ? null : Math.max(mt - mtdSales, 0);
  return {
    mtdSales, mtdTarget: hasT ? mtdTarget : null, monthTarget: mt, projected,
    projectedAch: safeDiv(projected, mt), remainingDays, elapsed,
    requiredRunRate: remaining == null ? null : remainingDays > 0 ? remaining / remainingDays : null,
    currentRunRate: mtdSales / elapsed,
  };
}

export function dailySeries(facts: Fact[], range: Range) {
  const byDay = groupFacts(facts, (f) => f.d);
  return eachDay(range.from, range.to).map((d) => {
    const rows = byDay.get(d) ?? [];
    let s = 0, q = 0, t = 0, ht = false; const sell = new Set<string>();
    for (const f of rows) { s += f.s; q += f.q; if (f.t != null) { t += f.t; ht = true; } if (f.s !== 0) sell.add(f.b); }
    return { date: d, sales: s, qty: q, target: ht ? t : null, ach: safeDiv(s, ht ? t : null), stores: sell.size };
  });
}

export interface StoreRow extends Metrics {
  branch_code: string;
  store: string;
  state: string | null;
  region: string | null;
  city: string | null;
  om: string | null;
  am: string | null;
  prevSales: number;
  growth: number | null;
  status: TargetStatus;
  byCat: Record<string, { sales: number; qty: number; target: number | null; ach: number | null; prev: number; growth: number | null }>;
  rank?: number;
}

export function storeRows(facts: Fact[], range: Range, compare: Range, byCode: Map<string, Store>, th: Thresholds, cats: string[]): StoreRow[] {
  const g = groupFacts(facts, (f) => f.b);
  const rows: StoreRow[] = [];
  for (const [b, fs] of g) {
    const m = summarize(fs, range);
    const p = summarize(fs, compare);
    if (m.stores === 0 && p.sales === 0) continue;
    const s = byCode.get(b);
    const byCat: StoreRow["byCat"] = {};
    for (const c of cats) {
      const cf = fs.filter((f) => f.c === c);
      const cm = summarize(cf, range), cp = summarize(cf, compare);
      byCat[c] = { sales: cm.sales, qty: cm.qty, target: cm.target, ach: cm.ach, prev: cp.sales, growth: growth(cm.sales, cp.sales) };
    }
    rows.push({
      ...m, branch_code: b, store: s?.short_name ?? `Branch ${b}`, state: s?.state ?? null, region: s?.region ?? null, city: s?.city ?? null,
      om: s?.operating_model ?? null, am: s?.am ?? null, prevSales: p.sales, growth: growth(m.sales, p.sales),
      status: targetStatus(m.sales, m.target, th), byCat,
    });
  }
  rows.sort((a, b) => b.sales - a.sales).forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function weekStarts(from: string, to: string) {
  const out: string[] = [];
  for (let d = addDays(from, -((new Date(from + "T00:00:00Z").getUTCDay() + 6) % 7)); d <= to; d = addDays(d, 7)) out.push(d);
  return out;
}

export function statusCounts(facts: Fact[], range: Range, th: Thresholds) {
  const out: Record<TargetStatus, number> = { ahead: 0, on_track: 0, at_risk: 0, behind: 0, no_target: 0 };
  for (const [, fs] of groupFacts(facts, (f) => f.b)) {
    const m = summarize(fs, range);
    if (m.stores === 0) continue;
    out[targetStatus(m.sales, m.target, th)]++;
  }
  return out;
}
