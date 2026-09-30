import "server-only";
import { addDays, addMonths, diffDays, endOfMonth, startOfMonth, type Range } from "@/lib/dates";
import { safeDiv } from "@/lib/metrics";
import type { Ctx, SP } from "./context";
import { loadScope, productPerformance, lastNDays, type ProductPerf } from "./scope";
import { channelMetrics, type ChKey } from "./channelData";
import { listMonthTargets } from "./data/targetBook";
import { listFutureInwards, type FutureInward } from "./data/futureInwards";
import { productL1, type Product } from "./data/products";
import { OPEN_INWARD } from "@/components/wip/vmStages";
import { FREE_GIFT_MAX } from "./data/channels";

/**
 * Demand planning v1 (projection, not actual):
 *  base rate (units/day) = w × L7/7 + (1 − w) × L30/30
 *  trend = (L7/7) ÷ (L30/30), capped 0.8–1.25; half of it is carried forward (damped): adj = 1 + (trend − 1) / 2
 *  forecast N days = base × adj × N
 *  DOI = stock (stores + warehouse) ÷ (L30 units ÷ 30)   ← always the L30 basis (tool-wide rule)
 *  reorder = max(0, rate × (lead time + target DOI) − stock − open future inwards)
 */
export interface PlanParams { lo: number; hi: number; lead: number; w: number }
const numParam = (sp: SP, k: string, d: number, min: number, max: number) => {
  const v = Number(Array.isArray(sp[k]) ? sp[k]![0] : sp[k]);
  return Number.isFinite(v) && v >= min && v <= max ? v : d;
};
export function parsePlanParams(sp: SP): PlanParams {
  const lo = numParam(sp, "lo", 30, 1, 365), hi = Math.max(lo, numParam(sp, "hi", 60, 1, 400));
  return { lo, hi, lead: numParam(sp, "lt", 30, 0, 180), w: numParam(sp, "w", 0.5, 0, 1) };
}
export const targetDoi = (p: PlanParams) => Math.round((p.lo + p.hi) / 2);

export interface SkuDemand {
  sku: string; name: string; image: string | null; category: string; l1: string | null; p: Product;
  storeInv: number; whInv: number; stock: number; l7U: number; l30U: number; l30Rev: number;
  base: number; trend: number | null; adj: number; rate: number; asp: number | null;
  f30: number; f60: number; f90: number; doi: number | null; onOrder: number; reorder: number;
  band: "no_sales" | "stockout" | "below" | "in" | "above" | "excess";
}

export function demandFor(p: Product, perf: ProductPerf | undefined, whInv: number, onOrder: number, pp: PlanParams): Omit<SkuDemand, "category"> & { category: string } {
  const storeInv = Math.max(0, p.invOffline ?? 0), stock = storeInv + Math.max(0, whInv);
  const l7U = perf?.l7Units ?? 0, l30U = perf?.l30Units ?? 0, l30Rev = perf?.l30 ?? 0;
  const r7 = l7U / 7, r30 = l30U / 30;
  const base = pp.w * r7 + (1 - pp.w) * r30;
  const trend = r30 > 0 ? Math.min(1.25, Math.max(0.8, r7 / r30)) : null;
  const adj = trend == null ? 1 : 1 + (trend - 1) / 2;
  const rate = base * adj;
  const doi = r30 > 0 ? stock / r30 : null;
  const tgt = targetDoi(pp);
  const reorder = rate > 0 ? Math.max(0, Math.ceil(rate * (pp.lead + tgt) - stock - onOrder)) : 0;
  const band = doi == null ? "no_sales" : doi! < Math.min(14, pp.lo) ? "stockout" : doi! < pp.lo ? "below" : doi! <= pp.hi ? "in" : doi! <= pp.hi * 2 ? "above" : "excess";
  return {
    sku: p.sku, name: p.name ?? p.sku, image: p.image, category: p.category!, l1: productL1(p), p,
    storeInv, whInv: Math.max(0, whInv), stock, l7U, l30U, l30Rev, base, trend, adj, rate, asp: safeDiv(l30Rev, l30U) ?? p.mrp,
    f30: rate * 30, f60: rate * 60, f90: rate * 90, doi, onOrder, reorder, band,
  };
}

/** Free gifts (items sold under ₹10 / unit, e.g. socks) are not demand — excluded from forecasts, reorder, OTB and rankings. */
export const isGiftProduct = (p: Product, perf?: ProductPerf) =>
  (p.mrp != null && p.mrp > 0 && p.mrp < FREE_GIFT_MAX) || (p.sellingPrice != null && p.sellingPrice > 0 && p.sellingPrice < FREE_GIFT_MAX) || (!!perf && perf.l30Units > 0 && perf.l30 / perf.l30Units < FREE_GIFT_MAX);

/** Everything the planning / inwards pages need, loaded once. */
export async function loadDemand(ctx: Ctx, pp: PlanParams) {
  const l30 = lastNDays(ctx.asOf, 30);
  const [sc, fut] = await Promise.all([loadScope(ctx, [l30]), listFutureInwards()]);
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const perf = await productPerformance(ctx, sc.pm, whUnits, "all", null);
  const bySku = new Map(perf.rows.map((r) => [r.sku, r]));
  const open = fut.filter((f) => OPEN_INWARD.has(f.status));
  const onOrderSku = new Map<string, number>();
  for (const f of open) if (f.sku_group) onOrderSku.set(f.sku_group.toUpperCase(), (onOrderSku.get(f.sku_group.toUpperCase()) ?? 0) + f.qty);
  const skus = sc.products.filter((p) => !isGiftProduct(p, bySku.get(p.sku))).map((p) => demandFor(p, bySku.get(p.sku), whUnits(p.sku), onOrderSku.get(p.sku) ?? 0, pp));
  return { sc, perf, bySku, fut, open, skus, l30 };
}

export interface CatPlan {
  c: string; skus: number; selling: number; storeInv: number; whInv: number; stock: number; l7U: number; l30U: number;
  rate: number; trend: number | null; f30: number; f60: number; f90: number; doi: number | null; asp: number | null;
  onOrder: number; onOrderNext: number; reorderUnits: number; reorderSkus: number; stockoutSkus: number; excessUnits: number;
  otb: {
    month: string; plannedSales: number; salesSource: string; plannedClosing: number; opening: number; onOrder: number; otb: number; otbUnits: number | null;
  };
}

/** Category roll-up incl. next-month open-to-buy (₹ at current ASP). */
export async function categoryPlans(ctx: Ctx, d: Awaited<ReturnType<typeof loadDemand>>, pp: PlanParams): Promise<CatPlan[]> {
  const nm = addMonths(startOfMonth(ctx.asOf), 1), nmEnd = endOfMonth(nm), D = diffDays(nm, nmEnd) + 1;
  const toMonthEnd = diffDays(ctx.asOf, endOfMonth(ctx.asOf));
  const mts = await listMonthTargets(nm, nm);
  const l30: Range = d.l30;
  const tgt = targetDoi(pp);
  return ctx.filters.cats.map((c) => {
    const rows = d.skus.filter((s) => s.category === c);
    const sum = (f: (s: SkuDemand) => number) => rows.reduce((a, s) => a + f(s), 0);
    const l7U = sum((s) => s.l7U), l30U = sum((s) => s.l30U), rate = sum((s) => s.rate), stock = sum((s) => s.stock);
    const r30 = l30U / 30;
    const trend = r30 > 0 ? Math.min(1.25, Math.max(0.8, l7U / 7 / r30)) : null;
    const facts = d.sc.facts.filter((f) => f.c === c), uc = d.sc.uc.filter((u) => u.c === c);
    const chRev = Object.fromEntries((["stores", "online", "marketplace"] as ChKey[]).map((k) => [k, channelMetrics(facts, uc, l30, k).revenue])) as Record<ChKey, number>;
    const all = channelMetrics(facts, uc, l30, "all");
    const asp = safeDiv(all.revenue, all.units) ?? safeDiv(sum((s) => s.l30Rev), l30U);
    const catOpen = d.open.filter((f) => f.category === c);
    const onOrder = catOpen.reduce((a, f) => a + f.qty, 0);
    const arrives = (f: FutureInward, from: string, to: string) => (f.expected_date ?? "9999") >= from && (f.expected_date ?? "9999") <= to;
    const beforeNm = catOpen.filter((f) => f.expected_date && f.expected_date < nm).reduce((a, f) => a + f.qty, 0);
    const inNm = catOpen.filter((f) => arrives(f, nm, nmEnd)).reduce((a, f) => a + f.qty, 0);
    // planned sales for next month: Control Centre targets per channel where set, otherwise the forecast for that channel's share
    const revRate = (all.revenue / 30) * (trend == null ? 1 : 1 + (trend - 1) / 2);
    const forecastRev = revRate * D;
    let planned = 0; const src: string[] = [];
    for (const k of ["stores", "online", "marketplace"] as ChKey[]) {
      const t = mts.find((m) => m.category === c && m.channel === k)?.target;
      if (t != null) { planned += t; src.push(`${k} target`); }
      else { planned += all.revenue > 0 ? forecastRev * (chRev[k] / all.revenue) : 0; src.push(`${k} forecast`); }
    }
    const targets = src.filter((s) => s.endsWith("target")).length;
    const a = asp ?? 0;
    const openingUnits = Math.max(0, stock - rate * toMonthEnd) + beforeNm;
    const plannedClosing = (planned / D) * tgt;
    const opening = openingUnits * a, onOrderV = inNm * a;
    const otb = planned + plannedClosing - opening - onOrderV;
    return {
      c, skus: rows.length, selling: rows.filter((s) => s.l30U > 0).length, storeInv: sum((s) => s.storeInv), whInv: sum((s) => s.whInv), stock, l7U, l30U,
      rate, trend, f30: rate * 30, f60: rate * 60, f90: rate * 90, doi: r30 > 0 ? stock / r30 : null, asp,
      onOrder, onOrderNext: inNm, reorderUnits: sum((s) => s.reorder), reorderSkus: rows.filter((s) => s.reorder > 0).length,
      stockoutSkus: rows.filter((s) => s.band === "stockout").length,
      excessUnits: sum((s) => (s.doi != null && s.doi > pp.hi * 2 ? s.stock - (s.l30U / 30) * pp.hi : s.doi == null ? s.stock : 0)),
      otb: {
        month: nm, plannedSales: planned, salesSource: targets === 3 ? "Control Centre targets" : targets === 0 ? "forecast (no targets set)" : `${targets} of 3 channels from targets, rest forecast`,
        plannedClosing, opening, onOrder: onOrderV, otb, otbUnits: a > 0 ? otb / a : null,
      },
    };
  });
}

export const weekOf = (d: string) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
