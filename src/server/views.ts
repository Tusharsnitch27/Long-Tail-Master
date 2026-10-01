import "server-only";
import { catByKey } from "@/lib/categories";
import { addDays, startOfWeek, startOfMonth, addMonths, minDate, endOfMonth, type Range } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { inr, num, pct } from "@/lib/format";
import type { Fact } from "./data/facts";
import { summarize, monthOutlook, dailySeries } from "./analytics";
import type { Ctx } from "./context";
import type { SkuStoreFact } from "./data/sku";
import type { Product } from "./data/products";

export const catLabel = (k: string) => catByKey(k)?.label ?? k;
export const catColor = (k: string) => catByKey(k)?.color ?? "#7a6c5d";

/** Rows = metrics, columns = categories + total. Values pre-formatted for a compact server-rendered table. */
export function categoryComparison(ctx: Ctx, facts: Fact[]) {
  const cats = ctx.filters.cats;
  const cols = [...cats.map((c) => ({ key: c, label: catLabel(c), facts: facts.filter((f) => f.c === c) })), ...(cats.length > 1 ? [{ key: "total", label: "Total", facts }] : [])];
  const data = cols.map((c) => {
    const m = summarize(c.facts, ctx.period.range);
    const p = summarize(c.facts, ctx.period.compare);
    const mo = monthOutlook(c.facts, ctx.asOf);
    return { ...c, m, p, mo };
  });
  const rows: { label: string; tip?: string; values: string[]; deltas?: (number | null)[] }[] = [
    { label: "Revenue", values: data.map((d) => inr(d.m.sales)), deltas: data.map((d) => growth(d.m.sales, d.p.sales)) },
    { label: "Units", values: data.map((d) => num(d.m.qty)), deltas: data.map((d) => growth(d.m.qty, d.p.qty)) },
    { label: "Bills", values: data.map((d) => num(d.m.bills)) },
    { label: "Target", values: data.map((d) => inr(d.m.target)) },
    { label: "Achievement", values: data.map((d) => pct(d.m.ach)), tip: "Revenue ÷ target for the selected dates" },
    { label: "Gap to target", values: data.map((d) => (d.m.gap == null ? "—" : d.m.gap > 0 ? inr(d.m.gap) : `+${inr(-d.m.gap)} over`)) },
    { label: "Stores selling", values: data.map((d) => `${d.m.storesSelling} / ${d.m.stores}`), tip: "Stores with ≥1 sale ÷ stores with a target or sale" },
    { label: "Sales / store / day", values: data.map((d) => inr(d.m.salesPerStoreDay)) },
    { label: "Units / store / day", values: data.map((d) => num(d.m.unitsPerStoreDay, 2)) },
    { label: "ASP", values: data.map((d) => inr(d.m.asp, { compact: false })), tip: "Average selling price = revenue ÷ units" },
    { label: "Discount", values: data.map((d) => pct(d.m.disc)), tip: "1 − revenue ÷ MRP value" },
    { label: "MTD achievement", values: data.map((d) => pct(safeDiv(d.mo.mtdSales, d.mo.mtdTarget))) },
    { label: "Projected month", values: data.map((d) => `${inr(d.mo.projected)} (${pct(d.mo.projectedAch, 0)})`), tip: "MTD achievement % applied to the full-month phased target" },
    { label: "Required / day", values: data.map((d) => inr(d.mo.requiredRunRate)), tip: "Remaining month target ÷ remaining days" },
  ];
  return { cols: data.map((d) => d.label), rows, data };
}

/** Daily trend rows keyed by category for stacked charts. */
export function trendByCategory(facts: Fact[], range: Range, cats: string[]) {
  const base = dailySeries(facts, range);
  const perCat = Object.fromEntries(cats.map((c) => [c, new Map(dailySeries(facts.filter((f) => f.c === c), range).map((r) => [r.date, r]))]));
  return base.map((r) => {
    const o: Record<string, unknown> = { date: r.date, target: r.target, ach: r.ach, total: r.sales, qty: r.qty, stores: r.stores };
    for (const c of cats) { o[c] = perCat[c].get(r.date)?.sales ?? 0; o[`${c}_qty`] = perCat[c].get(r.date)?.qty ?? 0; }
    return o;
  });
}

/** Today vs yesterday, WTD vs last week (same days), MTD vs previous month (same days). */
export function pulse(ctx: Ctx, facts: Fact[]) {
  const a = ctx.asOf;
  const ws = startOfWeek(a);
  const ms = startOfMonth(a);
  const pm = addMonths(ms, -1);
  const day = Number(a.slice(8, 10));
  const defs: { label: string; cur: Range; prev: Range; prevLabel: string }[] = [
    { label: "Yesterday", cur: { from: a, to: a }, prev: { from: addDays(a, -1), to: addDays(a, -1) }, prevLabel: "vs day before" },
    { label: "Same day last week", cur: { from: a, to: a }, prev: { from: addDays(a, -7), to: addDays(a, -7) }, prevLabel: "vs same weekday" },
    { label: "Week to date", cur: { from: ws, to: a }, prev: { from: addDays(ws, -7), to: addDays(a, -7) }, prevLabel: "vs last week, same days" },
    { label: "Month to date", cur: { from: ms, to: a }, prev: { from: pm, to: minDate(addDays(pm, day - 1), endOfMonth(pm)) }, prevLabel: `vs prev month 1–${day}` },
  ];
  return defs.map((d) => {
    const c = summarize(facts, d.cur), p = summarize(facts, d.prev);
    return { ...d, sales: c.sales, prevSales: p.sales, growth: growth(c.sales, p.sales), ach: c.ach, qty: c.qty, target: c.target };
  });
}

export interface SkuAgg {
  sku: string; c: string; name: string | null; image: string | null; mrp: number | null; type: string | null;
  sales: number; qty: number; prev: number; growth: number | null; l7: number; p7: number; l7q: number; l30: number; l30q: number; mtd: number; mtdq: number;
  stores: number; storesL30: number; penetration: number | null; last: string | null; asp: number | null; disc: number | null;
  invOffline: number | null; invTotal: number | null; storesStocked: number | null; lifecycle: string | null; status: string | null; colour: string | null;
}

/** Roll SKU × store facts up to SKU. `networkStores` = denominator for penetration. */
export function skuRollup(facts: SkuStoreFact[], products: Map<string, Product>, networkStores: number, typeOf: (p: Product) => string | null): SkuAgg[] {
  const g = new Map<string, SkuStoreFact[]>();
  for (const f of facts) { let a = g.get(f.sku); if (!a) g.set(f.sku, (a = [])); a.push(f); }
  const out: SkuAgg[] = [];
  for (const [sku, fs] of g) {
    const p = products.get(sku);
    let sales = 0, qty = 0, prev = 0, l7 = 0, p7 = 0, l7q = 0, l30 = 0, l30q = 0, mtd = 0, mtdq = 0, disc = 0; let last: string | null = null;
    const st = new Set<string>(), st30 = new Set<string>();
    for (const f of fs) {
      sales += f.rs; qty += f.rq; prev += f.ps; l7 += f.l7s; p7 += f.p7s; l7q += f.l7q; l30 += f.l30s; l30q += f.l30q; mtd += f.mtds; mtdq += f.mtdq; disc += f.disc;
      if (f.rq > 0) st.add(f.ch);
      if (f.l30q > 0) st30.add(f.ch);
      if (f.last && (!last || f.last > last)) last = f.last;
    }
    out.push({
      sku, c: fs[0].c, name: p?.name ?? null, image: p?.image ?? null, mrp: p?.mrp ?? fs[0].price, type: p ? typeOf(p) : null,
      sales, qty, prev, growth: growth(sales, prev), l7, p7, l7q, l30, l30q, mtd, mtdq, stores: st.size, storesL30: st30.size,
      penetration: safeDiv(st.size, networkStores), last, asp: safeDiv(sales, qty), disc: sales + disc > 0 ? disc / (sales + disc) : null,
      invOffline: p?.invOffline ?? null, invTotal: p?.invTotal ?? null, storesStocked: p?.storesStocked ?? null, lifecycle: p?.lifecycle ?? p?.status ?? null,
      status: p?.status ?? null, colour: p?.colour ?? null,
    });
  }
  return out.sort((a, b) => b.sales - a.sales);
}

