import "server-only";
import { addDays, diffDays, type Range } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import type { Channel } from "@/lib/categories";
import { inr, num, pct } from "@/lib/format";
import type { Ctx } from "./context";
import type { loadScope } from "./scope";
import { productPerformance } from "./scope";
import { getSkuFacts, type SkuStoreFact } from "./data/sku";
import { getChannelSku, type ChannelSku } from "./data/channels";
import { ucChannel, CH_LABEL, type ChKey } from "./channelData";
import { productL1, type Product } from "./data/products";
import { ATTR_LABEL } from "./data/metafields";
import { ZONE } from "./data/warehouse";
import { catLabel } from "./views";

export type Scope = Awaited<ReturnType<typeof loadScope>>;

/**
 * Metric definitions (shown in tooltips).
 *  - L7 / P7: last 7 complete days to the data date vs the 7 days before. L30 / P30: last 30 days vs the 30 before.
 *  - STR (sell-through, L30) = L30 units ÷ (L30 units + current stock), all channels; current stock = live store + warehouse.
 *  - Lifetime STR = lifetime units sold ÷ lifetime inward qty (Product Master).
 *  - Days of cover = (store + warehouse units) ÷ L30 average daily units, all channels.
 *  - Return % = lifetime returned ₹ ÷ sold ₹ (Product Master), for the selected channel.
 */
export const DEF = {
  l7: "Last 7 complete days to the data date (₹, selected channel)",
  wow: "L7 vs the 7 days before it",
  l30: "Last 30 days to the data date (₹, selected channel)",
  mom: "L30 vs the 30 days before it",
  str30: "Sell-through (L30) = L30 units ÷ (L30 units + current store + warehouse stock), all channels",
  ltStr: "Lifetime sell-through = lifetime units sold ÷ lifetime inward qty (Product Master)",
  doi: "Days of cover = (store + warehouse units) ÷ L30 average daily units, all channels",
  ret: "Lifetime returned ₹ ÷ sold ₹ (Product Master), selected channel",
  storeInv: "Live store inventory (latest store report, all stores)",
  wh: "Live warehouse inventory (Unicommerce): South = SAPL-WH1 + SAPL-WH2, North = SAPL-NORTH-TAURU",
  inward: "Lifetime inward qty (Product Master)",
};

/** Words a shopper would use for a category (so "black shoes" or "trolley" match without the exact label). */
const CAT_WORDS: Record<string, string> = {
  perfumes: "perfume perfumes fragrance fragrances scent edp parfum",
  shoes: "shoe shoes footwear",
  accessories: "accessory accessories",
  bags: "bag bags",
  belts: "belt belts",
  sunglasses: "sunglass sunglasses eyewear shades",
  luggage: "trolley trolleys luggage suitcase",
};

export function productSearchText(p: Product) {
  const c = p.category ?? "";
  return [p.search, catLabel(c), CAT_WORDS[c], productL1(p), p.lifecycle].filter(Boolean).join(" ").toLowerCase();
}

export const rolling30 = (asOf: string) => ({ l30: { from: addDays(asOf, -29), to: asOf } as Range, p30: { from: addDays(asOf, -59), to: addDays(asOf, -30) } as Range });

export interface Bucket { l7: number; p7: number; l7u: number; p7u: number; l30: number; p30: number; l30u: number; p30u: number }
export interface Roll { all: Bucket; ch: Record<ChKey, Bucket>; mp: Record<string, Bucket>; storesL30: number }
const bucket = (): Bucket => ({ l7: 0, p7: 0, l7u: 0, p7u: 0, l30: 0, p30: 0, l30u: 0, p30u: 0 });
const addTo = (b: Bucket, f: { l7s: number; p7s: number; l7q: number; p7q: number; rs: number; ps: number; rq: number; pq: number }) => {
  b.l7 += f.l7s; b.p7 += f.p7s; b.l7u += f.l7q; b.p7u += f.p7q; b.l30 += f.rs; b.p30 += f.ps; b.l30u += f.rq; b.p30u += f.pq;
};

/** Rolling L7 / P7 / L30 / P30 per product and channel (Stores = store sales lines; Online / Marketplace = Unicommerce). */
export async function rollingBySku(asOf: string, cats: string[]): Promise<{ map: Map<string, Roll>; st: SkuStoreFact[]; uc: ChannelSku[] }> {
  const { l30, p30 } = rolling30(asOf);
  const [st, uc] = await Promise.all([
    cats.length ? getSkuFacts({ range: l30, compare: p30, asOf, cats, ch: "store" }) : Promise.resolve([]),
    getChannelSku({ range: l30, compare: p30, asOf }),
  ]);
  const cs = new Set(cats);
  const map = new Map<string, Roll>();
  const get = (s: string) => { let e = map.get(s); if (!e) map.set(s, (e = { all: bucket(), ch: { stores: bucket(), online: bucket(), marketplace: bucket() }, mp: {}, storesL30: 0 })); return e; };
  for (const f of st) {
    if (!cs.has(f.c)) continue;
    const e = get(f.sku); addTo(e.all, f); addTo(e.ch.stores, f);
    if (f.rq > 0) e.storesL30++;
  }
  for (const f of uc) {
    const k = ucChannel(f.mp);
    if (!k || !cs.has(f.c)) continue;
    const e = get(f.sku); addTo(e.all, f); addTo(e.ch[k], f); addTo((e.mp[f.mp] ??= bucket()), f);
  }
  return { map, st, uc };
}

export const pickBucket = (r: Roll | undefined, ch: Channel, mp: string | null): Bucket =>
  !r ? bucket() : ch === "all" ? r.all : ch === "marketplace" && mp ? r.mp[mp] ?? bucket() : r.ch[ch];

export interface ProductRow {
  sku: string; name: string; image: string | null; category: string | null; catName: string;
  l1: string | null; l2: string | null; colour: string | null; collection: string | null; lifecycle: string | null;
  mrp: number | null; liveDate: string | null; daysLive: number | null; search: string;
  revenue: number; units: number; growth: number | null; prev: number; chRev: [number, number, number];
  l7: number; p7: number; wow: number | null; l7Units: number;
  l30: number; p30: number; mom: number | null; l30Units: number; p30Units: number; allL30Units: number;
  str30: number | null; ltSales: number | null; ltUnits: number | null; inward: number | null; ltStr: number | null;
  returnPct: number | null; split: [number, number, number] | null; stShare: number | null; onShare: number | null; mpShare: number | null;
  storeInv: number; storesStocked: number | null; whInv: number; wh1: number; wh2: number; whSouth: number; whNorth: number; totalInv: number;
  doi: number | null; storesSelling: number; lastInward: string | null; hasMeta: boolean;
  gift: boolean; flag: string | null;
}

/** Free gift: recent ASP under ₹10 (L30, else lifetime) — e.g. socks given away. Kept out of top / bottom rankings. */
export const GIFT_ASP = 10;
export function isFreeGift(l30: number | null | undefined, l30u: number | null | undefined, lt: number | null | undefined, ltu: number | null | undefined) {
  const asp = l30u && l30u > 0 ? (l30 ?? 0) / l30u : ltu && ltu > 0 ? (lt ?? 0) / ltu : null;
  return asp != null && asp < GIFT_ASP;
}

const retFor = (p: Product | undefined, ch: Channel) => (p ? (ch === "all" ? p.returnPct.all : p.returnPct[ch]) : null);

/**
 * One row per product for Product Performance / Product Master: selected period (global preset + channel), rolling
 * L7 / L30 windows, lifetime (Product Master), STR, return %, live store + warehouse inventory and days of cover.
 * master = every product in scope; otherwise only products with sales or stock.
 */
export async function productRows(ctx: Ctx, sc: Scope, o: { master?: boolean; withPeriod?: boolean } = {}): Promise<ProductRow[]> {
  const ch = ctx.filters.channel, mp = ctx.filters.mp;
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const [perf, roll] = await Promise.all([
    o.withPeriod === false ? Promise.resolve(null) : productPerformance(ctx, sc.pm, whUnits),
    rollingBySku(ctx.asOf, ctx.filters.cats),
  ]);
  const perfBy = new Map((perf?.rows ?? []).map((r) => [r.sku, r]));
  const skus = new Set<string>(sc.products.map((p) => p.sku));
  if (!o.master) for (const r of perf?.rows ?? []) skus.add(r.sku);
  const cats = new Set(ctx.filters.cats);
  if (!o.master) for (const [s] of roll.map) if (!skus.has(s) && (!sc.pm.get(s)?.category || cats.has(sc.pm.get(s)!.category!))) skus.add(s);
  const out: ProductRow[] = [];
  for (const sku of skus) {
    const p = sc.pm.get(sku);
    const pr = perfBy.get(sku);
    const rl = roll.map.get(sku);
    const b = pickBucket(rl, ch, mp);
    const allL30u = rl?.all.l30u ?? 0;
    const w = sc.wh.bySku.get(sku);
    const storeInv = p?.invOffline ?? 0, whInv = w?.units ?? 0, totalInv = storeInv + whInv;
    const lt = p ? (p.sales.stores ?? 0) + (p.sales.online ?? 0) + (p.sales.marketplace ?? 0) : 0;
    const row: ProductRow = {
      sku, name: p?.name ?? pr?.name ?? sku, image: p?.image ?? null, category: p?.category ?? pr?.category ?? null, catName: catLabel(p?.category ?? pr?.category ?? ""),
      l1: p ? productL1(p) : null, l2: p?.l2 ?? null, colour: p?.attrs.colour ?? p?.colour ?? null, collection: p?.collection ?? null, lifecycle: p?.lifecycle ?? null,
      mrp: p?.mrp ?? null, liveDate: p?.liveDate ?? null, daysLive: p?.daysSinceLive ?? null, search: p ? productSearchText(p) : sku.toLowerCase(),
      revenue: pr?.revenue ?? 0, units: pr?.units ?? 0, growth: pr?.growth ?? null, prev: pr?.prev ?? 0,
      chRev: pr ? [pr.byChannel.stores.revenue, pr.byChannel.online.revenue, pr.byChannel.marketplace.revenue] : [0, 0, 0],
      l7: b.l7, p7: b.p7, wow: growth(b.l7, b.p7), l7Units: b.l7u,
      l30: b.l30, p30: b.p30, mom: growth(b.l30, b.p30), l30Units: b.l30u, p30Units: b.p30u, allL30Units: allL30u,
      str30: allL30u + totalInv > 0 ? allL30u / (allL30u + Math.max(0, totalInv)) : null,
      ltSales: p?.sales.all ?? null, ltUnits: p?.qty.all ?? null, inward: p?.inwardTotal ?? null, ltStr: safeDiv(p?.qty.all, p?.inwardTotal),
      returnPct: retFor(p, ch),
      split: lt > 0 ? [(p!.sales.stores ?? 0) / lt, (p!.sales.online ?? 0) / lt, (p!.sales.marketplace ?? 0) / lt] : null,
      stShare: lt > 0 ? (p!.sales.stores ?? 0) / lt : null, onShare: lt > 0 ? (p!.sales.online ?? 0) / lt : null, mpShare: lt > 0 ? (p!.sales.marketplace ?? 0) / lt : null,
      storeInv, storesStocked: p?.storesStocked ?? null, whInv, wh1: w?.byFacility["SAPL-WH1"] ?? 0, wh2: w?.byFacility["SAPL-WH2"] ?? 0,
      whSouth: w?.byZone.South ?? 0, whNorth: w?.byZone.North ?? 0, totalInv,
      doi: allL30u > 0 ? totalInv / (allL30u / 30) : null, storesSelling: rl?.storesL30 ?? 0, lastInward: p?.lastInward ?? null,
      hasMeta: !!p && (!!p.l1 || Object.keys(p.attrs).length > 0),
      gift: false, flag: null,
    };
    row.gift = isFreeGift(rl?.all.l30, allL30u, p?.sales.all, p?.qty.all);
    row.flag = row.gift ? "Free gift" : row.doi != null && row.doi < 21 && allL30u >= 10 ? "Low cover" : row.totalInv >= 30 && (row.doi == null || row.doi > 180) ? "Slow" : null;
    if (!o.master && !(row.units > 0 || row.l30Units > 0 || row.p30Units > 0 || row.totalInv > 0 || (pr?.prev ?? 0) > 0)) continue;
    out.push(row);
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.l30 - a.l30 || (b.ltSales ?? 0) - (a.ltSales ?? 0));
}

/** Aggregate product rows into a group (category or product type). */
export function rollup(rows: ProductRow[]) {
  const s = (f: (r: ProductRow) => number | null | undefined) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
  const byRev = rows.filter((r) => !r.gift).sort((a, b) => b.revenue - a.revenue);
  const rev = s((r) => r.revenue);
  let cum = 0, n80 = 0;
  for (const r of byRev) { if (rev <= 0 || cum >= rev * 0.8) break; cum += r.revenue; n80++; }
  const l30u = s((r) => r.allL30Units), stock = s((r) => r.totalInv), ltSales = s((r) => r.ltSales), inward = s((r) => r.inward), ltUnits = s((r) => r.ltUnits);
  const retV = rows.reduce((a, r) => a + (r.returnPct != null && r.ltSales ? r.returnPct * r.ltSales : 0), 0);
  return {
    products: rows.length, selling: rows.filter((r) => r.units > 0).length, revenue: rev, units: s((r) => r.units), prev: s((r) => r.prev),
    chRev: [s((r) => r.chRev[0]), s((r) => r.chRev[1]), s((r) => r.chRev[2])] as [number, number, number],
    top10: safeDiv(byRev.slice(0, 10).reduce((a, r) => a + r.revenue, 0), rev), n80,
    l7: s((r) => r.l7), p7: s((r) => r.p7), l30: s((r) => r.l30), p30: s((r) => r.p30), l30Units: l30u,
    storeInv: s((r) => r.storeInv), whInv: s((r) => r.whInv), wh1: s((r) => r.wh1), wh2: s((r) => r.wh2), whSouth: s((r) => r.whSouth), whNorth: s((r) => r.whNorth), totalInv: stock,
    str30: l30u + stock > 0 ? l30u / (l30u + stock) : null, doi: l30u > 0 ? stock / (l30u / 30) : null,
    ltSales, ltStr: safeDiv(ltUnits, inward), returnPct: safeDiv(retV, ltSales),
    lowCover: rows.filter((r) => !r.gift && r.doi != null && r.doi < 21 && r.allL30Units >= 10).length,
    slow: rows.filter((r) => !r.gift && r.totalInv >= 30 && (r.doi == null || r.doi > 180)).length,
    slowUnits: rows.filter((r) => !r.gift && r.totalInv >= 30 && (r.doi == null || r.doi > 180)).reduce((a, r) => a + r.totalInv, 0),
    gifts: rows.filter((r) => r.gift).length,
  };
}

// ───────────────────────────── product detail ─────────────────────────────

/** Plain-language description from the product's metafields (no invented copy). */
export function describeProduct(p: Product): string | null {
  const a = p.attrs;
  const type = [p.l2, p.l1].filter(Boolean).join(" ").toLowerCase();
  const head = [a.colour, type || catLabel(p.category ?? "").toLowerCase().replace(/s$/, "")].filter(Boolean).join(" ");
  const bits: string[] = [];
  const mat = a.upperMaterial ?? a.material;
  if (mat) bits.push(`${mat.toLowerCase()}${a.upperMaterial ? " upper" : ""}`);
  if (a.soleType || a.soleMaterial) bits.push(`${[a.soleMaterial, a.soleType].filter(Boolean).join(" ").toLowerCase()} sole`);
  if (a.closure) bits.push(`${a.closure.toLowerCase()} closure`);
  if (a.toeShape) bits.push(`${a.toeShape.toLowerCase()} toe`);
  if (a.construction) bits.push(`${a.construction.toLowerCase()} construction`);
  if (a.shape && p.category !== "sunglasses") bits.push(`${a.shape.toLowerCase()} shape`);
  const tail: string[] = [];
  if (a.occasion) tail.push(`for ${a.occasion.toLowerCase()} occasions`);
  if (a.aesthetic) tail.push(`${a.aesthetic.toLowerCase()} aesthetic`);
  if (a.season) tail.push(`${a.season.toLowerCase()} season`);
  if (a.bestWith) tail.push(`best with ${a.bestWith.toLowerCase()}`);
  if (!head && !bits.length && !tail.length) return null;
  let s = head ? head[0].toUpperCase() + head.slice(1) : "Product";
  if (bits.length) s += ` with ${bits.join(", ")}`;
  if (tail.length) s += ` — ${tail.join("; ")}`;
  if (p.collection) s += `. Collection: ${p.collection}`;
  return s + ".";
}

export const attrList = (p: Product) => Object.entries(p.attrs).filter(([, v]) => v).map(([k, v]) => ({ k, label: ATTR_LABEL[k] ?? k, v }));

export interface Opp { tone: "bad" | "warn" | "good" | "info"; title: string; detail: string }

export interface StoreLine { b: string | null; name: string; region: string | null; city: string | null; revenue: number; units: number; l30: number; l30u: number; l7u: number; stock: number; s30: number; last: string | null; doi: number | null }

export interface DetailFacts {
  p: Product; row: Pick<ProductRow, "l7" | "p7" | "l30" | "p30" | "l30Units" | "p30Units" | "l7Units" | "wow" | "mom" | "doi" | "str30" | "ltStr" | "storeInv" | "whInv" | "whNorth" | "whSouth" | "totalInv">;
  roll: Roll | undefined; stores: StoreLine[]; sizes: [string, number][]; catReturn: number | null; catStorePerStore: number | null; activeStores: number;
  inwards: { d: string; wh: string; qty: number; done: number; lines: number }[]; soldSinceInward: number | null; asOf: string;
}

/** Deterministic two-line summary: performance, then channel + inventory position. */
export function performanceSummary(f: DetailFacts): [string, string] {
  const { p, row, roll } = f;
  const l1: string[] = [];
  if (p.sales.all) l1.push(`${inr(p.sales.all)} lifetime from ${num(p.qty.all)} units${p.inwardTotal ? ` (${pct(row.ltStr, 0)} of ${num(p.inwardTotal)} inwarded sold)` : ""}`);
  if (row.l30 > 0 || row.p30 > 0) l1.push(`L30 ${inr(row.l30)}${row.mom != null ? ` (${row.mom >= 0 ? "up" : "down"} ${pct(Math.abs(row.mom), 0)} vs prior 30)` : row.p30 === 0 && row.l30 > 0 ? " (new sales vs none prior 30)" : ""}`);
  else l1.push("no sales in the last 60 days");
  if (row.wow != null && Math.abs(row.wow) >= 0.1 && row.p7 > 0) l1.push(`last 7 days ${row.wow > 0 ? "+" : "−"}${pct(Math.abs(row.wow), 0)} WoW`);
  const l2: string[] = [];
  const lt = (p.sales.stores ?? 0) + (p.sales.online ?? 0) + (p.sales.marketplace ?? 0);
  if (lt > 0) {
    const shares = (["stores", "online", "marketplace"] as ChKey[]).map((k) => ({ k, v: (p.sales[k] ?? 0) / lt })).sort((a, b) => b.v - a.v);
    l2.push(`Sells ${pct(shares[0].v, 0)} ${shares[0].k === "stores" ? "in Stores" : shares[0].k === "online" ? "Online" : "on Marketplaces"}`);
    const r30 = roll?.all.l30 ?? 0;
    if (r30 > 0) {
      const now = (["stores", "online", "marketplace"] as ChKey[]).map((k) => ({ k, v: (roll?.ch[k].l30 ?? 0) / r30 })).sort((a, b) => b.v - a.v)[0];
      if (now.k !== shares[0].k && now.v > 0.4) l2.push(`but ${CH_LABEL[now.k]} leads the last 30 days (${pct(now.v, 0)})`);
    }
  }
  const top = f.stores[0];
  if (top && top.revenue > 0) l2.push(`top store ${top.name}`);
  if (row.doi != null) l2.push(`${num(row.doi)} days of cover${row.doi < 21 ? " — reorder risk" : row.doi > 180 ? " — overstocked" : ""}`);
  else if (row.totalInv > 0) l2.push(`${num(row.totalInv)} units in stock with no sales in 30 days`);
  else l2.push("out of stock everywhere");
  return [cap(l1.join("; ")) + ".", cap(l2.join("; ")) + "."];
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** What could be done better for this product — deterministic rules over its own data. */
export function productOpportunities(f: DetailFacts): Opp[] {
  const { p, row, roll } = f;
  const out: Opp[] = [];
  const allL30u = roll?.all.l30u ?? 0;
  const daily = allL30u / 30;
  const stock = row.totalInv;
  // 1. cover
  if (row.doi != null && row.doi < 21 && allL30u >= 5) {
    const need = Math.max(0, Math.ceil(daily * 45 - stock));
    out.push({ tone: "bad", title: `Only ${num(row.doi)} days of cover`, detail: `Selling ${daily.toFixed(1)}/day (L30, all channels) against ${num(stock)} units. ${row.whInv > 0 ? `Replenish stores from the ${num(row.whInv)} warehouse units and` : "Warehouse is empty —"} raise a reorder of ≈${num(need)} units to reach 45 days.` });
  }
  // 2. store cover vs warehouse
  const stL30u = roll?.ch.stores.l30u ?? 0;
  const stDoi = stL30u > 0 ? row.storeInv / (stL30u / 30) : null;
  if (stDoi != null && stDoi < 21 && row.whInv >= 10 && stL30u >= 5) out.push({ tone: "warn", title: `Stores have ${num(stDoi)} days of cover while the warehouse holds ${num(row.whInv)}`, detail: `Store sales run ${(stL30u / 30).toFixed(1)}/day. Push warehouse stock to the top-selling stores (${f.stores.filter((s) => s.revenue > 0).slice(0, 3).map((s) => s.name).join(", ") || "see store distribution"}).` });
  // 3. dead store stock
  const dead = f.stores.filter((s) => s.stock >= 2 && s.l30u === 0 && s.s30 === 0);
  if (dead.length >= 2) {
    const units = dead.reduce((a, s) => a + s.stock, 0);
    const winners = f.stores.filter((s) => s.l30u > 0 && (s.doi ?? 0) < 30).slice(0, 3).map((s) => s.name);
    out.push({ tone: "warn", title: `${num(units)} units sit in ${dead.length} stores with no sale in 30 days`, detail: `e.g. ${dead.slice(0, 4).map((s) => `${s.name} (${s.stock})`).join(", ")}.${winners.length ? ` Transfer to stores that sell it: ${winners.join(", ")}.` : " Transfer to stores / channels where it sells."}` });
  }
  // 4. size gaps at the warehouse
  const sized = f.sizes.filter(([s]) => s !== "One size");
  const zero = sized.filter(([, v]) => v <= 0).map(([s]) => s);
  if (sized.length >= 3 && zero.length && zero.length < sized.length && allL30u >= 3) out.push({ tone: "warn", title: `Broken size curve: ${zero.slice(0, 6).join(", ")} out at the warehouse`, detail: `${sized.length - zero.length} of ${sized.length} sizes in stock. Replenish missing sizes before pushing more stock to stores.` });
  // 5. returns vs category
  const rp = p.returnPct.all;
  if (rp != null && f.catReturn != null && rp > f.catReturn + 0.05 && (p.sales.all ?? 0) >= 50_000) {
    const worst = (["stores", "online", "marketplace"] as ChKey[]).map((k) => ({ k, v: p.returnPct[k] })).filter((x) => x.v != null && (p.sales[x.k] ?? 0) > 10_000).sort((a, b) => b.v! - a.v!)[0];
    out.push({ tone: "warn", title: `Return % ${pct(rp, 1)} vs ${pct(f.catReturn, 1)} category average`, detail: `${worst ? `Highest on ${CH_LABEL[worst.k]} (${pct(worst.v, 1)}). ` : ""}Review size guidance, imagery / description and quality feedback.` });
  }
  // 6. momentum
  if (row.mom != null && row.mom <= -0.25 && row.p30Units >= 10) out.push({ tone: "warn", title: `L30 down ${pct(-row.mom, 0)} vs prior 30 days`, detail: row.doi != null && row.doi < 21 ? "Stock is thin — availability may be limiting sales; check store and size availability first." : "Stock is available — check price, visibility and listings on the declining channels." });
  if (row.mom != null && row.mom >= 0.25 && row.l30Units >= 10) out.push({ tone: "good", title: `Momentum: L30 up ${pct(row.mom, 0)} vs prior 30 days`, detail: row.doi != null && row.doi < 45 ? `Secure stock — only ${num(row.doi)} days of cover at the current rate.` : "Keep it visible and in stock across the top stores and channels." });
  // 7. slow / overstock
  if (stock >= 30 && (row.doi == null || row.doi > 180) && (p.daysSinceLive ?? 999) >= 45) out.push({ tone: "warn", title: `${num(stock)} units with ${row.doi == null ? "no sales in 30 days" : `${num(row.doi)} days of cover`}`, detail: "Redistribute to the stores / channels where it sells and review visibility; markdown only where business rules allow." });
  // 8. channel gaps
  const on = roll?.ch.online.l30u ?? 0, mk = roll?.ch.marketplace.l30u ?? 0;
  if (allL30u >= 10 && mk === 0) out.push({ tone: "info", title: "No marketplace sales in 30 days", detail: `It sells ${num(allL30u)} units elsewhere — check listing, content and inventory sync on AJIO / Myntra / Flipkart / Amazon.` });
  if (allL30u >= 10 && on === 0) out.push({ tone: "info", title: "No online (Shopify) sales in 30 days", detail: `It sells ${num(allL30u)} units in other channels — check the listing is live and in stock online.` });
  // 9. penetration
  const selling = f.stores.filter((s) => s.l30u > 0);
  const perStore = selling.length ? selling.reduce((a, s) => a + s.l30, 0) / selling.length : null;
  if (perStore != null && f.catStorePerStore != null && perStore > f.catStorePerStore * 1.5 && selling.length < f.activeStores * 0.4 && row.whInv >= 10)
    out.push({ tone: "good", title: `Strong where listed: ${inr(perStore)} / store (L30) in ${selling.length} stores`, detail: `${pct(perStore / f.catStorePerStore - 1, 0)} above the category's per-store rate. Extend to more stores from the ${num(row.whInv)} warehouse units.` });
  // 10. zone balance
  const zoneOf = (r: string | null) => (r && /north/i.test(r) ? "North" : r && /south/i.test(r) ? "South" : null);
  const zoned = f.stores.filter((s) => zoneOf(s.region) && s.l30u > 0);
  const northU = zoned.filter((s) => zoneOf(s.region) === "North").reduce((a, s) => a + s.l30u, 0), zU = zoned.reduce((a, s) => a + s.l30u, 0);
  if (zU >= 10 && row.whInv >= 20) {
    const ns = northU / zU, nw = row.whNorth / row.whInv;
    if (ns >= 0.3 && nw < 0.1) out.push({ tone: "info", title: `North stores take ${pct(ns, 0)} of store sales; North warehouse holds ${pct(nw, 0)}`, detail: "Rebalance stock to SAPL-NORTH-TAURU to shorten replenishment to North stores." });
    if (ns <= 0.1 && nw >= 0.4) out.push({ tone: "info", title: `${pct(nw, 0)} of warehouse stock is in the North; North stores take ${pct(ns, 0)} of store sales`, detail: "Move stock to the South warehouses (SAPL-WH1 / SAPL-WH2) where demand is." });
  }
  // 11. latest inward
  const last = f.inwards.at(-1);
  if (last && f.soldSinceInward != null && last.qty > 0) {
    const days = diffDays(last.d.slice(0, 10), f.asOf);
    const r = f.soldSinceInward / last.qty;
    if (days >= 14) out.push({ tone: r < 0.2 ? "warn" : "info", title: `Latest inward (${num(last.qty)} units, ${days} days ago): ${num(f.soldSinceInward)} sold since`, detail: r < 0.2 ? "Slow start for the new stock — check it reached stores and listings." : `${pct(r, 0)} of that inward quantity sold since it landed (all channels).` });
  }
  return out;
}

export { ZONE };
