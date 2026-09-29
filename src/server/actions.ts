import "server-only";
import { addDays, rangeDays, resolvePeriod, startOfMonth, type Range } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { cached } from "@/lib/cache";
import { catLabel } from "./views";
import { loadFacts, type Ctx } from "./context";
import { groupFacts, summarize, monthOutlook } from "./analytics";
import { getSkuFacts } from "./data/sku";
import { getChannelSku, getChannelDaily } from "./data/channels";
import { getProductMap, type Product } from "./data/products";
import { getWarehouseStock } from "./data/warehouse";
import { getStoreInventory, getStoreInventoryCoverage } from "./data/inventory";
import { CH_LABEL, ucChannel, type ChKey } from "./channelData";

/**
 * Action engine. Every action is a measurable opportunity or risk someone can act on — never "no sales = bad".
 * Rules combine velocity, inventory (store + warehouse), distribution, channel, peers and target context.
 */
export type ActionGroup = "channel" | "store" | "sku" | "merchandising";
export type Priority = "urgent" | "high" | "medium";
export interface Action {
  key: string;
  group: ActionGroup;
  type: string;
  typeLabel: string;
  priority: Priority;
  title: string;
  reason: string;
  recommendation: string;
  impact: number; // ₹ at stake (opportunity or risk)
  impactLabel: string;
  confidence: "high" | "medium" | "low";
  category: string | null;
  product?: { sku: string; name: string | null; image: string | null };
  store?: { code: string; name: string };
  evidence: { label: string; value: string }[];
  links: { label: string; href: string }[];
}

export const RULES = {
  channelDropPct: -0.15, channelDropMin: 25_000, urgentChannelDrop: 200_000,
  mixShiftPp: 0.08,
  returnExcessPp: 0.1, returnMinSales: 100_000,
  fastDoiDays: 14, urgentDoiDays: 7, fastMinPerDay: 1,
  slowDoiDays: 180, slowMinUnits: 150,
  distTopQuantile: 0.75, distMaxPenetration: 0.3, distMinWarehouse: 30,
  declineL30: -0.25, declineL7: -0.15, declineMinPrevUnits: 30,
  allocMinL7: 3, allocCoverDays: 21, allocMinWarehouse: 10,
  idleSellThroughRatio: 0.3, idleMinUnits: 15,
  catGapRatio: 0.4,
};

const inr = (v: number) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : Math.abs(v) >= 1e3 ? `₹${(v / 1e3).toFixed(1)}K` : `₹${Math.round(v)}`);
const pc = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const sp = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const num = (v: number) => Math.round(v).toLocaleString("en-IN");
const prodRef = (p: Product | undefined, sku: string) => ({ sku, name: p?.name ?? sku, image: p?.image ?? null });

export async function buildActions(ctx: Ctx): Promise<{ actions: Action[]; coverage: { feedStores: number; asOf: string; inventoryAsOf: string | null } }> {
  const key = `actions:v5:${ctx.asOf}:${ctx.filters.cats.join(",")}`;
  return cached(key, 600, () => compute(ctx));
}

async function compute(ctx: Ctx) {
  const a = ctx.asOf;
  const cats = new Set(ctx.filters.cats);
  const l30 = resolvePeriod("l30", a, ctx.today);
  const l7: Range = { from: addDays(a, -6), to: a }, p7: Range = { from: addDays(a, -13), to: addDays(a, -7) };
  const p30: Range = { from: addDays(a, -59), to: addDays(a, -30) };
  const [pm, storeSkuRaw, ucSku, ucDaily, facts, cov] = await Promise.all([
    getProductMap(),
    getSkuFacts({ range: l30.range, compare: p30, asOf: a, cats: ctx.filters.cats, ch: "store" }),
    getChannelSku({ range: l30.range, compare: p30, asOf: a }),
    getChannelDaily({ from: p30.from, to: a }),
    loadFacts({ ...ctx, filters: { ...ctx.filters, stores: [] } }, [{ from: addDays(a, -60), to: a }]),
    getStoreInventoryCoverage(),
  ]);
  // store × SKU sales keyed to branch codes (CHANNEL = store name)
  const storeSku = storeSkuRaw.map((f) => { const st = ctx.byName.get(f.ch.toUpperCase()); return { ...f, b: st?.branch_code ?? null, store: st?.short_name ?? f.ch.replace(/^SNITCH\s*-\s*/i, "") }; });
  const known = new Set(pm.keys());
  const [wh, storeInv] = await Promise.all([getWarehouseStock(known), getStoreInventory([...known])]);
  const inCat = (sku: string) => { const c = pm.get(sku)?.category; return !!c && cats.has(c); };
  const actions: Action[] = [];
  const whUnits = (sku: string) => wh.bySku.get(sku)?.units ?? 0;
  const feed = new Set(cov.map((c) => String(c.b)));

  /* ---------------- per-product velocity (all channels) & inventory */
  interface V { l7: number; p7: number; l30: number; p30: number; rev30: number; storeCount: number; bySource: Record<ChKey, number> }
  const vel = new Map<string, V>();
  const v = (sku: string) => { let e = vel.get(sku); if (!e) vel.set(sku, (e = { l7: 0, p7: 0, l30: 0, p30: 0, rev30: 0, storeCount: 0, bySource: { stores: 0, online: 0, marketplace: 0 } })); return e; };
  for (const f of storeSku) { if (!inCat(f.sku)) continue; const e = v(f.sku); e.l7 += f.l7q; e.p7 += f.p7q; e.l30 += f.l30q; e.p30 += f.pq; e.rev30 += f.l30s; e.bySource.stores += f.l30s; if (f.l30q > 0) e.storeCount++; }
  for (const f of ucSku) { if (!inCat(f.sku) || !ucChannel(f.mp)) continue; const e = v(f.sku); e.l7 += f.l7q; e.p7 += f.p7q; e.l30 += f.l30q; e.p30 += f.pq; e.rev30 += f.l30s; e.bySource[ucChannel(f.mp)!] += f.l30s; }
  const activeStores = ctx.stores.filter((s) => s.last_seen && s.last_seen >= addDays(a, -30)).length || 1;

  /* ---------------- CHANNEL */
  const chRev = (k: ChKey | string, r: Range, isMp = false) => {
    if (k === "stores") return summarize(facts, r).sales;
    return ucDaily.filter((x) => cats.has(x.c) && x.d >= r.from && x.d <= r.to && (isMp ? x.mp === k : ucChannel(x.mp) === k)).reduce((s2, x) => s2 + x.revenue, 0);
  };
  const channels: { k: string; label: string; isMp: boolean }[] = [
    ...(["stores", "online", "marketplace"] as ChKey[]).map((k) => ({ k, label: CH_LABEL[k], isMp: false })),
    ...Array.from(new Set(ucDaily.filter((x) => ucChannel(x.mp) === "marketplace").map((x) => x.mp))).map((mp) => ({ k: mp, label: mp, isMp: true })),
  ];
  for (const c of channels) {
    const cur = chRev(c.k, l7, c.isMp), prev = chRev(c.k, p7, c.isMp), g = growth(cur, prev);
    if (g == null || g > RULES.channelDropPct || prev - cur < RULES.channelDropMin) continue;
    // contributors: categories and products
    const catParts = ctx.filters.cats.map((ck) => {
      const cc = (r: Range) => c.k === "stores" ? summarize(facts.filter((f) => f.c === ck), r).sales : ucDaily.filter((x) => x.c === ck && x.d >= r.from && x.d <= r.to && (c.isMp ? x.mp === c.k : ucChannel(x.mp) === c.k)).reduce((s2, x) => s2 + x.revenue, 0);
      return { ck, d: cc(l7) - cc(p7) };
    }).sort((x, y) => x.d - y.d);
    const skuDrops = (c.k === "stores" ? storeSku.map((f) => ({ sku: f.sku, d: f.l7s - f.p7s }))
      : ucSku.filter((f) => (c.isMp ? f.mp === c.k : ucChannel(f.mp) === c.k)).map((f) => ({ sku: f.sku, d: f.l7s - f.p7s })))
      .filter((x) => inCat(x.sku)).reduce((m, x) => m.set(x.sku, (m.get(x.sku) ?? 0) + x.d), new Map<string, number>());
    const topSku = [...skuDrops.entries()].sort((x, y) => x[1] - y[1]).slice(0, 3);
    const drop = prev - cur;
    const topShare = safeDiv(-topSku.filter(([, d]) => d < 0).reduce((s2, [, d]) => s2 + d, 0), drop);
    // for the marketplace aggregate: which marketplace carries the decline
    const mpShares = c.k === "marketplace"
      ? Array.from(new Set(ucDaily.filter((x) => ucChannel(x.mp) === "marketplace").map((x) => x.mp))).map((mp) => ({ mp, d: chRev(mp, l7, true) - chRev(mp, p7, true) })).filter((x) => x.d < 0).sort((x, y) => x.d - y.d)
      : [];
    actions.push({
      key: `ch-drop:${c.k}:${a}`, group: "channel", type: "channel_decline", typeLabel: "Channel decline",
      priority: drop >= RULES.urgentChannelDrop && g <= -0.25 ? "urgent" : drop >= 75_000 ? "high" : "medium",
      title: `${c.label} sales ${sp(g)} WoW`,
      reason: [`Last 7 days vs the 7 days before (complete days to ${a}).`,
        mpShares[0] ? `${mpShares[0].mp} represents ${pc(-mpShares[0].d / drop)} of the decline.` : "",
        topShare != null && topShare > 0 ? `${topSku.filter(([, d]) => d < 0).length} products account for ${pc(topShare)} of it.` : ""].filter(Boolean).join(" "),
      recommendation: `Review availability, listing and pricing for ${topSku.length ? topSku.map(([s]) => pm.get(s)?.name ?? s).join(", ") : "the top products"}${c.k === "stores" ? " in the largest declining stores" : mpShares[0] ? ` on ${mpShares[0].mp}` : " on the channel"}.`,
      impact: drop, impactLabel: `${inr(drop)} lower in 7 days`, confidence: prev > 100_000 ? "high" : "medium", category: ctx.filters.cats.length === 1 ? ctx.filters.cats[0] : null,
      evidence: [
        { label: "Last 7 days", value: inr(cur) }, { label: "Prior 7 days", value: inr(prev) },
        ...mpShares.slice(0, 2).map((x) => ({ label: `${x.mp} share of decline`, value: pc(-x.d / drop) })),
        ...catParts.filter((x) => x.d < 0).slice(0, 2).map((x) => ({ label: `${catLabel(x.ck)} change`, value: inr(x.d) })),
        ...topSku.filter(([, d]) => d < 0).map(([s, d]) => ({ label: pm.get(s)?.name ?? s, value: inr(d) })),
      ],
      links: [{ label: "Open channel", href: c.isMp ? `/marketplace?mp=${c.k}` : c.k === "stores" ? "/stores" : `/${c.k}` }],
    });
  }
  // mix shift: channel share L30 vs prior 30, per category
  for (const ck of ctx.filters.cats) {
    const share = (r: Range) => {
      const st = summarize(facts.filter((f) => f.c === ck), r).sales;
      const on = ucDaily.filter((x) => x.c === ck && x.d >= r.from && x.d <= r.to && ucChannel(x.mp) === "online").reduce((s2, x) => s2 + x.revenue, 0);
      const mk = ucDaily.filter((x) => x.c === ck && x.d >= r.from && x.d <= r.to && ucChannel(x.mp) === "marketplace").reduce((s2, x) => s2 + x.revenue, 0);
      const t = st + on + mk || 1;
      return { stores: st / t, online: on / t, marketplace: mk / t };
    };
    const now = share(l30.range), before = share(p30);
    const moves = (Object.keys(now) as ChKey[]).map((k) => ({ k, d: now[k] - before[k] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    if (Math.abs(moves[0].d) >= RULES.mixShiftPp) {
      const up = moves.find((m) => m.d > 0), down = moves.find((m) => m.d < 0);
      actions.push({
        key: `ch-mix:${ck}:${a}`, group: "channel", type: "mix_shift", typeLabel: "Channel mix shift", priority: "medium",
        title: `${catLabel(ck)}: ${CH_LABEL[moves[0].k]} share ${pc(before[moves[0].k])} → ${pc(now[moves[0].k])}`,
        reason: "Share of category revenue, last 30 days vs the 30 days before.",
        recommendation: `Confirm whether the shift${up && down ? ` toward ${CH_LABEL[up.k]} and away from ${CH_LABEL[down.k]}` : ""} is intended (pricing, availability, campaigns).`,
        impact: 0, impactLabel: `${Math.round(Math.abs(moves[0].d) * 100)} pp shift`, confidence: "medium", category: ck,
        evidence: (Object.keys(now) as ChKey[]).map((k) => ({ label: CH_LABEL[k], value: `${pc(before[k])} → ${pc(now[k])}` })),
        links: [{ label: "Open channels", href: `/channels?cat=${ck}` }],
      });
    }
  }
  // return risk vs category benchmark (lifetime, value-based, per channel)
  for (const ck of ctx.filters.cats) {
    const ps = [...pm.values()].filter((p) => p.category === ck);
    for (const chn of ["online", "marketplace"] as const) {
      const tot = ps.reduce((s2, p) => ({ r: s2.r + (p.returnsValue[chn] ?? 0), s: s2.s + (p.sales[chn] ?? 0) }), { r: 0, s: 0 });
      const bench = safeDiv(tot.r, tot.s);
      if (bench == null) continue;
      for (const p of ps) {
        const rp = p.returnPct[chn], sales = p.sales[chn] ?? 0;
        if (rp == null || sales < RULES.returnMinSales || rp < bench + RULES.returnExcessPp || rp < bench * 1.4) continue;
        const excess = (rp - bench) * sales;
        actions.push({
          key: `ret:${chn}:${p.sku}`, group: "channel", type: "return_risk", typeLabel: "Return risk", priority: excess >= 500_000 ? "high" : "medium",
          title: `${p.name ?? p.sku}: ${CH_LABEL[chn]} returns ${pc(rp)} vs ${pc(bench)} category`,
          reason: `Lifetime return % (returned ₹ ÷ sold ₹) on ${CH_LABEL[chn]} is ${Math.round((rp - bench) * 100)} pp above the ${catLabel(ck)} average.`,
          recommendation: "Review size guidance, images/description and quality feedback for this product on the channel.",
          impact: excess, impactLabel: `${inr(excess)} returns above benchmark (lifetime)`, confidence: sales > 500_000 ? "high" : "medium", category: ck, product: prodRef(p, p.sku),
          evidence: [{ label: `${CH_LABEL[chn]} sales (lifetime)`, value: inr(sales) }, { label: "Return %", value: pc(rp) }, { label: "Category avg", value: pc(bench) }],
          links: [{ label: "View product", href: `/products/${encodeURIComponent(p.sku)}` }],
        });
      }
    }
  }

  /* ---------------- SKU */
  const perStoreRev: number[] = [];
  for (const e of vel.values()) if (e.storeCount > 0) perStoreRev.push(e.bySource.stores / e.storeCount);
  perStoreRev.sort((x, y) => x - y);
  const q = perStoreRev[Math.floor(perStoreRev.length * RULES.distTopQuantile)] ?? Infinity;
  for (const [sku, e] of vel) {
    const p = pm.get(sku);
    const stock = (p?.invOffline ?? 0) + whUnits(sku);
    const perDay = e.l7 / 7;
    const asp = safeDiv(e.rev30, e.l30) ?? p?.mrp ?? 0;
    const doi = perDay > 0 ? stock / perDay : Infinity;
    const base = { category: p?.category ?? null, product: prodRef(p, sku), links: [{ label: "View product", href: `/products/${encodeURIComponent(sku)}` }] };
    if (perDay >= RULES.fastMinPerDay && doi < RULES.fastDoiDays) {
      const short = Math.max(0, (RULES.fastDoiDays - doi) * perDay * asp);
      actions.push({
        ...base, key: `fast:${sku}`, group: "sku", type: "fast_low_doi", typeLabel: "Fast mover, low cover", priority: doi < RULES.urgentDoiDays ? "urgent" : "high",
        title: `${p?.name ?? sku}: ${doi.toFixed(0)} days of inventory left`, reason: `Selling ${perDay.toFixed(1)}/day (L7, all channels) against ${num(stock)} units in stores + warehouse.`,
        recommendation: whUnits(sku) > 0 ? "Plan replenishment now and push warehouse stock to the fastest stores." : "Raise a reorder — warehouse is empty.",
        impact: short, impactLabel: `${inr(short)} at risk in ${RULES.fastDoiDays} days`, confidence: e.l7 >= 20 ? "high" : "medium",
        evidence: [{ label: "L7 units", value: num(e.l7) }, { label: "Store inventory", value: num(p?.invOffline ?? 0) }, { label: "Warehouse", value: num(whUnits(sku)) }, { label: "Days of inventory", value: doi.toFixed(0) }],
      });
    } else if (stock >= RULES.slowMinUnits && (e.l30 === 0 || stock / (e.l30 / 30) > RULES.slowDoiDays)) {
      const value = stock * (p?.mrp ?? asp) * 0.5;
      actions.push({
        ...base, key: `slow:${sku}`, group: "sku", type: "slow_moving", typeLabel: "Slow moving", priority: value >= 1_000_000 ? "high" : "medium",
        title: `${p?.name ?? sku}: ${num(stock)} units, ${num(e.l30)} sold in 30 days`, reason: `${e.l30 ? `${Math.round(stock / (e.l30 / 30))} days` : "No sales"} of cover at the current rate.`,
        recommendation: "Redistribute to the stores / channels where it sells and review visibility; promotions only where business rules allow.",
        impact: value, impactLabel: `≈${inr(value)} tied up (at 50% of MRP)`, confidence: "high",
        evidence: [{ label: "Store inventory", value: num(p?.invOffline ?? 0) }, { label: "Warehouse", value: num(whUnits(sku)) }, { label: "L30 units", value: num(e.l30) }],
      });
    }
    // distribution: strong per selling store, low penetration, warehouse stock available
    if (e.storeCount > 0 && e.bySource.stores / e.storeCount >= q && e.storeCount / activeStores < RULES.distMaxPenetration && whUnits(sku) >= RULES.distMinWarehouse) {
      const opp = (activeStores * RULES.distMaxPenetration - e.storeCount) * (e.bySource.stores / e.storeCount) * 0.5;
      actions.push({
        ...base, key: `dist:${sku}`, group: "sku", type: "distribution", typeLabel: "Distribution opportunity", priority: opp >= 300_000 ? "high" : "medium",
        title: `${p?.name ?? sku}: strong where listed, in only ${e.storeCount} stores`, reason: `L30 sales per selling store (${inr(e.bySource.stores / e.storeCount)}) are in the top quartile; penetration ${pc(e.storeCount / activeStores)}.`,
        recommendation: `Extend to more stores from the ${num(whUnits(sku))} warehouse units.`,
        impact: opp, impactLabel: `≈${inr(opp)}/month if extended (conservative)`, confidence: "medium",
        evidence: [{ label: "Stores selling (L30)", value: num(e.storeCount) }, { label: "Sales / store (L30)", value: inr(e.bySource.stores / e.storeCount) }, { label: "Warehouse", value: num(whUnits(sku)) }],
      });
    }
    // sustained decline: both horizons agree
    const g30 = growth(e.l30, e.p30), g7 = growth(e.l7, e.p7);
    if (e.p30 >= RULES.declineMinPrevUnits && g30 != null && g7 != null && g30 <= RULES.declineL30 && g7 <= RULES.declineL7) {
      const lost = (e.p30 - e.l30) * asp;
      actions.push({
        ...base, key: `decl:${sku}`, group: "sku", type: "declining", typeLabel: "Sustained decline", priority: lost >= 300_000 ? "high" : "medium",
        title: `${p?.name ?? sku}: units ${sp(g30)} (30d) and ${sp(g7)} (7d)`, reason: "Decline holds over both the last 30 days and the last 7 days — not a one-day movement.",
        recommendation: stock < e.p30 ? "Check availability first — stock may be limiting sales." : "Stock is available; check price, visibility and listing.",
        impact: lost, impactLabel: `${inr(lost)} less in 30 days`, confidence: e.p30 >= 100 ? "high" : "medium",
        evidence: [{ label: "L30 units", value: num(e.l30) }, { label: "Prior 30", value: num(e.p30) }, { label: "L7 / prior 7", value: `${num(e.l7)} / ${num(e.p7)}` }, { label: "Stock (store + WH)", value: num(stock) }],
      });
    }
  }

  /* ---------------- STORE (DSR categories) */
  const mtdR: Range = { from: startOfMonth(a), to: a };
  const perDayBy = new Map<string, number>(); // `${b}|${c}` → MTD sales/day
  for (const [k, fs] of groupFacts(facts, (f) => `${f.b}|${f.c}`)) { const m = summarize(fs, mtdR); if (m.stores) perDayBy.set(k, m.sales / m.days); }
  const median = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const catMedian = new Map(ctx.filters.cats.map((ck) => [ck, median([...perDayBy.entries()].filter(([k]) => k.endsWith(`|${ck}`)).map(([, x]) => x))]));
  for (const [b, fs] of groupFacts(facts, (f) => f.b)) {
    const st = ctx.byCode.get(b);
    if (!st) continue;
    const name = st.short_name;
    const mo = monthOutlook(fs, a);
    const m = summarize(fs, mtdR);
    // target recovery: behind, but has shown the needed daily rate recently (best 7-day window in last 60 days)
    if (m.target && m.ach != null && m.ach < ctx.settings.thresholds.atRisk && mo.requiredRunRate && mo.remainingDays > 0) {
      let best = 0;
      for (let i = 0; i < 54; i++) { const r = { from: addDays(a, -i - 6), to: addDays(a, -i) }; best = Math.max(best, summarize(fs, r).sales / 7); }
      if (best >= mo.requiredRunRate) {
        const gap = Math.max((mo.monthTarget ?? 0) - mo.mtdSales, 0);
        actions.push({
          key: `rec:${b}:${a.slice(0, 7)}`, group: "store", type: "target_recovery", typeLabel: "Target recovery", priority: gap >= 150_000 ? "high" : "medium",
          title: `${name}: ${pc(m.ach)} of MTD target, but capable of the required rate`, reason: `Needs ${inr(mo.requiredRunRate)}/day for ${mo.remainingDays} days; its best 7-day run in the last 60 days was ${inr(best)}/day.`,
          recommendation: "Recoverable with focus: brief the store on the daily number and push the category's top sellers.",
          impact: gap, impactLabel: `${inr(gap)} to month target`, confidence: "medium", category: null, store: { code: b, name },
          evidence: [{ label: "MTD sales", value: inr(mo.mtdSales) }, { label: "Month target", value: inr(mo.monthTarget ?? 0) }, { label: "Needed / day", value: inr(mo.requiredRunRate) }, { label: "Best 7-day rate", value: inr(best) }],
          links: [{ label: "View store", href: `/stores/${b}` }],
        });
      }
    }
    // category gap: strong in one category, far below peers in another
    if (ctx.filters.cats.length > 1) {
      const strong = ctx.filters.cats.filter((ck) => (perDayBy.get(`${b}|${ck}`) ?? 0) >= (catMedian.get(ck) ?? Infinity));
      for (const ck of ctx.filters.cats) {
        const mine = perDayBy.get(`${b}|${ck}`) ?? 0, med = catMedian.get(ck) ?? 0;
        const hasTarget = (summarize(fs.filter((f) => f.c === ck), mtdR).target ?? 0) > 0;
        if (!strong.length || strong.includes(ck) || !hasTarget || med <= 0 || mine > med * RULES.catGapRatio) continue;
        const opp = (med - mine) * 30;
        actions.push({
          key: `gap:${b}:${ck}:${a.slice(0, 7)}`, group: "store", type: "category_gap", typeLabel: "Category gap", priority: opp >= 100_000 ? "high" : "medium",
          title: `${name}: strong in ${strong.map(catLabel).join(", ")}, weak in ${catLabel(ck)}`, reason: `${catLabel(ck)} MTD ${inr(mine)}/day vs ${inr(med)}/day for the median store.`,
          recommendation: `Check ${catLabel(ck)} range, display and staff focus at this store.`,
          impact: opp, impactLabel: `≈${inr(opp)}/month to reach the median`, confidence: "medium", category: ck, store: { code: b, name },
          evidence: [{ label: `${catLabel(ck)} / day`, value: inr(mine) }, { label: "Median store", value: inr(med) }, ...strong.map((s2) => ({ label: `${catLabel(s2)} / day`, value: inr(perDayBy.get(`${b}|${s2}`) ?? 0) }))],
          links: [{ label: "View store", href: `/stores/${b}` }],
        });
      }
    }
  }
  // inventory but low sales (feed stores): store's sell-through far below peers for the same category
  const stockBy = new Map<string, number>(), soldBy = new Map<string, number>();
  for (const r of storeInv) { const c = pm.get(r.sku)?.category; if (!c || !cats.has(c)) continue; stockBy.set(`${r.b}|${c}`, (stockBy.get(`${r.b}|${c}`) ?? 0) + r.units); }
  for (const f of storeSku) { if (!f.b || !feed.has(f.b) || !inCat(f.sku)) continue; const c = pm.get(f.sku)!.category!; soldBy.set(`${f.b}|${c}`, (soldBy.get(`${f.b}|${c}`) ?? 0) + f.l30q); }
  const catAsp = new Map(ctx.filters.cats.map((ck) => {
    const fs = storeSku.filter((f) => pm.get(f.sku)?.category === ck);
    return [ck, safeDiv(fs.reduce((x, f) => x + f.l30s, 0), fs.reduce((x, f) => x + f.l30q, 0)) ?? 0];
  }));
  for (const ck of ctx.filters.cats) {
    const rows = [...stockBy.entries()].filter(([k]) => k.endsWith(`|${ck}`)).map(([k, stock]) => ({ b: k.split("|")[0], stock, sold: soldBy.get(k) ?? 0 }));
    const med = median(rows.filter((r) => r.stock > 0).map((r) => r.sold / r.stock));
    for (const r of rows) {
      if (r.stock < RULES.idleMinUnits || med <= 0 || r.sold / r.stock >= med * RULES.idleSellThroughRatio) continue;
      const st = ctx.byCode.get(r.b);
      actions.push({
        key: `idle:${r.b}:${ck}`, group: "store", type: "inventory_low_sales", typeLabel: "Inventory, low sales", priority: "medium",
        title: `${st?.short_name ?? r.b}: ${num(r.stock)} ${catLabel(ck).toLowerCase()} units, ${num(r.sold)} sold in 30 days`,
        reason: `Sell-through ${pc(r.sold / r.stock)} vs ${pc(med)} for similar stores in the inventory feed.`,
        recommendation: "Rebalance part of this stock to stores that sell through faster, or review display.",
        impact: r.stock * (catAsp.get(ck) ?? 0), impactLabel: `≈${inr(r.stock * (catAsp.get(ck) ?? 0))} of stock idle (at ASP)`, confidence: "medium", category: ck, store: { code: r.b, name: st?.short_name ?? r.b },
        evidence: [{ label: "Store stock", value: num(r.stock) }, { label: "Sold L30", value: num(r.sold) }, { label: "Peer sell-through", value: pc(med) }],
        links: [{ label: "View store", href: `/stores/${r.b}` }],
      });
    }
  }

  /* ---------------- MERCHANDISING: allocation (feed stores) */
  const stockAt = new Map<string, number>();
  for (const r of storeInv) stockAt.set(`${r.b}|${r.sku}`, (stockAt.get(`${r.b}|${r.sku}`) ?? 0) + r.units);
  const whLeft = new Map<string, number>([...wh.bySku.entries()].map(([k, x]) => [k, x.units]));
  const alloc = storeSku.filter((f) => f.b && feed.has(f.b) && inCat(f.sku) && f.l7q >= RULES.allocMinL7).sort((x, y) => y.l7q - x.l7q);
  for (const f of alloc) {
    const stock = stockAt.get(`${f.b}|${f.sku}`) ?? 0;
    const perDay = f.l7q / 7;
    if (stock > perDay * 7) continue; // more than a week of cover
    const avail = whLeft.get(f.sku) ?? 0;
    if (avail < RULES.allocMinWarehouse) continue;
    const need = Math.ceil(perDay * RULES.allocCoverDays - stock);
    const qty = Math.max(1, Math.min(need, Math.floor(avail * 0.25)));
    whLeft.set(f.sku, avail - qty);
    const p = pm.get(f.sku), st = ctx.byCode.get(f.b!);
    const asp = safeDiv(f.l30s, f.l30q) ?? p?.mrp ?? 0;
    actions.push({
      key: `alloc:${f.b}:${f.sku}`, group: "merchandising", type: "allocation", typeLabel: "Allocation opportunity",
      priority: stock <= 1 && f.l7q >= 5 ? "urgent" : "high",
      title: `${p?.name ?? f.sku} → ${st?.short_name ?? f.store}`, reason: `Sold ${f.l7q} in 7 days with ${stock} in store — ${stock === 0 ? "out of stock" : `${(stock / perDay).toFixed(0)} days of cover`}; warehouse has ${num(avail)}.`,
      recommendation: `Review allocation of ~${qty} units (${RULES.allocCoverDays} days of cover at the current rate).`,
      impact: qty * asp, impactLabel: `≈${inr(qty * asp)} sales enabled`, confidence: f.l7q >= 5 ? "high" : "medium", category: p?.category ?? null,
      product: prodRef(p, f.sku), store: { code: f.b!, name: st?.short_name ?? f.store },
      evidence: [{ label: "L7 sales", value: num(f.l7q) }, { label: "Store stock", value: num(stock) }, { label: "Warehouse", value: num(avail) }, { label: "Suggested qty", value: num(qty) }],
      links: [{ label: "View product", href: `/products/${encodeURIComponent(f.sku)}` }, { label: "View store", href: `/stores/${f.b}` }],
    });
  }
  // missed distribution: category top sellers absent from strong feed stores, warehouse available
  for (const ck of ctx.filters.cats) {
    const top = [...vel.entries()].filter(([s]) => pm.get(s)?.category === ck).sort((x, y) => y[1].bySource.stores - x[1].bySource.stores).slice(0, 5).map(([s]) => s);
    const strongStores = [...perDayBy.entries()].filter(([k, x]) => k.endsWith(`|${ck}`) && feed.has(k.split("|")[0]) && x >= (catMedian.get(ck) ?? Infinity)).map(([k]) => k.split("|")[0]);
    for (const sku of top) {
      const missing = strongStores.filter((b) => (stockAt.get(`${b}|${sku}`) ?? 0) === 0);
      if (missing.length < 2 || whUnits(sku) < RULES.distMinWarehouse) continue;
      const p = pm.get(sku); const e = vel.get(sku)!;
      const perStore = e.storeCount ? e.bySource.stores / e.storeCount : 0;
      actions.push({
        key: `miss:${ck}:${sku}`, group: "merchandising", type: "missed_distribution", typeLabel: "Missed distribution",
        priority: missing.length >= 4 && perStore * missing.length >= 100_000 ? "urgent" : "high",
        title: `${p?.name ?? sku}: not stocked in ${missing.length} strong ${catLabel(ck).toLowerCase()} stores`, reason: `A top-5 ${catLabel(ck).toLowerCase()} seller, absent from above-median stores in the inventory feed.`,
        recommendation: `Allocate to ${missing.map((b) => ctx.byCode.get(b)?.short_name ?? b).slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""} from ${num(whUnits(sku))} warehouse units.`,
        impact: perStore * missing.length, impactLabel: `≈${inr(perStore * missing.length)}/month potential`, confidence: "medium", category: ck, product: prodRef(p, sku),
        evidence: [{ label: "Stores missing it", value: num(missing.length) }, { label: "Sales / store (L30)", value: inr(perStore) }, { label: "Warehouse", value: num(whUnits(sku)) }],
        links: [{ label: "View product", href: `/products/${encodeURIComponent(sku)}` }],
      });
    }
  }

  const order: Record<Priority, number> = { urgent: 0, high: 1, medium: 2 };
  actions.sort((x, y) => order[x.priority] - order[y.priority] || y.impact - x.impact);
  return { actions, coverage: { feedStores: cov.length, asOf: a, inventoryAsOf: wh.updated } };
}

export const GROUP_LABEL: Record<ActionGroup, string> = { channel: "Channel", store: "Stores", sku: "SKU", merchandising: "Merchandising" };

/** Status the team set on actions (open / done / dismissed). */
export async function actionStatuses(): Promise<Map<string, string>> {
  const { dbConfigured, q } = await import("./db");
  if (!dbConfigured()) return new Map();
  return cached("actstatus", 30, async () => {
    const rows = await q<{ key: string; status: string }>("select key, status from action_status").catch(() => []);
    return new Map(rows.map((r) => [r.key, r.status]));
  });
}
