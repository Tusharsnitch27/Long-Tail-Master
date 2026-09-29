import "server-only";
import { MARKETPLACES, ONLINE, type Channel } from "@/lib/categories";
import { eachDay, inRange, rangeDays, type Range } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import type { Fact } from "./data/facts";
import { getChannelDaily, type ChannelDay } from "./data/channels";
import { summarize } from "./analytics";
import type { Ctx } from "./context";

/**
 * One view of revenue across channels. Stores = DSR (net), Online = Unicommerce SHOPIFY, Marketplace = Unicommerce
 * AJIO / MYNTRA / FLIPKART / AMAZON (non-cancelled items). Overall = the sum, so channels always reconcile to it.
 */
export type ChKey = "stores" | "online" | "marketplace";
export const CH_LABEL: Record<ChKey, string> = { stores: "Stores", online: "Online", marketplace: "Marketplace" };

export const ucChannel = (mp: string): ChKey | null => (mp === ONLINE ? "online" : (MARKETPLACES as readonly string[]).includes(mp) ? "marketplace" : null);

export function inChannel(ch: Channel, mp: string | null) {
  return (k: ChKey, rowMp?: string) => (ch === "all" || ch === k) && (!(ch === "marketplace" && mp) || rowMp === mp);
}

export interface ChMetrics { revenue: number; units: number; orders: number | null; target: number | null; ach: number | null; asp: number | null; storesSelling: number | null; days: number }

export async function loadUc(ctx: Ctx, ranges: Range[]): Promise<ChannelDay[]> {
  const from = ranges.map((r) => r.from).sort()[0], to = ranges.map((r) => r.to).sort().at(-1)!;
  const rows = await getChannelDaily({ from, to });
  const cats = new Set(ctx.filters.cats);
  return rows.filter((r) => cats.has(r.c));
}

/** Metrics for one channel (or overall) over a range. */
export function channelMetrics(facts: Fact[], uc: ChannelDay[], range: Range, ch: ChKey | "all", mp: string | null = null): ChMetrics {
  let revenue = 0, units = 0, orders = 0;
  const useStores = ch === "all" || ch === "stores";
  const s = useStores ? summarize(facts, range) : null;
  if (s) { revenue += s.sales; units += s.qty; orders += s.bills ?? 0; }
  for (const r of uc) {
    if (!inRange(r.d, range)) continue;
    const k = ucChannel(r.mp);
    if (!k || (ch !== "all" && ch !== k) || (mp && r.mp !== mp)) continue;
    revenue += r.revenue; units += r.items; orders += r.orders;
  }
  return {
    revenue, units, orders: orders || null,
    // targets exist for the Stores channel only
    target: s?.target ?? null, ach: s && ch === "stores" ? s.ach : s ? safeDiv(s.sales, s.target) : null,
    asp: safeDiv(revenue, units), storesSelling: s?.storesSelling ?? null, days: rangeDays(range),
  };
}

export function channelBreakdown(facts: Fact[], uc: ChannelDay[], range: Range, compare: Range) {
  const total = channelMetrics(facts, uc, range, "all");
  return (["stores", "online", "marketplace"] as ChKey[]).map((k) => {
    const m = channelMetrics(facts, uc, range, k), p = channelMetrics(facts, uc, compare, k);
    return { key: k, label: CH_LABEL[k], ...m, prev: p.revenue, growth: growth(m.revenue, p.revenue), share: safeDiv(m.revenue, total.revenue) };
  });
}

export function marketplaceBreakdown(uc: ChannelDay[], range: Range, compare: Range) {
  const mps = Array.from(new Set(uc.filter((r) => ucChannel(r.mp) === "marketplace").map((r) => r.mp)));
  const tot = uc.filter((r) => inRange(r.d, range) && ucChannel(r.mp) === "marketplace").reduce((a, r) => a + r.revenue, 0);
  return mps.map((mp) => {
    const cur = uc.filter((r) => r.mp === mp && inRange(r.d, range)), prev = uc.filter((r) => r.mp === mp && inRange(r.d, compare));
    const revenue = cur.reduce((a, r) => a + r.revenue, 0), units = cur.reduce((a, r) => a + r.items, 0), orders = cur.reduce((a, r) => a + r.orders, 0);
    const pr = prev.reduce((a, r) => a + r.revenue, 0);
    return { mp, revenue, units, orders, asp: safeDiv(revenue, units), prev: pr, growth: growth(revenue, pr), share: safeDiv(revenue, tot) };
  }).filter((x) => x.revenue > 0 || x.prev > 0).sort((a, b) => b.revenue - a.revenue);
}

/** Daily revenue per channel for charts. */
export function channelSeries(facts: Fact[], uc: ChannelDay[], range: Range, mp: string | null = null) {
  return eachDay(range.from, range.to).map((d) => {
    const r = { from: d, to: d };
    const st = summarize(facts, r);
    let online = 0, marketplace = 0;
    for (const x of uc) if (x.d === d) { const k = ucChannel(x.mp); if (k === "online") online += x.revenue; else if (k === "marketplace" && (!mp || x.mp === mp)) marketplace += x.revenue; }
    return { date: d, stores: st.sales, online, marketplace, target: st.target, total: st.sales + online + marketplace };
  });
}

/** Marketplaces that actually have sales for the categories in scope (drives the marketplace filter). */
export function marketplacesWithData(uc: ChannelDay[]) {
  const m = new Map<string, number>();
  for (const r of uc) if (ucChannel(r.mp) === "marketplace" && r.items > 0) m.set(r.mp, (m.get(r.mp) ?? 0) + r.revenue);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
