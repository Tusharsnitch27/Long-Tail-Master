import "server-only";
import { addDays, addMonths, diffDays, startOfMonth, type Range } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { PRICE_BANDS } from "@/lib/filters";
import type { Ctx } from "./context";
import { loadScope, productPerformance, lastNDays, type ProductPerf } from "./scope";
import { channelMetrics, type ChKey } from "./channelData";
import { computePlan } from "./plan";
import { getTargetBook, listMonthTargets } from "./data/targetBook";
import { getStoreCategoryMix, catKey } from "./data/inventory";
import { getRecentInwards } from "./data/metafields";
import { productCode } from "./data/warehouse";
import { productL1, type Product } from "./data/products";
import { isGiftProduct } from "./planning";

/**
 * Admin Lab — experimental views computed from the same sources as the rest of the tool. Nothing here is a rule yet;
 * views that prove useful get promoted into the main pages.
 */
const CH: ChKey[] = ["stores", "online", "marketplace"];
const quantile = (xs: number[], q: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lin = (v: number | null, bad: number, good: number) => (v == null ? null : clamp01((v - bad) / (good - bad)));
export const GOAL = 100 * 1e7; // ₹100 Cr

export function fyOf(asOf: string) {
  const y = Number(asOf.slice(0, 4)), m = Number(asOf.slice(5, 7));
  const from = `${m >= 4 ? y : y - 1}-04-01`;
  return { from, to: addDays(addMonths(from, 12), -1), label: `FY${String((m >= 4 ? y : y - 1) + 1).slice(2)}` };
}

export async function buildLab(ctx: Ctx) {
  const { range, compare } = ctx.period;
  const ch = ctx.filters.channel, mp = ctx.filters.mp;
  const ms = startOfMonth(ctx.asOf);
  const l30 = lastNDays(ctx.asOf, 30);
  const fy = fyOf(ctx.asOf);
  const fyToDate: Range = { from: fy.from, to: ctx.asOf };
  const sc = await loadScope(ctx, [l30, fyToDate]);
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const [perf, perfAllRaw, book, mts, mix, recent] = await Promise.all([
    productPerformance(ctx, sc.pm, whUnits, ch, mp),
    ch === "all" && !mp ? Promise.resolve(null) : productPerformance(ctx, sc.pm, whUnits, "all", null),
    getTargetBook(ms, ms),
    listMonthTargets(fy.from, addMonths(fy.from, 11)),
    getStoreCategoryMix().catch(() => ({ date: null, rows: [] })),
    getRecentInwards(90).catch(() => []),
  ]);
  const perfAll = perfAllRaw ?? perf;
  const allBy = new Map(perfAll.rows.map((r) => [r.sku, r]));
  const gift = (p: Product | undefined, r?: ProductPerf) => !!p && isGiftProduct(p, r);
  const rows = perf.rows.filter((r) => !gift(r.p, allBy.get(r.sku)));
  const allRows = perfAll.rows.filter((r) => !gift(r.p, r));
  const products = sc.products.filter((p) => !gift(p, allBy.get(p.sku)));
  const cats = ctx.filters.cats;
  const stockOf = (p: Product) => Math.max(0, p.invOffline ?? 0) + Math.max(0, whUnits(p.sku));
  const th = ctx.settings.thresholds;

  /* 1 · category health scorecard */
  const health = cats.map((c) => {
    const f = sc.facts.filter((x) => x.c === c), u = sc.uc.filter((x) => x.c === c);
    const m = channelMetrics(f, u, range, ch, mp), p = channelMetrics(f, u, compare, ch, mp);
    const plan = computePlan(f, u, ctx.asOf, ch, book, [c], th);
    const ps = products.filter((x) => x.category === c);
    const stock = ps.reduce((a, x) => a + stockOf(x), 0);
    const l30U = allRows.filter((r) => r.category === c).reduce((a, r) => a + r.l30Units, 0);
    const doi = l30U > 0 ? stock / (l30U / 30) : null;
    const sold = ps.reduce((a, x) => a + (x.sales.all ?? 0), 0), ret = ps.reduce((a, x) => a + (x.returnsValue.all ?? 0), 0);
    const returnPct = sold > 0 ? ret / sold : null;
    const cr = rows.filter((r) => r.category === c && r.revenue > 0);
    const catRev = cr.reduce((a, r) => a + r.revenue, 0);
    const top10 = safeDiv(cr.slice(0, 10).reduce((a, r) => a + r.revenue, 0), catRev);
    const g = growth(m.revenue, p.revenue);
    const coverScore = doi == null ? null : doi < 14 ? 0 : doi < 30 ? lin(doi, 14, 30) : doi <= 90 ? 1 : doi <= 180 ? 1 - lin(doi, 90, 180)! : 0;
    const parts = [
      { k: "Growth", s: lin(g, -0.2, 0.2) }, { k: "Achievement", s: lin(plan.achievement, 0.6, 1) }, { k: "Cover", s: coverScore },
      { k: "Returns", s: lin(returnPct == null ? null : -returnPct, -0.25, -0.05) }, { k: "Concentration", s: lin(top10 == null ? null : -top10, -0.9, -0.5) },
    ];
    const have = parts.filter((x) => x.s != null);
    const score = have.length ? Math.round((have.reduce((a, x) => a + x.s!, 0) / have.length) * 100) : null;
    return { c, revenue: m.revenue, growth: g, ach: plan.achievement, hasTarget: plan.monthTarget != null, doi, returnPct, top10, score, parts };
  });

  /* 2 · path to ₹100 Cr (always all channels) */
  const fyDaysLeft = diffDays(ctx.asOf, fy.to);
  const path = cats.map((c) => {
    const f = sc.facts.filter((x) => x.c === c), u = sc.uc.filter((x) => x.c === c);
    const r30 = channelMetrics(f, u, l30, "all").revenue;
    const ytd = channelMetrics(f, u, fyToDate, "all").revenue;
    const runRate = (r30 / 30) * 365;
    const landing = ytd + (r30 / 30) * fyDaysLeft;
    const planRows = mts.filter((m) => m.category === c);
    const plan = planRows.length ? planRows.reduce((a, m) => a + m.target, 0) : null;
    const planMonths = new Set(planRows.map((m) => m.month)).size;
    return { c, r30, ytd, runRate, landing, plan, planMonths, gap: plan == null ? null : plan - landing };
  }).sort((a, b) => b.runRate - a.runRate);
  const pathTot = path.reduce((a, x) => ({ runRate: a.runRate + x.runRate, ytd: a.ytd + x.ytd, landing: a.landing + x.landing, plan: a.plan + (x.plan ?? 0) }), { runRate: 0, ytd: 0, landing: 0, plan: 0 });

  /* 3 · Pareto / concentration */
  const pareto = cats.map((c) => {
    const cr = rows.filter((r) => r.category === c && r.revenue > 0);
    const tot = cr.reduce((a, r) => a + r.revenue, 0);
    let acc = 0, n80 = 0;
    for (const r of cr) { if (acc >= tot * 0.8) break; acc += r.revenue; n80++; }
    const half = Math.ceil(cr.length / 2);
    const tailShare = safeDiv(cr.slice(half).reduce((a, r) => a + r.revenue, 0), tot);
    const core = new Set(cr.slice(0, n80).map((r) => r.sku));
    const ps = products.filter((p) => p.category === c);
    const stock = ps.reduce((a, p) => a + stockOf(p), 0);
    const tailStock = ps.filter((p) => !core.has(p.sku)).reduce((a, p) => a + stockOf(p), 0);
    return { c, active: cr.length, catalogue: ps.length, n80, top10: safeDiv(cr.slice(0, 10).reduce((a, r) => a + r.revenue, 0), tot), tailShare, tailStockShare: safeDiv(tailStock, stock), revenue: tot };
  });

  /* 4 · price-band mix & ASP drift */
  const bands = cats.map((c) => {
    const cr = rows.filter((r) => r.category === c && r.revenue > 0);
    const tot = cr.reduce((a, r) => a + r.revenue, 0);
    const by = PRICE_BANDS.map((b) => {
      const inB = cr.filter((r) => { const v = r.p?.mrp; return v != null && v >= b.min && v <= b.max; });
      return { key: b.key, label: b.label, share: safeDiv(inB.reduce((a, r) => a + r.revenue, 0), tot) ?? 0 };
    });
    const f = sc.facts.filter((x) => x.c === c), u = sc.uc.filter((x) => x.c === c);
    const a = channelMetrics(f, u, range, ch, mp).asp, b = channelMetrics(f, u, compare, ch, mp).asp;
    const mrpW = safeDiv(cr.reduce((s, r) => s + (r.p?.mrp ?? 0) * r.units, 0), cr.reduce((s, r) => s + (r.p?.mrp ? r.units : 0), 0));
    return { c, by, asp: a, prevAsp: b, drift: growth(a, b), realisation: a != null && mrpW ? a / mrpW : null };
  });

  /* 5 · new-launch tracker (live ≤ 60 days) */
  const known = new Set(sc.pm.keys());
  const recentBy = new Map<string, number>();
  for (const r of recent) if (r.sku) { const k = productCode(String(r.sku), known); recentBy.set(k, (recentBy.get(k) ?? 0) + r.qty); }
  // benchmark = an established good seller: 75th percentile L30 units/day of the category's SKUs live > 90 days and selling
  const benchBy = new Map(cats.map((c) => [c, quantile(products.filter((p) => p.category === c && (p.daysSinceLive ?? 0) > 90).map((p) => (allBy.get(p.sku)?.l30Units ?? 0) / 30).filter((v) => v > 0), 0.75)]));
  const launches = products.filter((p) => p.daysSinceLive != null && p.daysSinceLive >= 0 && p.daysSinceLive <= 60).map((p) => {
    const r = allBy.get(p.sku);
    const days = Math.max(1, p.daysSinceLive!);
    const vel = (r?.l30Units ?? 0) / Math.min(30, days);
    const bench = benchBy.get(p.category!) ?? null;
    const inward = recentBy.get(p.sku) ?? p.inwardTotal ?? null;
    const idx = bench ? vel / bench : null;
    return { sku: p.sku, name: p.name ?? p.sku, image: p.image, c: p.category!, l1: productL1(p), days, units: r?.l30Units ?? 0, revenue: r?.l30 ?? 0, vel, bench, idx,
      inward, sellThrough: inward ? (p.qty.all ?? r?.l30Units ?? 0) / inward : null, stock: stockOf(p),
      verdict: idx == null ? "No benchmark" : idx >= 1.5 ? "Hit" : idx >= 0.7 ? "On par" : "Slow" };
  }).sort((a, b) => (b.idx ?? -1) - (a.idx ?? -1));

  /* 6 · size-curve gaps (warehouse) on sellers */
  const sizeGaps = allRows.filter((r) => r.l30Units >= 8).flatMap((r) => {
    const w = sc.wh.bySku.get(r.sku);
    if (!w) return [];
    const sizes = Object.entries(w.bySize).filter(([s]) => s && s !== "One size");
    if (sizes.length < 3) return [];
    const zero = sizes.filter(([, u]) => u <= 0).map(([s]) => s);
    if (!zero.length) return [];
    const sortSz = (a: string, b: string) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b);
    return [{ sku: r.sku, name: r.name, image: r.image, c: r.category ?? "", l30Units: r.l30Units, revenue: r.l30, zero: zero.sort(sortSz), inStock: sizes.filter(([, u]) => u > 0).map(([s, u]) => `${s}:${u}`).sort((a, b) => sortSz(a.split(":")[0], b.split(":")[0])), broken: zero.length / sizes.length, whUnits: w.units, storeInv: r.storeInv ?? 0 }];
  }).sort((a, b) => b.revenue - a.revenue);

  /* 7 · store × category penetration (store report, L30 units) */
  const tot = new Map<string, number>(), cell = new Map<string, number>(), inv = new Map<string, number>();
  for (const r of mix.rows) {
    tot.set(r.b, (tot.get(r.b) ?? 0) + r.s30);
    const k = catKey(r.cat); if (!k) continue;
    cell.set(`${r.b}|${k}`, (cell.get(`${r.b}|${k}`) ?? 0) + r.s30); inv.set(`${r.b}|${k}`, (inv.get(`${r.b}|${k}`) ?? 0) + r.inv);
  }
  const storesRanked = [...tot.entries()].filter(([b, u]) => u > 0 && ctx.byCode.has(b)).sort((a, b) => b[1] - a[1]);
  const medShare = new Map(cats.map((c) => [c, median(storesRanked.map(([b, u]) => (cell.get(`${b}|${c}`) ?? 0) / u).filter((v) => v > 0)) ?? 0]));
  const heat = {
    date: mix.date, medShare: Object.fromEntries(medShare),
    rows: storesRanked.slice(0, 30).map(([b, u]) => ({ b, store: ctx.byCode.get(b)?.short_name ?? b, city: ctx.byCode.get(b)?.city ?? null, units: u,
      cells: Object.fromEntries(cats.map((c) => { const s = (cell.get(`${b}|${c}`) ?? 0) / u; return [c, { share: s, idx: (medShare.get(c) ?? 0) > 0 ? s / medShare.get(c)! : null, live: (inv.get(`${b}|${c}`) ?? 0) > 0 || (cell.get(`${b}|${c}`) ?? 0) > 0 }]; })) })),
  };

  /* 8 · dead-stock ageing */
  const buckets = ["0–30", "31–60", "61–90", "90+"] as const;
  const bucketOf = (last: string | null | undefined) => { if (!last) return 3; const d = diffDays(last, ctx.asOf); return d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3; };
  const agedP = products.filter((p) => stockOf(p) > 0 && (p.daysSinceLive == null || p.daysSinceLive > 30));
  const ageing = cats.map((c) => {
    const b = buckets.map(() => ({ units: 0, value: 0, skus: 0 }));
    for (const p of agedP.filter((x) => x.category === c)) { const i = bucketOf(allBy.get(p.sku)?.last); const s = stockOf(p); b[i].units += s; b[i].value += s * (p.mrp ?? 0); b[i].skus++; }
    return { c, b };
  });
  const deadList = agedP.filter((p) => bucketOf(allBy.get(p.sku)?.last) >= 2).map((p) => ({ sku: p.sku, name: p.name ?? p.sku, image: p.image, c: p.category!, stock: stockOf(p), value: stockOf(p) * (p.mrp ?? 0), last: allBy.get(p.sku)?.last ?? null, days: p.daysSinceLive, storeInv: p.invOffline ?? 0, wh: whUnits(p.sku) }))
    .sort((a, b) => b.value - a.value);

  /* 9 · channel-mix shift */
  const mixShift = cats.map((c) => {
    const f = sc.facts.filter((x) => x.c === c), u = sc.uc.filter((x) => x.c === c);
    const cur = CH.map((k) => channelMetrics(f, u, range, k).revenue), prev = CH.map((k) => channelMetrics(f, u, compare, k).revenue);
    const ct = cur.reduce((a, x) => a + x, 0), pt = prev.reduce((a, x) => a + x, 0);
    return { c, total: ct, ch: CH.map((k, i) => ({ k, share: safeDiv(cur[i], ct), prev: safeDiv(prev[i], pt), pp: ct && pt ? cur[i] / ct - prev[i] / pt : null, growth: growth(cur[i], prev[i]) })) };
  });

  /* 10 · return-cost leakage (lifetime) */
  const leakage = cats.map((c) => {
    const ps = products.filter((p) => p.category === c);
    return { c, ch: CH.map((k) => { const s = ps.reduce((a, p) => a + (p.sales[k] ?? 0), 0), r = ps.reduce((a, p) => a + (p.returnsValue[k] ?? 0), 0); return { k, sold: s, returned: r, pct: safeDiv(r, s) }; }),
      returned: ps.reduce((a, p) => a + (p.returnsValue.all ?? 0), 0), sold: ps.reduce((a, p) => a + (p.sales.all ?? 0), 0) };
  });
  const leakSkus = products.filter((p) => (p.returnsValue.all ?? 0) > 0).map((p) => ({ sku: p.sku, name: p.name ?? p.sku, image: p.image, c: p.category!, returned: p.returnsValue.all ?? 0, pct: p.returnPct.all, on: p.returnPct.online, mp: p.returnPct.marketplace, st: p.returnPct.stores, sold: p.sales.all ?? 0 }))
    .sort((a, b) => b.returned - a.returned).slice(0, 12);

  /* 11 · marketplace listing gaps */
  // potential at the long-tail-wide marketplace : online revenue ratio (a category that barely sells on marketplaces is itself the gap)
  const onAll = allRows.reduce((a, r) => a + r.byChannel.online.revenue, 0), mpAll = allRows.reduce((a, r) => a + r.byChannel.marketplace.revenue, 0);
  const mpRatio = onAll > 0 ? Math.min(1.5, mpAll / onAll) : 0;
  const mpGaps = allRows.filter((r) => r.byChannel.online.units >= 5 && r.byChannel.marketplace.units === 0 && r.whInv >= 10).map((r) => ({
    sku: r.sku, name: r.name, image: r.image, c: r.category ?? "", onUnits: r.byChannel.online.units, onRev: r.byChannel.online.revenue, mpLifetime: r.p?.qty.marketplace ?? 0, wh: r.whInv,
    potential: r.byChannel.online.revenue * mpRatio,
  })).sort((a, b) => b.onRev - a.onRev);

  /* 12 · cannibalisation hints (same category + type) */
  const groups = new Map<string, ProductPerf[]>();
  for (const r of allRows) { const l1 = r.p ? productL1(r.p) : null; if (!l1 || !r.category) continue; const k = `${r.category}|${l1}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const cannibal = [...groups.entries()].flatMap(([k, rs]) => {
    const [c, l1] = k.split("|");
    const fresh = rs.filter((r) => (r.p?.daysSinceLive ?? 999) <= 45 && r.l7 > 0), old = rs.filter((r) => (r.p?.daysSinceLive ?? 999) > 60);
    if (!fresh.length || old.length < 2) return [];
    const oL7 = old.reduce((a, r) => a + r.l7, 0), oP7 = old.reduce((a, r) => a + r.p7, 0), fL7 = fresh.reduce((a, r) => a + r.l7, 0), fP7 = fresh.reduce((a, r) => a + r.p7, 0);
    const gL7 = rs.reduce((a, r) => a + r.l7, 0), gP7 = rs.reduce((a, r) => a + r.p7, 0);
    const oldChg = growth(oL7, oP7), grpChg = growth(gL7, gP7);
    if (oldChg == null || grpChg == null || oldChg > -0.15 || grpChg > 0.05 || fL7 < gL7 * 0.2 || oP7 < 5000) return [];
    return [{ c, l1, fresh: fresh.sort((a, b) => b.l7 - a.l7).slice(0, 3).map((r) => ({ sku: r.sku, name: r.name, image: r.image, l7: r.l7 })), freshL7: fL7, freshP7: fP7, oldL7: oL7, oldP7: oP7, oldChg, grpChg, oldCount: old.length }];
  }).sort((a, b) => a.oldChg - b.oldChg);

  /* 13 · inventory turns & GMROI */
  const turns = cats.map((c) => {
    const ps = products.filter((p) => p.category === c);
    const stock = ps.reduce((a, p) => a + stockOf(p), 0);
    const withCogs = ps.filter((p) => p.cogs != null && p.cogs > 0);
    const stockCost = withCogs.reduce((a, p) => a + stockOf(p) * p.cogs!, 0);
    const stockMrp = ps.reduce((a, p) => a + stockOf(p) * (p.mrp ?? 0), 0);
    const cr = allRows.filter((r) => r.category === c);
    const l30U = cr.reduce((a, r) => a + r.l30Units, 0), l30R = cr.reduce((a, r) => a + r.l30, 0);
    const costSold = cr.reduce((a, r) => a + r.l30Units * (r.p?.cogs ?? 0), 0);
    const cogsCover = safeDiv(cr.filter((r) => (r.p?.cogs ?? 0) > 0).reduce((a, r) => a + r.l30, 0), l30R);
    return { c, stock, stockCost, stockMrp, l30U, l30R, turns: stock > 0 ? (l30U * 12) / stock : null, gmroi: stockCost > 0 && cogsCover != null && cogsCover > 0.5 ? ((l30R - costSold) * 12) / stockCost : null, cogsCover, gm: l30R > 0 && cogsCover != null && cogsCover > 0.5 ? 1 - costSold / l30R : null };
  });

  return { mpRatio, fy, fyDaysLeft, health, path, pathTot, pareto, bands, launches, benchBy: Object.fromEntries(benchBy), sizeGaps, heat, buckets, ageing, deadList, mixShift, leakage, leakSkus, mpGaps, cannibal, turns, l30 };
}
