import "server-only";
import { addDays, eachDay, fmtDate, resolvePeriod, startOfMonth, type Range } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { cached } from "@/lib/cache";
import { catLabel } from "./views";
import { loadFacts, type Ctx } from "./context";
import { groupFacts, summarize, monthOutlook } from "./analytics";
import { getSkuFacts } from "./data/sku";
import { getChannelSku, getChannelDaily } from "./data/channels";
import { getProductMap, type Product } from "./data/products";
import { getWarehouseStock } from "./data/warehouse";
import { getStoreInventory, getStoreInventoryCoverage, catKey } from "./data/inventory";
import { getRecentInwards } from "./data/metafields";
import { getGoodsInTransit, type GitData } from "./data/git";
import { PRODUCT_TAGS, type ProductTag } from "@/lib/productTags";
import { getTargetBook } from "./data/targetBook";
import { effectiveRemarks, remarksSig, type Remark, type RemarkKind, type RemarkScope } from "./data/remarks";
import { computePlan } from "./plan";
import { CH_LABEL, ucChannel, type ChKey } from "./channelData";

/**
 * Action engine. Every action is a measurable opportunity or risk someone can act on — never "no sales = bad".
 * Rules combine velocity, inventory (store report + warehouse), distribution, channel, peers and target context,
 * and respect the team's remarks (context notes, not-applicable, snoozes, anomaly days).
 *
 * Live rule (store actions): a category is LIVE in a store only if the store has stock > 0 on the latest store report
 * OR sold it in the last 60 days — and no "not applicable" remark says otherwise. Store actions (recovery, category gap,
 * idle stock, allocation) only target live pairs; not-live pairs get expansion / distribution suggestions instead.
 */
export type ActionGroup = "channel" | "store" | "sku" | "merchandising" | "marketing";
export type Priority = "urgent" | "high" | "medium";
export interface TeamNote { id: number; text: string; by: string; at: string; kind: RemarkKind; scope: RemarkScope; day: string | null; until: string | null }
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
  /** data window the action is based on (null = lifetime / snapshot) */
  period?: { from: string; to: string } | null;
  /** team remarks that apply (context notes, and anomaly days inside the window) */
  notes?: TeamNote[];
  /** the remark that hides this action (not applicable / snooze) — only set on `suppressed` actions */
  hiddenBy?: TeamNote;
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
  gitStuckDays: 10, gitStuckMinUnits: 5,
  idleSellThroughRatio: 0.3, idleMinUnits: 15,
  catGapRatio: 0.4,
  liveDays: 60, expansionMinLiveShare: 0.2, expansionPerCategory: 6, expansionMinWarehouse: 30,
  // marketing boosts: stock is there, demand needs a push (never a discount prescription)
  boostInwardDays: 30, boostInwardMinQty: 50, boostInwardMinCover: 45, boostOnlineMinL30: 5, boostOnlineCoverDays: 60, boostOnlineMinWh: 50, boostSlowRatio: 0.75, boostSlowMinPrev: 30,
};

const inr = (v: number) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : Math.abs(v) >= 1e3 ? `₹${(v / 1e3).toFixed(1)}K` : `₹${Math.round(v)}`);
const pc = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const sp = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const num = (v: number) => Math.round(v).toLocaleString("en-IN");
const prodRef = (p: Product | undefined, sku: string) => ({ sku, name: p?.name ?? sku, image: p?.image ?? null });
const median = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export interface ActionsResult {
  actions: Action[];
  /** actions hidden by a not-applicable / snooze remark */
  suppressed: Action[];
  coverage: { feedStores: number; asOf: string; inventoryAsOf: string | null; storeReportDate: string | null; anomalyDays: { day: string; text: string; category: string | null }[] };
}

export async function buildActions(ctx: Ctx): Promise<ActionsResult> {
  const remarks = await effectiveRemarks(ctx.today).catch(() => [] as Remark[]);
  const key = `actions:v13:${ctx.asOf}:${ctx.filters.cats.join(",")}:${remarksSig(remarks)}`;
  return cached(key, 600, () => compute(ctx, remarks));
}

const note = (r: Remark): TeamNote => ({ id: r.id, text: r.tag && r.tag in PRODUCT_TAGS ? `${PRODUCT_TAGS[r.tag as ProductTag].label}${r.text && r.text !== PRODUCT_TAGS[r.tag as ProductTag].label ? ` — ${r.text}` : ""}` : r.text, by: r.created_by, at: r.created_at, kind: r.kind, scope: r.scope, day: r.day, until: r.until });
/** action key without its trailing date/month, so snoozes and notes carry over to the same action on later days */
const baseKey = (k: string) => k.replace(/:\d{4}-\d{2}(-\d{2})?$/, "");

async function compute(ctx: Ctx, remarks: Remark[]): Promise<ActionsResult> {
  const a = ctx.asOf;
  const cats = new Set(ctx.filters.cats);
  const l30 = resolvePeriod("l30", a, ctx.today);
  const l7: Range = { from: addDays(a, -6), to: a }, p7: Range = { from: addDays(a, -13), to: addDays(a, -7) };
  const p30: Range = { from: addDays(a, -59), to: addDays(a, -30) };
  const live60: Range = { from: addDays(a, -(RULES.liveDays - 1)), to: a };
  const month = startOfMonth(a);
  const [pm, storeSkuRaw, ucSku, ucDaily, facts, cov, book] = await Promise.all([
    getProductMap(),
    getSkuFacts({ range: l30.range, compare: p30, asOf: a, cats: ctx.filters.cats, ch: "store" }),
    getChannelSku({ range: l30.range, compare: p30, asOf: a }),
    getChannelDaily({ from: p30.from, to: a }),
    loadFacts({ ...ctx, filters: { ...ctx.filters, stores: [] } }, [live60]),
    getStoreInventoryCoverage(),
    getTargetBook(month).catch(() => null),
  ]);
  const inwards = await getRecentInwards(RULES.boostInwardDays).catch(() => [] as Awaited<ReturnType<typeof getRecentInwards>>);
  // store × SKU sales keyed to branch codes (CHANNEL = store name)
  const storeSku = storeSkuRaw.map((f) => { const st = ctx.byName.get(f.ch.toUpperCase()); return { ...f, b: st?.branch_code ?? null, store: st?.short_name ?? f.ch.replace(/^SNITCH\s*-\s*/i, "") }; });
  const known = new Set(pm.keys());
  const [wh, storeInv, git] = await Promise.all([getWarehouseStock(known), getStoreInventory([...known]),
    getGoodsInTransit(known).catch((e): GitData => { console.error("[actions] goods in transit unavailable", e); return { lines: [], bySku: new Map(), byStoreSku: new Map(), byStore: new Map(), updated: null }; })]);
  /** goods already on their way to stores (allocated, not yet in store stock) */
  const gitUnits = (sku: string) => git.bySku.get(sku)?.units ?? 0;
  const gitAt = (b: string, sku: string) => git.byStoreSku.get(`${b}|${sku}`)?.units ?? 0;
  const inCat = (sku: string) => { const c = pm.get(sku)?.category; return !!c && cats.has(c); };
  const actions: Action[] = [];
  const whUnits = (sku: string) => wh.bySku.get(sku)?.units ?? 0;
  const feed = new Set(cov.map((c) => String(c.b)));
  const reportDate = cov[0]?.saved_date ?? null;
  const storeName = (b: string) => ctx.byCode.get(b)?.short_name ?? b;

  /* ---------------- team remarks that change the computation */
  const dateRemarks = remarks.filter((r) => r.scope === "date" && r.kind === "context" && r.day);
  /** anomaly days for a category (null = channel totals across the selection) */
  const anomalyFor = (c: string | null) => new Set(dateRemarks.filter((r) => !r.category || r.category === c || (c == null && cats.size === 1 && cats.has(r.category))).map((r) => r.day!));
  const anyAnomaly = new Set(dateRemarks.filter((r) => !r.category || cats.has(r.category)).map((r) => r.day!));
  const anomalyText = (days: string[]) => days.map((d) => `${fmtDate(d)} (${dateRemarks.find((r) => r.day === d)?.text.slice(0, 40) ?? "team note"})`).join(", ");
  const naPair = new Set(remarks.filter((r) => r.kind === "not_applicable" && r.scope === "store_category" && r.scope_id && r.category).map((r) => `${r.scope_id}|${r.category}`));

  /* ---------------- live store × category */
  const stockBC = new Map<string, number>();
  for (const r of storeInv) { const c = pm.get(r.sku)?.category ?? catKey(r.cat); if (!c || !cats.has(c)) continue; stockBC.set(`${r.b}|${c}`, (stockBC.get(`${r.b}|${c}`) ?? 0) + r.units); }
  const sold60 = new Set<string>();
  for (const f of facts) if (f.d >= live60.from && f.d <= a && (f.s > 0 || f.q > 0)) sold60.add(`${f.b}|${f.c}`);
  for (const f of storeSku) if (f.b && f.l30q > 0) { const c = pm.get(f.sku)?.category; if (c) sold60.add(`${f.b}|${c}`); }
  const isLive = (b: string, c: string) => !naPair.has(`${b}|${c}`) && ((stockBC.get(`${b}|${c}`) ?? 0) > 0 || sold60.has(`${b}|${c}`));

  /* ---------------- per-product velocity (all channels) & inventory */
  interface V { l7: number; p7: number; l30: number; p30: number; rev30: number; storeCount: number; bySource: Record<ChKey, number> }
  const vel = new Map<string, V>();
  const v = (sku: string) => { let e = vel.get(sku); if (!e) vel.set(sku, (e = { l7: 0, p7: 0, l30: 0, p30: 0, rev30: 0, storeCount: 0, bySource: { stores: 0, online: 0, marketplace: 0 } })); return e; };
  for (const f of storeSku) { if (!inCat(f.sku)) continue; const e = v(f.sku); e.l7 += f.l7q; e.p7 += f.p7q; e.l30 += f.l30q; e.p30 += f.pq; e.rev30 += f.l30s; e.bySource.stores += f.l30s; if (f.l30q > 0) e.storeCount++; }
  for (const f of ucSku) { if (!inCat(f.sku) || !ucChannel(f.mp)) continue; const e = v(f.sku); e.l7 += f.l7q; e.p7 += f.p7q; e.l30 += f.l30q; e.p30 += f.pq; e.rev30 += f.l30s; e.bySource[ucChannel(f.mp)!] += f.l30s; }
  /** free gift: sold under ₹10 per unit, or units with no paid revenue (e.g. socks given free) */
  const isGift = (sku: string) => { const e = vel.get(sku); return !!e && e.l30 > 0 && (e.rev30 <= 0 || e.rev30 / e.l30 < 10); };
  const activeStores = ctx.stores.filter((s) => s.last_seen && s.last_seen >= addDays(a, -30)).length || 1;

  /* ---------------- CHANNEL */
  const chRev = (k: ChKey | string, r: Range, isMp = false) => {
    if (k === "stores") return summarize(facts, r).sales;
    return ucDaily.filter((x) => cats.has(x.c) && x.d >= r.from && x.d <= r.to && (isMp ? x.mp === k : ucChannel(x.mp) === k)).reduce((s2, x) => s2 + x.revenue, 0);
  };
  /** revenue over a window with anomaly days removed and the rest scaled back to the full window (per-day normalised) */
  const chRevAdj = (k: ChKey | string, r: Range, isMp: boolean, excl: Set<string>) => {
    const days = eachDay(r.from, r.to), kept = days.filter((d) => !excl.has(d));
    if (kept.length === days.length || !kept.length) return chRev(k, r, isMp);
    return (kept.reduce((s2, d) => s2 + chRev(k, { from: d, to: d }, isMp), 0) * days.length) / kept.length;
  };
  const channels: { k: string; label: string; isMp: boolean }[] = [
    ...(["stores", "online", "marketplace"] as ChKey[]).map((k) => ({ k, label: CH_LABEL[k], isMp: false })),
    ...Array.from(new Set(ucDaily.filter((x) => ucChannel(x.mp) === "marketplace").map((x) => x.mp))).map((mp) => ({ k: mp, label: mp, isMp: true })),
  ];
  const chExcl = anomalyFor(null);
  const wowExcluded = eachDay(p7.from, a).filter((d) => chExcl.has(d));
  for (const c of channels) {
    const cur = chRevAdj(c.k, l7, c.isMp, chExcl), prev = chRevAdj(c.k, p7, c.isMp, chExcl), g = growth(cur, prev);
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
      reason: [`Last 7 days vs the 7 days before (complete days to ${fmtDate(a)}).`,
        wowExcluded.length ? `Team-marked anomaly day${wowExcluded.length > 1 ? "s" : ""} ${anomalyText(wowExcluded)} excluded (per-day normalised).` : "",
        mpShares[0] ? `${mpShares[0].mp} represents ${pc(-mpShares[0].d / drop)} of the decline.` : "",
        topShare != null && topShare > 0 ? `${topSku.filter(([, d]) => d < 0).length} products account for ${pc(topShare)} of it.` : ""].filter(Boolean).join(" "),
      recommendation: `Review availability, listing and pricing for ${topSku.length ? topSku.map(([s]) => pm.get(s)?.name ?? s).join(", ") : "the top products"}${c.k === "stores" ? " in the largest declining stores" : mpShares[0] ? ` on ${mpShares[0].mp}` : " on the channel"}.`,
      impact: drop, impactLabel: `${inr(drop)} lower in 7 days`, confidence: prev > 100_000 ? "high" : "medium", category: ctx.filters.cats.length === 1 ? ctx.filters.cats[0] : null,
      period: { from: p7.from, to: a },
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
        impact: 0, impactLabel: `${Math.round(Math.abs(moves[0].d) * 100)} pp shift`, confidence: "medium", category: ck, period: { from: p30.from, to: a },
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
          impact: excess, impactLabel: `${inr(excess)} returns above benchmark (lifetime)`, confidence: sales > 500_000 ? "high" : "medium", category: ck, product: prodRef(p, p.sku), period: null,
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
    if (isGift(sku)) continue; // free gifts (< ₹10 / unit or no paid units) are never flagged
    const stock = (p?.invOffline ?? 0) + gitUnits(sku) + whUnits(sku);
    const perDay = e.l30 / 30; // DOI = (store + in transit + warehouse units) ÷ (L30 units ÷ 30)
    const asp = safeDiv(e.rev30, e.l30) ?? p?.mrp ?? 0;
    const doi = perDay > 0 ? stock / perDay : Infinity;
    const base = { category: p?.category ?? null, product: prodRef(p, sku), links: [{ label: "View product", href: `/products/${encodeURIComponent(sku)}` }] };
    const zone = wh.bySku.get(sku)?.byZone;
    const zoneEv = [...(gitUnits(sku) > 0 ? [{ label: "In transit to stores", value: num(gitUnits(sku)) }] : []), ...(zone && (zone.North || zone.South) ? [{ label: "WH North / South", value: `${num(zone.North)} / ${num(zone.South)}` }] : [])];
    if (perDay >= RULES.fastMinPerDay && doi < RULES.fastDoiDays) {
      const short = Math.max(0, (RULES.fastDoiDays - doi) * perDay * asp);
      actions.push({
        ...base, key: `fast:${sku}`, group: "sku", type: "fast_low_doi", typeLabel: "Fast mover, low cover", priority: doi < RULES.urgentDoiDays ? "urgent" : "high",
        title: `${p?.name ?? sku}: ${doi.toFixed(0)} days of inventory left`, reason: `Selling ${perDay.toFixed(1)}/day (L30 average, all channels; ${(e.l7 / 7).toFixed(1)}/day in the last 7) against ${num(stock)} units in stores, in transit and the warehouse.`,
        recommendation: whUnits(sku) > 0 ? "Plan replenishment now and push warehouse stock to the fastest stores." : "Raise a reorder — warehouse is empty.",
        impact: short, impactLabel: `${inr(short)} at risk in ${RULES.fastDoiDays} days`, confidence: e.l30 >= 60 ? "high" : "medium", period: l30.range,
        evidence: [{ label: "L30 units", value: num(e.l30) }, { label: "L7 units", value: num(e.l7) }, { label: "Store inventory", value: num(p?.invOffline ?? 0) }, { label: "Warehouse", value: num(whUnits(sku)) }, ...zoneEv, { label: "Days of inventory", value: doi.toFixed(0) }],
      });
    } else if (stock >= RULES.slowMinUnits && (e.l30 === 0 || stock / (e.l30 / 30) > RULES.slowDoiDays)) {
      const value = stock * (p?.mrp ?? asp) * 0.5;
      actions.push({
        ...base, key: `slow:${sku}`, group: "sku", type: "slow_moving", typeLabel: "Slow moving", priority: value >= 1_000_000 ? "high" : "medium",
        title: `${p?.name ?? sku}: ${num(stock)} units, ${num(e.l30)} sold in 30 days`, reason: `${e.l30 ? `${Math.round(stock / (e.l30 / 30))} days` : "No sales"} of cover at the current rate.`,
        recommendation: "Redistribute to the stores / channels where it sells and review visibility; promotions only where business rules allow.",
        impact: value, impactLabel: `≈${inr(value)} tied up (at 50% of MRP)`, confidence: "high", period: l30.range,
        evidence: [{ label: "Store inventory", value: num(p?.invOffline ?? 0) }, { label: "Warehouse", value: num(whUnits(sku)) }, ...zoneEv, { label: "L30 units", value: num(e.l30) }],
      });
    }
    // distribution: strong per selling store, low penetration, warehouse stock available
    if (e.storeCount > 0 && e.bySource.stores / e.storeCount >= q && e.storeCount / activeStores < RULES.distMaxPenetration && whUnits(sku) >= RULES.distMinWarehouse) {
      const opp = (activeStores * RULES.distMaxPenetration - e.storeCount) * (e.bySource.stores / e.storeCount) * 0.5;
      actions.push({
        ...base, key: `dist:${sku}`, group: "sku", type: "distribution", typeLabel: "Distribution opportunity", priority: opp >= 300_000 ? "high" : "medium",
        title: `${p?.name ?? sku}: strong where listed, in only ${e.storeCount} stores`, reason: `L30 sales per selling store (${inr(e.bySource.stores / e.storeCount)}) are in the top quartile; penetration ${pc(e.storeCount / activeStores)}.`,
        recommendation: `Extend to more stores from the ${num(whUnits(sku))} warehouse units${zone ? ` (North ${num(zone.North)} · South ${num(zone.South)})` : ""}.`,
        impact: opp, impactLabel: `≈${inr(opp)}/month if extended (conservative)`, confidence: "medium", period: l30.range,
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
        impact: lost, impactLabel: `${inr(lost)} less in 30 days`, confidence: e.p30 >= 100 ? "high" : "medium", period: { from: p30.from, to: a },
        evidence: [{ label: "L30 units", value: num(e.l30) }, { label: "Prior 30", value: num(e.p30) }, { label: "L7 / prior 7", value: `${num(e.l7)} / ${num(e.p7)}` }, { label: "Stock (store + WH)", value: num(stock) }],
      });
    }
  }

  /* ---------------- MARKETING: stock is available, so demand is the lever (one boost per product) */
  const inw = new Map<string, { qty: number; last: string; wh: string[] }>();
  for (const r of inwards) { const s = r.sku.toUpperCase(); const e = inw.get(s) ?? { qty: 0, last: r.last, wh: [] }; e.qty += r.qty; if (r.last > e.last) e.last = r.last; e.wh.push(r.wh); inw.set(s, e); }
  const boostRec = "Boost visibility: homepage / collection placement, paid social and search ads, CRM (email · WhatsApp), marketplace sponsored listings, and store window / VM. Promotions only where business rules allow.";
  for (const sku of new Set([...vel.keys(), ...inw.keys()])) {
    const p = pm.get(sku);
    if (!p?.category || !cats.has(p.category) || isGift(sku)) continue;
    const e = vel.get(sku) ?? { l7: 0, p7: 0, l30: 0, p30: 0, rev30: 0, storeCount: 0, bySource: { stores: 0, online: 0, marketplace: 0 } };
    const wu = whUnits(sku), su = p.invOffline ?? 0, stock = wu + su + gitUnits(sku);
    const asp = safeDiv(e.rev30, e.l30) ?? p.sellingPrice ?? p.mrp ?? 0;
    const zone = wh.bySku.get(sku)?.byZone;
    const base = { group: "marketing" as const, category: p.category, product: prodRef(p, sku), period: l30.range,
      links: [{ label: "View product", href: `/products/${encodeURIComponent(sku)}` }] };
    const stockEv = [{ label: "Warehouse", value: `${num(wu)}${zone ? ` (S ${num(zone.South)} · N ${num(zone.North)})` : ""}` }, { label: "Store stock", value: num(su) }, ...(gitUnits(sku) ? [{ label: "In transit", value: num(gitUnits(sku)) }] : [])];
    const ni = inw.get(sku);
    const ni7 = e.l7 / 7, niCover = ni7 > 0 ? stock / ni7 : null;
    // a new inward that is already selling through quickly needs no push
    if (ni && ni.qty >= RULES.boostInwardMinQty && wu >= RULES.distMinWarehouse && (niCover == null || niCover >= RULES.boostInwardMinCover)) {
      const perDay = ni7, cover = niCover;
      const value = Math.min(ni.qty, wu) * asp * 0.25;
      actions.push({ ...base, key: `mkt-new:${sku}:${ni.last}`, type: "boost_new_inward", typeLabel: "New inward — launch push", priority: ni.qty >= 300 ? "high" : "medium",
        title: `${p.name ?? sku}: ${num(ni.qty)} new units landed ${fmtDate(ni.last)}`, reason: `New inward in the last ${RULES.boostInwardDays} days; selling ${perDay.toFixed(1)}/day in the last 7 days${cover != null ? ` — ${Math.round(cover)} days of cover at that pace` : " — no sales yet"}.`,
        recommendation: `Feature it as a new arrival. ${boostRec}`, impact: value, impactLabel: `≈${inr(value)} if a quarter of the inward sells through faster (estimate)`, confidence: "medium",
        evidence: [{ label: "Inward qty", value: num(ni.qty) }, { label: "Last inward", value: fmtDate(ni.last) }, ...stockEv, { label: "L7 units", value: num(e.l7) }] });
      continue;
    }
    if (e.p30 >= RULES.boostSlowMinPrev && e.l30 <= e.p30 * RULES.boostSlowRatio && stock >= e.p30) {
      const lost = (e.p30 - e.l30) * asp;
      actions.push({ ...base, key: `mkt-slow:${sku}`, type: "boost_paced_down", typeLabel: "Paced down, stock available", priority: lost >= 200_000 ? "high" : "medium",
        title: `${p.name ?? sku}: ${num(e.l30)} sold in 30 days vs ${num(e.p30)} before, ${num(stock)} in stock`, reason: `Was selling ${(e.p30 / 30).toFixed(1)}/day, now ${(e.l30 / 30).toFixed(1)}/day (${sp(growth(e.l30, e.p30))}), with enough stock for ${Math.round(stock / Math.max(e.p30 / 30, 0.1))} days at the earlier pace — availability is not the constraint.`,
        recommendation: `Re-boost a proven seller. ${boostRec}`, impact: lost, impactLabel: `${inr(lost)} / 30 days back if it returns to the earlier pace`, confidence: e.p30 >= 100 ? "high" : "medium",
        evidence: [{ label: "L30 units", value: num(e.l30) }, { label: "Prior 30", value: num(e.p30) }, { label: "L7 / prior 7", value: `${num(e.l7)} / ${num(e.p7)}` }, ...stockEv] });
      continue;
    }
    const onlineRev = e.bySource.online + e.bySource.marketplace;
    const onlineUnits = asp > 0 ? onlineRev / asp : 0;
    const whCover = onlineUnits > 0 ? wu / (onlineUnits / 30) : null;
    if (onlineUnits >= RULES.boostOnlineMinL30 && wu >= RULES.boostOnlineMinWh && whCover != null && whCover >= RULES.boostOnlineCoverDays) {
      const value = onlineRev * 0.3;
      actions.push({ ...base, key: `mkt-online:${sku}`, type: "boost_online_stock", typeLabel: "Online inventory to push", priority: value >= 150_000 ? "high" : "medium",
        title: `${p.name ?? sku}: ${num(wu)} units in the warehouse, ${Math.round(whCover)} days of online cover`, reason: `Sells online (${inr(onlineRev)} in L30 across Online + Marketplace) and the warehouse holds far more than online demand needs.`,
        recommendation: `Scale online demand. ${boostRec}`, impact: value, impactLabel: `≈${inr(value)} / month at +30% online sales (estimate)`, confidence: "medium",
        evidence: [{ label: "Online L30", value: inr(e.bySource.online) }, { label: "Marketplace L30", value: inr(e.bySource.marketplace) }, ...stockEv, { label: "Online cover", value: `${Math.round(whCover)} days` }] });
    }
  }

  /* ---------------- STORE */
  const mtdR: Range = { from: month, to: a };
  const mtdDays = eachDay(mtdR.from, mtdR.to);
  // MTD sales/day per store × category, anomaly days removed (live pairs only)
  const perDayBy = new Map<string, number>();
  for (const [k, fs] of groupFacts(facts, (f) => `${f.b}|${f.c}`)) {
    const [b, c] = k.split("|");
    if (!isLive(b, c)) continue;
    const excl = anomalyFor(c);
    const kept = mtdDays.filter((d) => !excl.has(d));
    let sales = 0, active = false;
    for (const f of fs) if (f.d >= mtdR.from && f.d <= mtdR.to) { if (f.s !== 0 || (f.t ?? 0) > 0) active = true; if (!excl.has(f.d)) sales += f.s; }
    if (active && kept.length) perDayBy.set(k, sales / kept.length);
  }
  const catMedian = new Map(ctx.filters.cats.map((ck) => [ck, median([...perDayBy.entries()].filter(([k]) => k.endsWith(`|${ck}`)).map(([, x]) => x))]));
  const mtdTargetBy = new Map<string, number>();
  for (const f of facts) if (f.d >= month && f.d <= a && f.t) mtdTargetBy.set(`${f.b}|${f.c}`, (mtdTargetBy.get(`${f.b}|${f.c}`) ?? 0) + f.t);
  const factsByStore = groupFacts(facts, (f) => f.b);
  for (const [b, fsAll] of factsByStore) {
    const st = ctx.byCode.get(b);
    if (!st) continue;
    const name = st.short_name;
    const liveCats = ctx.filters.cats.filter((ck) => isLive(b, ck));
    const fs = fsAll.filter((f) => liveCats.includes(f.c));
    if (!liveCats.length) continue;
    const mo = monthOutlook(fs, a);
    const m = summarize(fs, mtdR);
    // target recovery: behind, but has shown the needed daily rate recently (best clean 7-day window in the last 60 days)
    if (m.target && m.ach != null && m.ach < ctx.settings.thresholds.atRisk && mo.requiredRunRate && mo.remainingDays > 0) {
      let best = 0;
      for (let i = 0; i < 54; i++) {
        const r = { from: addDays(a, -i - 6), to: addDays(a, -i) };
        if (eachDay(r.from, r.to).some((d) => anyAnomaly.has(d))) continue; // festival / birthday spikes don't prove capability
        best = Math.max(best, summarize(fs, r).sales / 7);
      }
      if (best >= mo.requiredRunRate) {
        const gap = Math.max((mo.monthTarget ?? 0) - mo.mtdSales, 0);
        const notLive = ctx.filters.cats.filter((ck) => !isLive(b, ck) && (mtdTargetBy.get(`${b}|${ck}`) ?? 0) > 0);
        actions.push({
          key: `rec:${b}:${a.slice(0, 7)}`, group: "store", type: "target_recovery", typeLabel: "Target recovery", priority: gap >= 150_000 ? "high" : "medium",
          title: `${name}: ${pc(m.ach)} of MTD target, but capable of the required rate`,
          reason: `Needs ${inr(mo.requiredRunRate)}/day for ${mo.remainingDays} days across live categories (${liveCats.map(catLabel).join(", ")}); its best 7-day run in the last 60 days was ${inr(best)}/day${anyAnomaly.size ? " (team-marked anomaly days excluded)" : ""}.`,
          recommendation: `Recoverable with focus: brief the store on the daily number and push the top sellers in ${liveCats.map(catLabel).join(", ")}.${notLive.length ? ` ${notLive.map(catLabel).join(", ")} ha${notLive.length > 1 ? "ve" : "s"} a target here but is not live — see the expansion action.` : ""}`,
          impact: gap, impactLabel: `${inr(gap)} to month target`, confidence: "medium", category: liveCats.length === 1 ? liveCats[0] : null, store: { code: b, name }, period: live60,
          evidence: [{ label: "MTD sales", value: inr(mo.mtdSales) }, { label: "Month target", value: inr(mo.monthTarget ?? 0) }, { label: "Needed / day", value: inr(mo.requiredRunRate) }, { label: "Best 7-day rate", value: inr(best) }],
          links: [{ label: "View store", href: `/stores/${b}` }],
        });
      }
    }
    // category gap: strong in one live category, far below peers in another live category
    if (liveCats.length > 1) {
      const strong = liveCats.filter((ck) => (perDayBy.get(`${b}|${ck}`) ?? 0) >= (catMedian.get(ck) ?? Infinity));
      for (const ck of liveCats) {
        const mine = perDayBy.get(`${b}|${ck}`) ?? 0, med = catMedian.get(ck) ?? 0;
        const hasTarget = (mtdTargetBy.get(`${b}|${ck}`) ?? 0) > 0;
        if (!strong.length || strong.includes(ck) || !hasTarget || med <= 0 || mine > med * RULES.catGapRatio) continue;
        const opp = (med - mine) * 30;
        const stock = stockBC.get(`${b}|${ck}`) ?? 0;
        actions.push({
          key: `gap:${b}:${ck}:${a.slice(0, 7)}`, group: "store", type: "category_gap", typeLabel: "Category gap", priority: opp >= 100_000 ? "high" : "medium",
          title: `${name}: strong in ${strong.map(catLabel).join(", ")}, weak in ${catLabel(ck)}`,
          reason: `${catLabel(ck)} is live here (${stock > 0 ? `${num(stock)} unit${stock === 1 ? "" : "s"} in store` : "sold in the last 60 days"}) but MTD sales are ${inr(mine)}/day vs ${inr(med)}/day for the median live store.`,
          recommendation: stock >= 10 ? `Stock is there — check ${catLabel(ck)} display, range depth and staff focus at this store.` : `Only ${num(stock)} ${catLabel(ck).toLowerCase()} unit${stock === 1 ? "" : "s"} on the latest store report — replenish the top sellers first, then push sales.`,
          impact: opp, impactLabel: `≈${inr(opp)}/month to reach the median`, confidence: "medium", category: ck, store: { code: b, name }, period: mtdR,
          evidence: [{ label: `${catLabel(ck)} / day`, value: inr(mine) }, { label: "Median live store", value: inr(med) }, { label: "Store stock", value: num(stock) }, ...strong.map((s2) => ({ label: `${catLabel(s2)} / day`, value: inr(perDayBy.get(`${b}|${s2}`) ?? 0) }))],
          links: [{ label: "View store", href: `/stores/${b}` }],
        });
      }
    }
  }

  // not live: category has a target but no stock / sales → fix distribution or the target; strong stores → expansion candidates
  const l30Days = eachDay(l30.range.from, l30.range.to);
  const storeStrength = new Map<string, number>(); // long-tail sales/day over L30 (live categories)
  for (const [b, fs] of factsByStore) {
    let s = 0; for (const f of fs) if (f.d >= l30.range.from && f.d <= a) s += f.s;
    storeStrength.set(b, s / l30Days.length);
  }
  const candidates = ctx.stores.filter((s) => s.last_seen && s.last_seen >= addDays(a, -30) && feed.has(s.branch_code));
  const strengthMedian = median(candidates.map((s) => storeStrength.get(s.branch_code) ?? 0));
  for (const ck of ctx.filters.cats) {
    const liveShare = safeDiv(candidates.filter((s) => isLive(s.branch_code, ck)).length, candidates.length) ?? 0;
    const catWh = [...pm.values()].filter((p) => p.category === ck).reduce((x, p) => x + whUnits(p.sku), 0);
    const tops = [...vel.entries()].filter(([s]) => pm.get(s)?.category === ck && whUnits(s) > 0 && !isGift(s)).sort((x, y) => y[1].bySource.stores - x[1].bySource.stores).slice(0, 3).map(([s]) => pm.get(s)?.name ?? s);
    const med = catMedian.get(ck) ?? 0;
    const potential = med * 30 * 0.5;
    const notLive = candidates.filter((s) => !isLive(s.branch_code, ck) && !naPair.has(`${s.branch_code}|${ck}`));
    // (a) target set but category not live — always surface
    for (const s of notLive.filter((x) => (mtdTargetBy.get(`${x.branch_code}|${ck}`) ?? 0) > 0)) {
      const t = mtdTargetBy.get(`${s.branch_code}|${ck}`) ?? 0;
      actions.push({
        key: `nolive:${s.branch_code}:${ck}:${a.slice(0, 7)}`, group: "store", type: "target_not_live", typeLabel: "Target, category not live", priority: t >= 50_000 ? "high" : "medium",
        title: `${s.short_name}: ${catLabel(ck)} has a target but is not live`,
        reason: `No ${catLabel(ck).toLowerCase()} stock on the ${reportDate ? fmtDate(reportDate) : "latest"} store report and no sale in ${RULES.liveDays} days, yet the store carries ${inr(t)} of MTD target.`,
        recommendation: catWh > 0 ? `Either send an opening range (${tops.join(", ") || "top sellers"}) from the ${num(catWh)} warehouse units, or remove the store's ${catLabel(ck)} target in Control Centre. If the store isn't meant to carry it, add a "Not applicable" remark.` : `Warehouse has no ${catLabel(ck).toLowerCase()} stock — remove or realign the store's target in Control Centre.`,
        impact: t, impactLabel: `${inr(t)} MTD target with nothing to sell`, confidence: "high", category: ck, store: { code: s.branch_code, name: s.short_name }, period: live60,
        evidence: [{ label: "MTD target", value: inr(t) }, { label: "Store stock", value: "0" }, { label: `Sales (${RULES.liveDays}d)`, value: "₹0" }, { label: "Warehouse", value: num(catWh) }],
        links: [{ label: "View store", href: `/stores/${s.branch_code}` }, { label: "Store targets", href: `/settings?tab=stores&tc=${ck}` }],
      });
    }
    // (b) strong stores where a widely distributed category isn't live → expansion candidates
    if (liveShare < RULES.expansionMinLiveShare || catWh < RULES.expansionMinWarehouse || med <= 0) continue;
    const strongNotLive = notLive
      .filter((s) => !(mtdTargetBy.get(`${s.branch_code}|${ck}`) ?? 0) && (storeStrength.get(s.branch_code) ?? 0) >= strengthMedian && (storeStrength.get(s.branch_code) ?? 0) > 0)
      .sort((x, y) => (storeStrength.get(y.branch_code) ?? 0) - (storeStrength.get(x.branch_code) ?? 0))
      .slice(0, RULES.expansionPerCategory);
    for (const s of strongNotLive) {
      const strength = storeStrength.get(s.branch_code) ?? 0;
      actions.push({
        key: `expand:${s.branch_code}:${ck}`, group: "store", type: "category_expansion", typeLabel: "Expansion candidate", priority: potential >= 60_000 ? "high" : "medium",
        title: `${s.short_name}: strong long-tail store, ${catLabel(ck)} not live`,
        reason: `Does ${inr(strength)}/day in other long-tail categories (median store ${inr(strengthMedian)}/day) but has no ${catLabel(ck).toLowerCase()} stock on the store report and no sale in ${RULES.liveDays} days. ${catLabel(ck)} is live in ${pc(liveShare)} of stores.`,
        recommendation: `Evaluate launching ${catLabel(ck)} here with a small opening range${tops.length ? ` (${tops.join(", ")})` : ""} from ${num(catWh)} warehouse units. This is a distribution decision, not a sales push.`,
        impact: potential, impactLabel: `≈${inr(potential)}/month at half the median live store`, confidence: "low", category: ck, store: { code: s.branch_code, name: s.short_name }, period: live60,
        evidence: [{ label: "Long-tail / day (L30)", value: inr(strength) }, { label: `${catLabel(ck)} median live store`, value: `${inr(med)}/day` }, { label: "Live in", value: pc(liveShare) }, { label: "Warehouse", value: num(catWh) }],
        links: [{ label: "View store", href: `/stores/${s.branch_code}` }],
      });
    }
  }

  // target mismatch: Σ store targets don't add up to the Control Centre plan (the plan is always the Stores target)
  if (book) {
    const plan = computePlan(facts, ucDaily, a, "stores", book, ctx.filters.cats, ctx.settings.thresholds);
    for (const mm of plan.mismatches) {
      const diff = Math.abs(mm.storeSum - mm.catTarget);
      const over = mm.storeSum > mm.catTarget;
      actions.push({
        key: `tmis:${mm.c}:${a.slice(0, 7)}`, group: "store", type: "target_mismatch", typeLabel: "Target mismatch", priority: diff >= 500_000 ? "high" : "medium",
        title: `${catLabel(mm.c)}: store targets (${inr(mm.storeSum)}) don't add up to the plan (${inr(mm.catTarget)})`,
        reason: `For ${fmtDate(month, true).replace(/^1 /, "")}, store-level targets are ${pc(safeDiv(diff, mm.catTarget))} ${over ? "above" : "below"} the Control Centre plan. Reports use the plan; store-level rankings use store targets.`,
        recommendation: "Re-allocate store targets so they add up to the plan (Control Centre → Store targets).",
        impact: diff, impactLabel: `${inr(diff)} ${over ? "over" : "under"}-allocated to stores`, confidence: "high", category: mm.c, period: { from: month, to: a },
        evidence: [{ label: "Plan (Control Centre)", value: inr(mm.catTarget) }, { label: "Σ store targets", value: inr(mm.storeSum) }, { label: "Difference", value: `${over ? "+" : "−"}${inr(diff)}` }],
        links: [{ label: "Store targets", href: `/settings?tab=stores&tc=${mm.c}` }, { label: "Month plan", href: "/settings?tab=targets" }],
      });
    }
  }

  // inventory but low sales (store report): store's sell-through far below peers for the same category
  const soldBy = new Map<string, number>();
  for (const f of storeSku) { if (!f.b || !feed.has(f.b) || !inCat(f.sku)) continue; const c = pm.get(f.sku)!.category!; soldBy.set(`${f.b}|${c}`, (soldBy.get(`${f.b}|${c}`) ?? 0) + f.l30q); }
  const catAsp = new Map(ctx.filters.cats.map((ck) => {
    const fs = storeSku.filter((f) => pm.get(f.sku)?.category === ck);
    return [ck, safeDiv(fs.reduce((x, f) => x + f.l30s, 0), fs.reduce((x, f) => x + f.l30q, 0)) ?? 0];
  }));
  for (const ck of ctx.filters.cats) {
    const rows = [...stockBC.entries()].filter(([k]) => k.endsWith(`|${ck}`) && isLive(k.split("|")[0], ck)).map(([k, stock]) => ({ b: k.split("|")[0], stock, sold: soldBy.get(k) ?? 0 }));
    const med = median(rows.filter((r) => r.stock > 0).map((r) => r.sold / r.stock));
    for (const r of rows) {
      if (r.stock < RULES.idleMinUnits || med <= 0 || r.sold / r.stock >= med * RULES.idleSellThroughRatio) continue;
      actions.push({
        key: `idle:${r.b}:${ck}`, group: "store", type: "inventory_low_sales", typeLabel: "Inventory, low sales", priority: "medium",
        title: `${storeName(r.b)}: ${num(r.stock)} ${catLabel(ck).toLowerCase()} units, ${num(r.sold)} sold in 30 days`,
        reason: `Sell-through ${pc(r.sold / r.stock)} vs ${pc(med)} for other stores carrying ${catLabel(ck).toLowerCase()} (store report ${reportDate ? fmtDate(reportDate) : "latest"}).`,
        recommendation: "Check display and staff focus first; if it still doesn't move, rebalance part of this stock to stores that sell through faster.",
        impact: r.stock * (catAsp.get(ck) ?? 0), impactLabel: `≈${inr(r.stock * (catAsp.get(ck) ?? 0))} of stock idle (at ASP)`, confidence: "medium", category: ck, store: { code: r.b, name: storeName(r.b) }, period: l30.range,
        evidence: [{ label: "Store stock", value: num(r.stock) }, { label: "Sold L30", value: num(r.sold) }, { label: "Peer sell-through", value: pc(med) }],
        links: [{ label: "View store", href: `/stores/${r.b}` }],
      });
    }
  }

  /* ---------------- MERCHANDISING: allocation (stores on the store report) */
  const stockAt = new Map<string, number>();
  for (const r of storeInv) stockAt.set(`${r.b}|${r.sku}`, (stockAt.get(`${r.b}|${r.sku}`) ?? 0) + r.units);
  const whLeft = new Map<string, number>([...wh.bySku.entries()].map(([k, x]) => [k, x.units]));
  const alloc = storeSku.filter((f) => f.b && feed.has(f.b) && inCat(f.sku) && f.l7q >= RULES.allocMinL7).sort((x, y) => y.l7q - x.l7q);
  for (const f of alloc) {
    if (isGift(f.sku) || (f.l30q > 0 && f.l30s / f.l30q < 10)) continue;
    const stock = stockAt.get(`${f.b}|${f.sku}`) ?? 0;
    const inTransit = gitAt(f.b!, f.sku); // double-check: stock already on its way to this store
    const perDay = f.l7q / 7;
    if (stock + inTransit > perDay * 7) continue; // more than a week of cover once transit lands
    const avail = whLeft.get(f.sku) ?? 0;
    if (avail < RULES.allocMinWarehouse) continue;
    const need = Math.ceil(perDay * RULES.allocCoverDays - stock - inTransit);
    if (need <= 0) continue;
    const qty = Math.max(1, Math.min(need, Math.floor(avail * 0.25)));
    whLeft.set(f.sku, avail - qty);
    const p = pm.get(f.sku), st = ctx.byCode.get(f.b!);
    const asp = safeDiv(f.l30s, f.l30q) ?? p?.mrp ?? 0;
    const zone = wh.bySku.get(f.sku)?.byZone;
    const region = st?.region?.toLowerCase() ?? "";
    const fromZone = zone ? (/north|central|east/.test(region) && zone.North > 0 ? "North" : zone.South > 0 ? "South" : "North") : null;
    actions.push({
      key: `alloc:${f.b}:${f.sku}`, group: "merchandising", type: "allocation", typeLabel: "Allocation opportunity",
      priority: stock <= 1 && f.l7q >= 5 ? "urgent" : "high",
      title: `${p?.name ?? f.sku} → ${st?.short_name ?? f.store}`, reason: `Sold ${f.l7q} in 7 days with ${stock} in store${inTransit ? ` and ${inTransit} already in transit` : ""} — ${stock + inTransit === 0 ? "out of stock, nothing on the way" : `${((stock + inTransit) / perDay).toFixed(0)} days of cover${inTransit ? " once the transit lands" : ""}`}; warehouse has ${num(avail)}.`,
      recommendation: `Review allocation of ~${qty} more units (${RULES.allocCoverDays} days of cover at the current rate${inTransit ? `, net of the ${inTransit} in transit` : ""})${fromZone ? `, ideally from the ${fromZone} warehouse` : ""}.`,
      impact: qty * asp, impactLabel: `≈${inr(qty * asp)} sales enabled`, confidence: f.l7q >= 5 ? "high" : "medium", category: p?.category ?? null,
      product: prodRef(p, f.sku), store: { code: f.b!, name: st?.short_name ?? f.store }, period: l7,
      evidence: [{ label: "L7 sales", value: num(f.l7q) }, { label: "Store stock", value: num(stock) }, { label: "In transit to store", value: inTransit ? num(inTransit) : "none" }, { label: "Warehouse", value: num(avail) }, ...(zone ? [{ label: "WH North / South", value: `${num(zone.North)} / ${num(zone.South)}` }] : []), { label: "Suggested qty", value: num(qty) }],
      links: [{ label: "View product", href: `/products/${encodeURIComponent(f.sku)}` }, { label: "View store", href: `/stores/${f.b}` }],
    });
  }
  // missed distribution: category top sellers absent from strong live stores on the store report, warehouse available
  for (const ck of ctx.filters.cats) {
    const top = [...vel.entries()].filter(([s]) => pm.get(s)?.category === ck && !isGift(s)).sort((x, y) => y[1].bySource.stores - x[1].bySource.stores).slice(0, 5).map(([s]) => s);
    const strongStores = [...perDayBy.entries()].filter(([k, x]) => k.endsWith(`|${ck}`) && feed.has(k.split("|")[0]) && x >= (catMedian.get(ck) ?? Infinity)).map(([k]) => k.split("|")[0]);
    for (const sku of top) {
      const absent = strongStores.filter((b) => (stockAt.get(`${b}|${sku}`) ?? 0) === 0);
      const onTheWay = absent.filter((b) => gitAt(b, sku) > 0); // already being sent
      const missing = absent.filter((b) => gitAt(b, sku) === 0);
      if (missing.length < 2 || whUnits(sku) < RULES.distMinWarehouse) continue;
      const p = pm.get(sku); const e = vel.get(sku)!;
      const perStore = e.storeCount ? e.bySource.stores / e.storeCount : 0;
      // don't promise more stores than the warehouse can seed (≈3 units per store)
      const reach = Math.min(missing.length, Math.floor(whUnits(sku) / 3));
      actions.push({
        key: `miss:${ck}:${sku}`, group: "merchandising", type: "missed_distribution", typeLabel: "Missed distribution",
        priority: reach >= 4 && perStore * reach >= 100_000 ? "urgent" : "high",
        title: `${p?.name ?? sku}: not stocked in ${missing.length} strong ${catLabel(ck).toLowerCase()} stores`, reason: `A top-5 ${catLabel(ck).toLowerCase()} seller with no stock on the latest store report and nothing in transit in above-median ${catLabel(ck).toLowerCase()} stores${onTheWay.length ? ` (${onTheWay.length} more stores already have it on the way and are excluded)` : ""}.`,
        recommendation: `Allocate to ${missing.map(storeName).slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""} from ${num(whUnits(sku))} warehouse units${reach < missing.length ? ` (enough for ~${reach} stores at 3 units each)` : ""}.`,
        impact: perStore * reach, impactLabel: `≈${inr(perStore * reach)}/month potential`, confidence: "medium", category: ck, product: prodRef(p, sku), period: l30.range,
        evidence: [{ label: "Stores missing it", value: num(missing.length) }, { label: "Already in transit to", value: `${num(onTheWay.length)} stores` }, { label: "Sales / store (L30)", value: inr(perStore) }, { label: "Warehouse", value: num(whUnits(sku)) }],
        links: [{ label: "View product", href: `/products/${encodeURIComponent(sku)}` }],
      });
    }
  }

  /* ---------------- MERCHANDISING: goods stuck in transit (per store) */
  const stuckBy = new Map<string, { units: number; value: number; skus: Set<string>; maxAge: number; c: Map<string, number> }>();
  for (const l of git.lines) {
    if (l.aging < RULES.gitStuckDays) continue;
    const p = pm.get(l.sku); if (!p?.category || !cats.has(p.category)) continue;
    const e = stuckBy.get(l.b) ?? { units: 0, value: 0, skus: new Set<string>(), maxAge: 0, c: new Map<string, number>() };
    e.units += l.qty; e.value += l.qty * (p.sellingPrice ?? p.mrp ?? 0); e.skus.add(l.sku); e.maxAge = Math.max(e.maxAge, l.aging); e.c.set(p.category, (e.c.get(p.category) ?? 0) + l.qty);
    stuckBy.set(l.b, e);
  }
  for (const [b, e] of stuckBy) {
    if (e.units < RULES.gitStuckMinUnits) continue;
    const mainCat = [...e.c.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    actions.push({
      key: `git-stuck:${b}`, group: "merchandising", type: "git_stuck", typeLabel: "Stuck in transit", priority: e.maxAge >= 21 || e.value >= 200_000 ? "high" : "medium",
      title: `${storeName(b)}: ${num(e.units)} units in transit for ${RULES.gitStuckDays}+ days`, reason: `${num(e.skus.size)} products allocated to this store have not reached its stock; the oldest has been pending ${e.maxAge} days.`,
      recommendation: "Chase dispatch / delivery / store inward with logistics and the store so the stock can sell.", impact: e.value, impactLabel: `≈${inr(e.value)} of stock not sellable yet (selling price)`, confidence: "high",
      category: e.c.size === 1 ? mainCat : null, store: { code: b, name: storeName(b) }, period: null,
      evidence: [{ label: "Units stuck", value: num(e.units) }, { label: "Products", value: num(e.skus.size) }, { label: "Oldest", value: `${e.maxAge} days` }],
      links: [{ label: "Goods in transit", href: `/stores?tab=git&store=${b}` }, { label: "View store", href: `/stores/${b}` }],
    });
  }

  /* ---------------- apply team remarks */
  const { visible, hidden } = applyRemarks(actions, remarks, cats);
  const order: Record<Priority, number> = { urgent: 0, high: 1, medium: 2 };
  const sort = (xs: Action[]) => xs.sort((x, y) => order[x.priority] - order[y.priority] || y.impact - x.impact);
  return {
    actions: sort(visible), suppressed: sort(hidden),
    coverage: { feedStores: cov.length, asOf: a, inventoryAsOf: wh.updated, storeReportDate: reportDate, anomalyDays: dateRemarks.map((r) => ({ day: r.day!, text: r.text, category: r.category })) },
  };
}

/** Action types whose numbers compare short windows, so an anomaly day inside the window matters (others skip date notes). */
const DATE_SENSITIVE = new Set(["channel_decline", "declining", "fast_low_doi", "allocation", "category_gap", "target_recovery"]);

/** Does a remark apply to an action? `strict` = exact match needed for hiding (not just for a note). */
function applies(r: Remark, x: Action, cats: Set<string>): "hide" | "note" | null {
  const hides = r.kind === "not_applicable" || r.kind === "snooze";
  switch (r.scope) {
    case "action":
      if (r.scope_id === x.key) return hides ? "hide" : "note";
      // same action family on another day/month: snoozes and notes carry over, "not applicable" stays exact
      if (r.scope_id && baseKey(r.scope_id) === baseKey(x.key) && r.kind !== "not_applicable") return hides ? "hide" : "note";
      return null;
    case "product": {
      if (x.product?.sku !== r.scope_id) return null;
      // tagged product remarks (e.g. "not to be sent to stores") hide only the action types they contradict
      const tag = r.tag && r.tag in PRODUCT_TAGS ? PRODUCT_TAGS[r.tag as ProductTag] : null;
      if (tag) return (tag.hides as readonly string[]).includes(x.type) ? "hide" : "note";
      return hides ? "hide" : "note";
    }
    case "store": return x.store?.code === r.scope_id ? (hides ? "hide" : "note") : null;
    case "store_category":
      if (x.store?.code !== r.scope_id) return null;
      if (x.category === r.category) return hides ? "hide" : "note";
      return x.category == null ? "note" : null; // store-wide action: show the note, don't hide
    case "category": { const c = r.category ?? r.scope_id; return x.category === c ? (hides ? "hide" : "note") : null; }
    case "date":
      if (!DATE_SENSITIVE.has(x.type)) return null;
      if (!r.day || !x.period || r.day < x.period.from || r.day > x.period.to) return null;
      if (r.category && x.category && r.category !== x.category) return null;
      if (r.category && !x.category && !cats.has(r.category)) return null;
      return "note";
    default: return null;
  }
}

function applyRemarks(actions: Action[], remarks: Remark[], cats: Set<string>) {
  const visible: Action[] = [], hidden: Action[] = [];
  if (!remarks.length) return { visible: actions, hidden };
  for (const x of actions) {
    let hide: Remark | null = null;
    const notes: TeamNote[] = [];
    for (const r of remarks) {
      const m = applies(r, x, cats);
      if (m === "hide") { if (!hide || (hide.kind === "snooze" && r.kind === "not_applicable")) hide = r; }
      else if (m === "note") notes.push(note(r));
    }
    const out = notes.length ? { ...x, notes } : x;
    if (hide) hidden.push({ ...out, hiddenBy: note(hide) });
    else visible.push(out);
  }
  return { visible, hidden };
}

export const GROUP_LABEL: Record<ActionGroup, string> = { channel: "Channel", store: "Stores", sku: "SKU", merchandising: "Merchandising", marketing: "Marketing" };

/** Status the team set on actions (open / done / dismissed). */
export async function actionStatuses(): Promise<Map<string, string>> {
  const { dbConfigured, q } = await import("./db");
  if (!dbConfigured()) return new Map();
  return cached("actstatus", 30, async () => {
    const rows = await q<{ key: string; status: string }>("select key, status from action_status").catch(() => []);
    return new Map(rows.map((r) => [r.key, r.status]));
  });
}

/** Status details (who / when) for the Action Centre. */
export async function actionStatusDetails(): Promise<Map<string, { status: string; by: string; at: string; note: string | null }>> {
  const { dbConfigured, q } = await import("./db");
  if (!dbConfigured()) return new Map();
  return cached("actstatus:detail", 30, async () => {
    const rows = await q<{ key: string; status: string; updated_by: string; updated_at: string; note: string | null }>("select key, status, updated_by, updated_at::text updated_at, note from action_status").catch(() => []);
    return new Map(rows.map((r) => [r.key, { status: r.status, by: r.updated_by, at: r.updated_at, note: r.note }]));
  });
}
