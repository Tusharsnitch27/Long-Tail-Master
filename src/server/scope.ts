import "server-only";
import { addDays, startOfMonth, type Range } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import type { Channel } from "@/lib/categories";
import { loadFacts, type Ctx } from "./context";
import { loadUc, ucChannel, type ChKey } from "./channelData";
import { getProductMap, type Product } from "./data/products";
import { getWarehouseStock } from "./data/warehouse";
import { getGoodsInTransit, type GitData } from "./data/git";
import { getSkuFacts } from "./data/sku";
import { getChannelSku } from "./data/channels";

/** Everything a Long Tail page needs for the current context, loaded once. */
export async function loadScope(ctx: Ctx, extra: Range[] = []) {
  const { range, compare } = ctx.period;
  const ranges = [range, compare, { from: startOfMonth(ctx.asOf), to: ctx.asOf }, ...extra];
  const [facts, uc, pm] = await Promise.all([loadFacts(ctx, extra), loadUc(ctx, ranges), getProductMap()]);
  const known = new Set(pm.keys());
  const [wh, git] = await Promise.all([getWarehouseStock(known), gitOrEmpty(known)]);
  const cats = new Set(ctx.filters.cats);
  const products = [...pm.values()].filter((p) => p.category && cats.has(p.category));
  const inventory = {
    store: products.reduce((a, p) => a + (p.invOffline ?? 0), 0),
    warehouse: products.reduce((a, p) => a + (wh.bySku.get(p.sku)?.units ?? 0), 0),
    git: products.reduce((a, p) => a + (git.bySku.get(p.sku)?.units ?? 0), 0),
    asOf: wh.updated, gitAsOf: git.updated,
  };
  return { facts, uc, pm, wh, git, products, inventory };
}

/** Goods in transit, never blocking a page if the table is unavailable. */
export function gitOrEmpty(known: Set<string>): Promise<GitData> {
  return getGoodsInTransit(known).catch((e) => {
    console.error("[git] goods in transit unavailable", e);
    return { lines: [], bySku: new Map(), byStoreSku: new Map(), byStore: new Map(), updated: null } as GitData;
  });
}

export interface ProductPerf {
  sku: string; p: Product | undefined; name: string; image: string | null; category: string | null;
  revenue: number; units: number; prev: number; growth: number | null;
  byChannel: Record<ChKey, { revenue: number; units: number }>;
  byMp: Record<string, { revenue: number; units: number }>;
  l7: number; p7: number; l7Units: number; l30: number; l30Units: number; storesSelling: number; last: string | null;
  storeInv: number | null; whInv: number; git: number; returnPct: number | null; doi: number | null; salesPerStore: number | null;
}

/**
 * Product-level performance for the period, merged across channels:
 * Stores = HORIZONTAL_SALES_CATEGORIES (TYPE = Store; the only store × SKU source), Online / Marketplace = Unicommerce.
 */
export async function productPerformance(ctx: Ctx, pm: Map<string, Product>, whUnits: (sku: string) => number, channel: Channel = ctx.filters.channel, mp: string | null = ctx.filters.mp) {
  const { range, compare } = ctx.period;
  const cats = new Set(ctx.filters.cats);
  const storeScope = ctx.filters.stores.length ? new Set(ctx.filters.stores) : null;
  const [st, uc, git] = await Promise.all([
    channel === "all" || channel === "stores" ? getSkuFacts({ range, compare, asOf: ctx.asOf, cats: ctx.filters.cats, ch: "store" }) : Promise.resolve([]),
    channel === "stores" || storeScope ? Promise.resolve([]) : getChannelSku({ range, compare, asOf: ctx.asOf }),
    gitOrEmpty(new Set(pm.keys())),
  ]);
  const out = new Map<string, ProductPerf>();
  const get = (sku: string, c: string) => {
    let e = out.get(sku);
    if (!e) {
      const p = pm.get(sku);
      out.set(sku, (e = { sku, p, name: p?.name ?? sku, image: p?.image ?? null, category: p?.category ?? c, revenue: 0, units: 0, prev: 0, growth: null,
        byChannel: { stores: { revenue: 0, units: 0 }, online: { revenue: 0, units: 0 }, marketplace: { revenue: 0, units: 0 } }, byMp: {},
        l7: 0, p7: 0, l7Units: 0, l30: 0, l30Units: 0, storesSelling: 0, last: null, storeInv: p?.invOffline ?? null, whInv: whUnits(sku), git: git.bySku.get(sku)?.units ?? 0,
        returnPct: channel === "online" ? p?.returnPct.online ?? null : channel === "marketplace" ? p?.returnPct.marketplace ?? null : channel === "stores" ? p?.returnPct.stores ?? null : p?.returnPct.all ?? null,
        doi: null, salesPerStore: null }));
    }
    return e;
  };
  const stores = new Set<string>();
  for (const f of st) {
    if (!cats.has(f.c)) continue;
    if (storeScope) { const b = ctx.byName.get(f.ch.toUpperCase())?.branch_code; if (!b || !storeScope.has(b)) continue; }
    const e = get(f.sku, f.c);
    e.revenue += f.rs; e.units += f.rq; e.prev += f.ps; e.byChannel.stores.revenue += f.rs; e.byChannel.stores.units += f.rq;
    e.l7 += f.l7s; e.p7 += f.p7s; e.l7Units += f.l7q; e.l30 += f.l30s; e.l30Units += f.l30q;
    if (f.rq > 0) { e.storesSelling++; stores.add(f.ch); }
    if (f.last && (!e.last || f.last > e.last)) e.last = f.last;
  }
  for (const f of uc) {
    const k = ucChannel(f.mp);
    if (!k || !cats.has(f.c) || (channel !== "all" && channel !== k) || (mp && f.mp !== mp)) continue;
    const e = get(f.sku, f.c);
    e.revenue += f.rs; e.units += f.rq; e.prev += f.ps; e.byChannel[k].revenue += f.rs; e.byChannel[k].units += f.rq;
    const m = (e.byMp[f.mp] ??= { revenue: 0, units: 0 }); m.revenue += f.rs; m.units += f.rq;
    e.l7 += f.l7s; e.p7 += f.p7s; e.l7Units += f.l7q; e.l30 += f.l30s; e.l30Units += f.l30q;
    if (f.last && (!e.last || f.last > e.last)) e.last = f.last;
  }
  for (const e of out.values()) {
    e.growth = growth(e.revenue, e.prev);
    const stock = (e.storeInv ?? 0) + e.whInv + e.git; // stores + in transit + warehouse
    e.doi = e.l30Units > 0 ? stock / (e.l30Units / 30) : null;
    e.salesPerStore = safeDiv(e.byChannel.stores.revenue, e.storesSelling);
  }
  const rows = [...out.values()].sort((a, b) => b.revenue - a.revenue);
  return { rows, activeSkus: rows.filter((r) => r.units > 0).length, storesSelling: stores.size };
}

export const lastNDays = (asOf: string, n: number): Range => ({ from: addDays(asOf, -(n - 1)), to: asOf });
