import "server-only";
import { addDays, diffDays, endOfMonth, inRange, rangeDays, startOfMonth, startOfWeek, type Range } from "@/lib/dates";
import { growth, safeDiv, targetStatus, type TargetStatus, type Thresholds } from "@/lib/metrics";
import { catByKey, sortCats } from "@/lib/categories";
import { sfCached } from "./snowflake";
import type { Ctx } from "./context";
import type { Fact } from "./data/facts";
import type { Store } from "./data/stores";
import { catKey, getStoreCategoryMix, getStoreInventoryCoverage } from "./data/inventory";
import { prevMonthSameDays } from "./plan";

/**
 * Store Overview engine. One pass over store × category × day facts builds a store × category "cell" with every
 * window the Stores pages need; the live store report (OFFLINE_MASTER_DAILY_REPORT_1, latest date) adds stock and the
 * store's total L30 units across ALL categories (store size / penetration denominator).
 *
 * LIVE rule: a category is live in a store when the store holds stock of it on the latest store report OR it sold in
 * the last 60 days. Rankings, achievement and risk lists use live store × category cells only; targets set on
 * non-live cells are reported separately (reallocate or launch) instead of dragging achievement down.
 */

export const LIVE_LOOKBACK = 60;
export const RULE = {
  lowCoverDays: 14, lowCoverMinS30: 6,
  deadMinUnits: 10,
  paceGap: 0.25,
  wowDrop: -0.25, wowMinPrev: 5_000,
  underPenRatio: 0.5,
  minStoreUnits30: 300,
  minPeerStores: 5,
};

type Acc = { s: number; q: number; m: number; n: number; bs: number; bq: number; hb: boolean; t: number; ht: boolean };
const acc = (): Acc => ({ s: 0, q: 0, m: 0, n: 0, bs: 0, bq: 0, hb: false, t: 0, ht: false });
const WINS = ["r", "c", "mtd", "mon", "l60", "y", "lw", "l7", "p7", "wtd", "pwtd", "lm"] as const;
type Win = (typeof WINS)[number];

export interface Cell {
  b: string; c: string;
  w: Record<Win, Acc>;
  lastSale: string | null;
  /** live store report */
  inv: number; s30: number; inFeed: boolean;
  live: boolean;
  cover: number | null;
  /** category units ÷ store's total L30 units (all categories) */
  pen: number | null;
  stockOut: boolean; dead: boolean; lowCover: boolean;
}

export const fmtLt = (v: string | null | undefined) => {
  const x = (v ?? "").toUpperCase().replace(/[\s_-]+/g, "");
  return x === "HS" || x === "HIGHSTREET" ? "HS" : x === "MALL" ? "MALL" : x ? x : null;
};
export const fmtCt = (v: string | null | undefined) => {
  const x = (v ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  return x === "METRO" ? "METRO" : x === "NON_METRO" || x === "NONMETRO" ? "NON_METRO" : x || null;
};
export const LT_LABEL: Record<string, string> = { HS: "High street", MALL: "Mall" };
export const CT_LABEL: Record<string, string> = { METRO: "Metro", NON_METRO: "Non-metro" };

export interface Todo { kind: "stockout" | "lowcover" | "dead" | "pace" | "wow" | "nonlive" | "underpen" | "ok"; tone: "bad" | "warn" | "info" | "good"; text: string; c?: string; weight: number }

export interface StoreInsight {
  b: string; store: string; city: string | null; state: string | null; region: string | null; lt: string | null; ct: string | null;
  status: string | null; om: string | null; am: string | null; area: number | null;
  cells: Record<string, Cell>;
  liveCats: string[]; notLiveCats: string[];
  // totals (all cells in scope)
  sales: number; qty: number; prev: number; growth: number | null; mrp: number; disc: number | null; asp: number | null;
  bills: number | null; billSales: number; billQty: number; atv: number | null; upt: number | null; billLive: boolean;
  perDay: number; unitsPerDay: number; billsPerDay: number | null;
  // live cells only
  target: number | null; ach: number | null; gap: number | null; tstatus: TargetStatus;
  mtd: number; mtdTarget: number | null; monthTarget: number | null; projected: number; projAch: number | null; reqPerDay: number | null; curPerDay: number;
  nonLiveTarget: number; nonLiveTargetCats: string[];
  // DSR windows (all cells)
  y: number; yTarget: number | null; lw: number; l7: number; p7: number; wtd: number; pwtd: number; lm: number;
  // inventory (store report)
  inFeed: boolean; inv: number; s30: number; cover: number | null; storeUnits30: number; pen: number | null;
  stockOuts: string[]; dead: string[]; lowCover: string[];
  todos: Todo[];
}

export interface CatInsight {
  c: string; liveStores: number; notLive: number; sales: number; qty: number; prev: number; growth: number | null;
  target: number | null; ach: number | null; nonLiveTarget: number; nonLiveTargetStores: number;
  perLiveStoreDay: number | null; unitsPerLiveStoreDay: number | null; asp: number | null;
  inv: number; s30: number; cover: number | null; pen: number | null; medianPen: number | null;
  stockOuts: number; dead: number; lowCover: number;
  mtd: number; mtdTarget: number | null; monthTarget: number | null; projected: number; projAch: number | null;
}

export interface StoreModel {
  stores: StoreInsight[];
  byCode: Map<string, StoreInsight>;
  cats: CatInsight[];
  days: number; elapsed: number; daysInMonth: number; remainingDays: number;
  invDate: string | null; feedStores: number;
  /** peer median penetration per category (and per category × location type) */
  peerPen: (c: string, lt: string | null) => number | null;
  windows: Record<Win, Range>;
  catAsp: Map<string, number | null>;
}

/** Store attributes from the store report that the store dimension lacks (carpet area). */
async function getStoreAttrs(): Promise<Map<string, { area: number | null }>> {
  const T = "SNITCH_DB.MAPLEMONK.OFFLINE_MASTER_DAILY_REPORT_1";
  const rows = await sfCached<{ b: number; area: number | null }>(
    "storeattrs:v1",
    `select branch_code b, max(try_to_number(to_varchar(carpet_area))) area from ${T}
     where date = (select max(date) from ${T} where date >= dateadd(day, -7, current_date)) group by 1`,
    [], 3600,
  ).catch(() => []);
  return new Map(rows.map((r) => [String(Math.round(Number(r.b))), { area: r.area == null ? null : +r.area || null }]));
}

/** "NEW DELHI" → "New Delhi" (store master stores city / state in capitals). */
export const titleCase = (v: string | null | undefined) => (v ? v.toLowerCase().replace(/(^|[\s\-(/])\p{L}/gu, (m) => m.toUpperCase()) : null);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function windowsFor(ctx: Ctx): Record<Win, Range> {
  const a = ctx.asOf, ms = startOfMonth(a), ws = startOfWeek(a);
  return {
    r: ctx.period.range, c: ctx.period.compare,
    mtd: { from: ms, to: a }, mon: { from: ms, to: endOfMonth(a) },
    l60: { from: addDays(a, -(LIVE_LOOKBACK - 1)), to: a },
    y: { from: a, to: a }, lw: { from: addDays(a, -7), to: addDays(a, -7) },
    l7: { from: addDays(a, -6), to: a }, p7: { from: addDays(a, -13), to: addDays(a, -7) },
    wtd: { from: ws, to: a }, pwtd: { from: addDays(ws, -7), to: addDays(a, -7) },
    lm: prevMonthSameDays(a),
  };
}

/** Ranges loadFacts must cover for this model (beyond period / compare / MTD). */
export const modelRanges = (ctx: Ctx): Range[] => { const w = windowsFor(ctx); return [w.l60, w.lm, w.pwtd, w.p7]; };

export async function buildStoreModel(ctx: Ctx, facts: Fact[]): Promise<StoreModel> {
  const [mix, cov, attrs] = await Promise.all([getStoreCategoryMix(), getStoreInventoryCoverage(), getStoreAttrs()]);
  const W = windowsFor(ctx);
  const cats = ctx.filters.cats;
  const catSet = new Set(cats);
  const th: Thresholds = ctx.settings.thresholds;
  const storeFilter = ctx.filters.stores.length ? new Set(ctx.filters.stores) : null;

  // --- live store report: in-scope stock by store × category, store size (all categorised units)
  const invCell = new Map<string, { inv: number; s30: number }>();
  const storeUnits = new Map<string, number>();
  const feed = new Set<string>();
  for (const r of mix.rows) {
    feed.add(r.b);
    if (r.cat && r.cat !== "Other") storeUnits.set(r.b, (storeUnits.get(r.b) ?? 0) + r.s30);
    const k = catKey(r.cat);
    if (!k || !catSet.has(k)) continue;
    const key = `${r.b}|${k}`;
    const x = invCell.get(key) ?? { inv: 0, s30: 0 };
    x.inv += r.inv; x.s30 += r.s30;
    invCell.set(key, x);
  }
  const feedNames = new Map(cov.map((c) => [String(c.b), String(c.store ?? "").replace(/^SNITCH\s*-\s*/i, "")]));

  // --- one pass over facts
  const cells = new Map<string, Cell>();
  const cell = (b: string, c: string) => {
    const key = `${b}|${c}`;
    let x = cells.get(key);
    if (!x) {
      x = { b, c, w: Object.fromEntries(WINS.map((k) => [k, acc()])) as Record<Win, Acc>, lastSale: null, inv: 0, s30: 0, inFeed: false, live: false, cover: null, pen: null, stockOut: false, dead: false, lowCover: false };
      cells.set(key, x);
    }
    return x;
  };
  for (const f of facts) {
    if (!catSet.has(f.c)) continue;
    if (storeFilter && !storeFilter.has(f.b)) continue;
    const x = cell(f.b, f.c);
    for (const k of WINS) {
      if (!inRange(f.d, W[k])) continue;
      const a = x.w[k];
      a.s += f.s; a.q += f.q; a.m += f.m;
      if (f.n != null) { a.n += f.n; a.bs += f.s; a.bq += f.q; a.hb = true; }
      if (f.t != null) { a.t += f.t; a.ht = true; }
    }
    if ((f.s > 0 || f.q > 0) && f.d <= ctx.asOf && (!x.lastSale || f.d > x.lastSale)) x.lastSale = f.d;
  }
  // cells that only exist in the store report
  for (const [key] of invCell) { const [b, c] = key.split("|"); if (!storeFilter || storeFilter.has(b)) cell(b, c); }

  // --- finalise cells
  for (const x of cells.values()) {
    const iv = invCell.get(`${x.b}|${x.c}`);
    x.inFeed = feed.has(x.b);
    x.inv = iv?.inv ?? 0; x.s30 = iv?.s30 ?? 0;
    const soldL60 = x.w.l60.s > 0 || x.w.l60.q > 0 || x.s30 > 0;
    x.live = x.inv > 0 || soldL60;
    x.cover = x.inFeed && x.s30 > 0 ? x.inv / (x.s30 / 30) : null;
    const su = storeUnits.get(x.b) ?? 0;
    x.pen = x.inFeed && su > 0 ? x.s30 / su : null;
    x.stockOut = x.inFeed && x.live && x.inv <= 0 && soldL60;
    x.dead = x.inFeed && x.inv >= RULE.deadMinUnits && x.s30 === 0;
    x.lowCover = x.inFeed && x.inv > 0 && x.s30 >= RULE.lowCoverMinS30 && x.cover != null && x.cover < RULE.lowCoverDays;
  }

  // --- peer penetration medians (live cells in stores big enough to be meaningful)
  const penBy = new Map<string, number[]>();
  for (const x of cells.values()) {
    if (!x.live || x.pen == null || (storeUnits.get(x.b) ?? 0) < RULE.minStoreUnits30) continue;
    const lt = fmtLt(ctx.byCode.get(x.b)?.location_type);
    for (const k of [x.c, `${x.c}|${lt}`]) { let a = penBy.get(k); if (!a) penBy.set(k, (a = [])); a.push(x.pen); }
  }
  const penMed = new Map([...penBy].map(([k, v]) => [k, { m: median(v), n: v.length }]));
  const peerPen = (c: string, lt: string | null) => {
    const s = lt ? penMed.get(`${c}|${lt}`) : undefined;
    return s && s.n >= RULE.minPeerStores ? s.m : penMed.get(c)?.m ?? null;
  };

  // --- category ASP (range, network) for potential estimates
  const catAsp = new Map<string, number | null>();
  { const t = new Map<string, { s: number; q: number }>(); for (const x of cells.values()) { const a = t.get(x.c) ?? { s: 0, q: 0 }; a.s += x.w.r.s || x.w.l60.s; a.q += x.w.r.q || x.w.l60.q; t.set(x.c, a); } for (const c of cats) catAsp.set(c, safeDiv(t.get(c)?.s, t.get(c)?.q)); }

  // --- stores
  const days = rangeDays(W.r);
  const ms = startOfMonth(ctx.asOf), me = endOfMonth(ctx.asOf);
  const daysInMonth = diffDays(ms, me) + 1, elapsed = diffDays(ms, ctx.asOf) + 1, remainingDays = daysInMonth - elapsed;
  const byStore = new Map<string, Cell[]>();
  for (const x of cells.values()) { let a = byStore.get(x.b); if (!a) byStore.set(x.b, (a = [])); a.push(x); }
  const stores: StoreInsight[] = [];
  for (const [b, cs] of byStore) {
    const st: Store | undefined = ctx.byCode.get(b);
    const live = cs.filter((x) => x.live);
    const anySales = cs.some((x) => x.w.r.s !== 0 || x.w.c.s !== 0);
    if (!live.length && !anySales && !cs.some((x) => x.w.mon.ht)) continue;
    const sum = (arr: Cell[], w: Win, f: keyof Acc) => arr.reduce((a, x) => a + (x.w[w][f] as number), 0);
    const has = (arr: Cell[], w: Win, f: "ht" | "hb") => arr.some((x) => x.w[w][f]);
    const sales = sum(cs, "r", "s"), qty = sum(cs, "r", "q"), prev = sum(cs, "c", "s"), mrp = sum(cs, "r", "m");
    const hb = has(cs, "r", "hb"), bills = hb ? sum(cs, "r", "n") : null, billSales = sum(cs, "r", "bs"), billQty = sum(cs, "r", "bq");
    const hT = has(live, "r", "ht"), target = hT ? sum(live, "r", "t") : null;
    const mtd = sum(live, "mtd", "s"), hM = has(live, "mon", "ht");
    const mtdTarget = hM ? sum(live, "mtd", "t") : null, monthTarget = hM ? sum(live, "mon", "t") : null;
    const projected = monthTarget && mtdTarget && mtdTarget > 0 ? (mtd / mtdTarget) * monthTarget : (mtd / elapsed) * daysInMonth;
    const nonLive = cs.filter((x) => !x.live && (x.w.mon.t > 0 || x.w.r.t > 0));
    const inv = cs.reduce((a, x) => a + x.inv, 0), s30 = cs.reduce((a, x) => a + x.s30, 0);
    const su = storeUnits.get(b) ?? 0;
    const lt = fmtLt(st?.location_type), ct = fmtCt(st?.city_type);
    const allY = sum(cs, "y", "s");
    const s: StoreInsight = {
      b, store: st?.short_name ?? feedNames.get(b) ?? `Branch ${b}`, city: titleCase(st?.city), state: titleCase(st?.state), region: titleCase(st?.region), lt, ct,
      status: st?.store_status ?? null, om: st?.operating_model ?? null, am: st?.am ?? null, area: attrs.get(b)?.area ?? null,
      cells: Object.fromEntries(cs.map((x) => [x.c, x])),
      liveCats: cats.filter((c) => cs.some((x) => x.c === c && x.live)), notLiveCats: cats.filter((c) => !cs.some((x) => x.c === c && x.live)),
      sales, qty, prev, growth: growth(sales, prev), mrp, disc: mrp > 0 ? 1 - sales / mrp : null, asp: safeDiv(sales, qty),
      bills, billSales, billQty, atv: hb ? safeDiv(billSales, bills) : null, upt: hb ? safeDiv(billQty, bills) : null,
      billLive: live.some((x) => catByKey(x.c)?.source === "dsr"),
      perDay: sales / days, unitsPerDay: qty / days, billsPerDay: bills == null ? null : bills / days,
      target, ach: safeDiv(sum(live, "r", "s"), target), gap: target == null ? null : target - sum(live, "r", "s"),
      tstatus: targetStatus(sum(live, "r", "s"), target, th),
      mtd, mtdTarget, monthTarget, projected, projAch: safeDiv(projected, monthTarget),
      reqPerDay: monthTarget == null ? null : remainingDays > 0 ? Math.max(monthTarget - mtd, 0) / remainingDays : null, curPerDay: mtd / elapsed,
      nonLiveTarget: nonLive.reduce((a, x) => a + (x.w.mon.t || x.w.r.t), 0), nonLiveTargetCats: sortCats(nonLive.map((x) => x.c)),
      y: allY, yTarget: has(live, "y", "ht") ? sum(live, "y", "t") : null, lw: sum(cs, "lw", "s"), l7: sum(cs, "l7", "s"), p7: sum(cs, "p7", "s"),
      wtd: sum(cs, "wtd", "s"), pwtd: sum(cs, "pwtd", "s"), lm: sum(cs, "lm", "s"),
      inFeed: feed.has(b), inv, s30, cover: feed.has(b) && s30 > 0 ? inv / (s30 / 30) : null, storeUnits30: su, pen: su > 0 ? s30 / su : null,
      stockOuts: sortCats(cs.filter((x) => x.stockOut).map((x) => x.c)), dead: sortCats(cs.filter((x) => x.dead).map((x) => x.c)), lowCover: sortCats(cs.filter((x) => x.lowCover).map((x) => x.c)),
      todos: [],
    };
    s.todos = todosFor(s, peerPen, catAsp, remainingDays, th);
    stores.push(s);
  }
  stores.sort((a, b) => b.sales - a.sales);

  // --- categories
  const catRows: CatInsight[] = cats.map((c) => {
    const cs = stores.map((s) => s.cells[c]).filter(Boolean) as Cell[];
    const live = cs.filter((x) => x.live);
    const liveSales = live.reduce((a, x) => a + x.w.r.s, 0);
    const hT = live.some((x) => x.w.r.ht), target = hT ? live.reduce((a, x) => a + x.w.r.t, 0) : null;
    const sales = cs.reduce((a, x) => a + x.w.r.s, 0), qty = cs.reduce((a, x) => a + x.w.r.q, 0), prev = cs.reduce((a, x) => a + x.w.c.s, 0);
    const nl = cs.filter((x) => !x.live && (x.w.mon.t > 0 || x.w.r.t > 0));
    const inv = cs.reduce((a, x) => a + x.inv, 0), s30 = cs.reduce((a, x) => a + x.s30, 0);
    const su = live.reduce((a, x) => a + (storeUnits.get(x.b) ?? 0), 0);
    const mtd = live.reduce((a, x) => a + x.w.mtd.s, 0), hM = live.some((x) => x.w.mon.ht);
    const mtdTarget = hM ? live.reduce((a, x) => a + x.w.mtd.t, 0) : null, monthTarget = hM ? live.reduce((a, x) => a + x.w.mon.t, 0) : null;
    const projected = monthTarget && mtdTarget && mtdTarget > 0 ? (mtd / mtdTarget) * monthTarget : (mtd / elapsed) * daysInMonth;
    return {
      c, liveStores: live.length, notLive: stores.length - live.length, sales, qty, prev, growth: growth(sales, prev),
      target, ach: safeDiv(liveSales, target), nonLiveTarget: nl.reduce((a, x) => a + (x.w.mon.t || x.w.r.t), 0), nonLiveTargetStores: nl.length,
      perLiveStoreDay: safeDiv(sales, live.length * days), unitsPerLiveStoreDay: safeDiv(qty, live.length * days), asp: safeDiv(sales, qty),
      inv, s30, cover: s30 > 0 ? inv / (s30 / 30) : null, pen: safeDiv(s30, su), medianPen: peerPen(c, null),
      stockOuts: cs.filter((x) => x.stockOut).length, dead: cs.filter((x) => x.dead).length, lowCover: cs.filter((x) => x.lowCover).length,
      mtd, mtdTarget, monthTarget, projected, projAch: safeDiv(projected, monthTarget),
    };
  });

  return {
    stores, byCode: new Map(stores.map((s) => [s.b, s])), cats: catRows, days, elapsed, daysInMonth, remainingDays,
    invDate: mix.date, feedStores: feed.size, peerPen, windows: W, catAsp,
  };
}

const L = (c: string) => catByKey(c)?.label ?? c;
const r0 = (v: number) => Math.round(v).toLocaleString("en-IN");
const inrS = (v: number) => (Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : Math.abs(v) >= 1e3 ? `₹${(v / 1e3).toFixed(1)}K` : `₹${Math.round(v)}`);

/** Store to-dos, strongest first. Every item is computed from the store's own data (or its format peers). */
function todosFor(s: StoreInsight, peerPen: StoreModel["peerPen"], asp: Map<string, number | null>, remainingDays: number, th: Thresholds): Todo[] {
  const out: Todo[] = [];
  for (const x of Object.values(s.cells)) {
    const perDayRev = (x.s30 / 30) * (asp.get(x.c) ?? 0);
    if (x.stockOut) out.push({ kind: "stockout", tone: "bad", c: x.c, weight: 100 + perDayRev, text: `Restock ${L(x.c)} — ${x.s30 > 0 ? `sold ${r0(x.s30)} units in 30 days` : `sold in the last ${LIVE_LOOKBACK} days`}, 0 units in store` });
    else if (x.lowCover) out.push({ kind: "lowcover", tone: "warn", c: x.c, weight: 80 + perDayRev, text: `Replenish ${L(x.c)} — ${r0(x.cover!)} days of cover (${r0(x.inv)} units, ${r0(x.s30)} sold L30)` });
    if (x.dead) out.push({ kind: "dead", tone: "warn", c: x.c, weight: 40 + x.inv / 10, text: `Move or re-merchandise ${L(x.c)} — ${r0(x.inv)} units in store, no sale in 30 days` });
    if (!x.live && (x.w.mon.t > 0 || x.w.r.t > 0)) out.push({ kind: "nonlive", tone: "info", c: x.c, weight: 30, text: `${L(x.c)} has a ${inrS(x.w.mon.t || x.w.r.t)} target but is not live (no stock, no sale in ${LIVE_LOOKBACK} days) — launch it or reallocate the target` });
    if (x.live && x.inv > 0 && x.pen != null && s.storeUnits30 >= RULE.minStoreUnits30) {
      const peer = peerPen(x.c, s.lt);
      if (peer && x.pen < peer * RULE.underPenRatio) out.push({ kind: "underpen", tone: "info", c: x.c, weight: 20 + (peer - x.pen) * s.storeUnits30, text: `${L(x.c)} is ${(x.pen * 100).toFixed(1)}% of store units vs ${(peer * 100).toFixed(1)}% peer median — improve placement, VM and range depth` });
    }
  }
  // near month end the required run rate explodes; flag the expected closing shortfall instead
  if (remainingDays < 3) {
    if (s.monthTarget && s.projAch != null && s.projAch < th.atRisk)
      out.push({ kind: "pace", tone: "bad", weight: 90, text: `Closing the month at ~${Math.round(s.projAch * 100)}% of target (${inrS(Math.max(s.monthTarget - s.projected, 0))} short) — review what blocked: stock, staffing, VM` });
  } else if (s.reqPerDay != null && s.curPerDay > 0 && s.reqPerDay > s.curPerDay * (1 + RULE.paceGap))
    out.push({ kind: "pace", tone: "bad", weight: 90, text: `Needs ${inrS(s.reqPerDay)}/day vs ${inrS(s.curPerDay)}/day now (+${Math.round((s.reqPerDay / s.curPerDay - 1) * 100)}%) to hit the month target` });
  const wow = growth(s.l7, s.p7);
  if (wow != null && wow <= RULE.wowDrop && s.p7 >= RULE.wowMinPrev) out.push({ kind: "wow", tone: "warn", weight: 60, text: `Sales down ${Math.round(-wow * 100)}% vs the prior 7 days (${inrS(s.l7)} vs ${inrS(s.p7)})` });
  if (!out.length) out.push({ kind: "ok", tone: "good", weight: 0, text: s.projAch != null && s.projAch >= 1 ? "Pacing to target — protect availability of top sellers" : "No issue flagged — keep availability and VM steady" });
  return out.sort((a, b) => b.weight - a.weight);
}

/** Aggregate a set of stores (state, format, city type…). Per-store-day rates use live stores only. */
export interface GroupAgg {
  key: string; label: string; stores: number; liveStores: number;
  sales: number; prev: number; growth: number | null; qty: number; share: number | null;
  perStoreDay: number | null; unitsPerStoreDay: number | null; billsPerStoreDay: number | null; atv: number | null; upt: number | null; asp: number | null; disc: number | null;
  target: number | null; ach: number | null; projAch: number | null; ahead: number; behind: number; withTarget: number;
  inv: number; cover: number | null; pen: number | null; stockOuts: number; coverage: number | null;
}

export function groupStores(m: StoreModel, keyOf: (s: StoreInsight) => string | null, labelOf: (k: string) => string = (k) => k, th: Thresholds): GroupAgg[] {
  const g = new Map<string, StoreInsight[]>();
  for (const s of m.stores) { const k = keyOf(s) ?? "—"; let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(s); }
  const total = m.stores.reduce((a, s) => a + s.sales, 0);
  const nCats = m.cats.length || 1;
  return [...g].map(([k, ss]) => {
    const live = ss.filter((s) => s.liveCats.length);
    const billStores = ss.filter((s) => s.billLive).length;
    const sales = ss.reduce((a, s) => a + s.sales, 0), prev = ss.reduce((a, s) => a + s.prev, 0), qty = ss.reduce((a, s) => a + s.qty, 0), mrp = ss.reduce((a, s) => a + s.mrp, 0);
    const bills = ss.reduce((a, s) => a + (s.bills ?? 0), 0), bS = ss.reduce((a, s) => a + s.billSales, 0), bQ = ss.reduce((a, s) => a + s.billQty, 0);
    const tS = ss.filter((s) => s.target != null && s.target > 0);
    const target = tS.length ? tS.reduce((a, s) => a + s.target!, 0) : null;
    const liveSalesT = tS.reduce((a, s) => a + (s.ach ?? 0) * s.target!, 0);
    const mT = ss.filter((s) => s.monthTarget);
    const inv = ss.reduce((a, s) => a + s.inv, 0), s30 = ss.reduce((a, s) => a + s.s30, 0), su = ss.reduce((a, s) => a + s.storeUnits30, 0);
    const liveCells = ss.reduce((a, s) => a + s.liveCats.length, 0);
    return {
      key: k, label: k === "—" ? "Not set" : labelOf(k), stores: ss.length, liveStores: live.length,
      sales, prev, growth: growth(sales, prev), qty, share: safeDiv(sales, total),
      perStoreDay: safeDiv(sales, live.length * m.days), unitsPerStoreDay: safeDiv(qty, live.length * m.days), billsPerStoreDay: bills ? safeDiv(bills, billStores * m.days) : null,
      atv: bills ? bS / bills : null, upt: bills ? bQ / bills : null, asp: safeDiv(sales, qty), disc: mrp > 0 ? 1 - sales / mrp : null,
      target, ach: safeDiv(liveSalesT, target),
      projAch: mT.length ? safeDiv(mT.reduce((a, s) => a + s.projected, 0), mT.reduce((a, s) => a + s.monthTarget!, 0)) : null,
      ahead: tS.filter((s) => (s.ach ?? 0) >= th.onTrack).length, behind: tS.filter((s) => (s.ach ?? 0) < th.atRisk).length, withTarget: tS.length,
      inv, cover: s30 > 0 ? inv / (s30 / 30) : null, pen: safeDiv(s30, su), stockOuts: ss.reduce((a, s) => a + s.stockOuts.length, 0),
      coverage: safeDiv(liveCells, ss.length * nCats),
    };
  }).sort((a, b) => b.sales - a.sales);
}

/** Non-live store candidates for a category, ranked by estimated potential (store size × format peer penetration × ASP). */
export function expansionCandidates(m: StoreModel, c: string) {
  const asp = m.catAsp.get(c) ?? null;
  const cityLive = new Map<string, number>();
  for (const s of m.stores) if (s.city && s.cells[c]?.live) cityLive.set(s.city.toUpperCase(), (cityLive.get(s.city.toUpperCase()) ?? 0) + 1);
  return m.stores
    .filter((s) => !s.cells[c]?.live && s.inFeed && s.storeUnits30 > 0)
    .map((s) => {
      const peer = m.peerPen(c, s.lt);
      const units30 = peer != null ? s.storeUnits30 * peer : null;
      return {
        b: s.b, store: s.store, city: s.city, state: s.state, lt: s.lt, ct: s.ct, area: s.area, storeUnits30: s.storeUnits30,
        peerPen: peer, units30, revenue30: units30 != null && asp != null ? units30 * asp : null,
        cityLive: s.city ? cityLive.get(s.city.toUpperCase()) ?? 0 : 0,
        target: s.cells[c]?.w.mon.t || null,
      };
    })
    .sort((a, b) => (b.revenue30 ?? b.storeUnits30) - (a.revenue30 ?? a.storeUnits30));
}

/** Cities where no store has the category live, with the strongest store to launch in. */
export function cityGaps(m: StoreModel, c: string) {
  const g = new Map<string, StoreInsight[]>();
  for (const s of m.stores) { if (!s.city) continue; const k = s.city.toUpperCase(); let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(s); }
  const asp = m.catAsp.get(c) ?? null;
  const out: { city: string; state: string | null; stores: number; units30: number; best: StoreInsight; potential30: number | null }[] = [];
  for (const ss of g.values()) {
    if (ss.some((s) => s.cells[c]?.live)) continue;
    const best = [...ss].sort((a, b) => b.storeUnits30 - a.storeUnits30)[0];
    const peer = m.peerPen(c, best.lt);
    out.push({ city: best.city!, state: best.state, stores: ss.length, units30: ss.reduce((a, s) => a + s.storeUnits30, 0), best, potential30: peer != null && asp != null ? best.storeUnits30 * peer * asp : null });
  }
  return out.sort((a, b) => b.units30 - a.units30);
}

/** Live stores whose category share of units is far below format peers (range / VM opportunity). */
export function underPenetrated(m: StoreModel, c: string) {
  const asp = m.catAsp.get(c) ?? null;
  return m.stores
    .map((s) => ({ s, x: s.cells[c] }))
    .filter(({ s, x }) => x?.live && x.inv > 0 && x.pen != null && s.storeUnits30 >= RULE.minStoreUnits30)
    .map(({ s, x }) => {
      const peer = m.peerPen(c, s.lt);
      const gapUnits = peer != null ? Math.max(peer - x!.pen!, 0) * s.storeUnits30 : 0;
      return { b: s.b, store: s.store, city: s.city, lt: s.lt, pen: x!.pen!, peer, units30: x!.s30, inv: x!.inv, storeUnits30: s.storeUnits30, gapUnits, gapRevenue: asp != null ? gapUnits * asp : null };
    })
    .filter((r) => r.peer != null && r.pen < r.peer * RULE.underPenRatio)
    .sort((a, b) => (b.gapRevenue ?? b.gapUnits) - (a.gapRevenue ?? a.gapUnits));
}
