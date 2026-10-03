import "server-only";
import type { Ctx } from "./context";
import type { Scope } from "./productInsights";
import { getSkuFacts } from "./data/sku";
import { getChannelSku } from "./data/channels";
import { getRecentInwards } from "./data/metafields";
import { getTargetBook } from "./data/targetBook";
import { productL1 } from "./data/products";
import { computePlan, dailyTarget, type PlanChannel } from "./plan";
import { channelMetrics } from "./channelData";
import { MARKETPLACES, OMNI, QCOM, ONLINE } from "@/lib/categories";
import { catColor, catLabel } from "./views";
import { eachDay, endOfMonth, minDate, monthsBetween, startOfMonth } from "@/lib/dates";
import { safeDiv } from "@/lib/metrics";
import { cached } from "@/lib/cache";

export type CvView = "overall" | "stores" | "online" | "omni" | "qcom" | "marketplace";
export const GST = 1.18;

export interface CvRow {
  key: string; label: string; color: string | null;
  /** current inventory for this view (stores: store stock; online / marketplace: warehouse; overall: store + in transit + warehouse) */
  inv: number | null; invStore: number; invGit: number; invWh: number;
  units: number; revenue: number; mrp: number; cogs: number; costCovered: number;
  disc: number | null; gp: number | null; doi: number | null; str: number | null;
  inward30: number; returnsPct: number | null; asp: number | null;
  target: number | null; ach: number | null; projection: number | null; projAch: number | null; share: number | null;
}
export interface CvTable { view: CvView; rows: CvRow[]; total: CvRow; note: string | null }

const blank = (key: string, label: string, color: string | null): CvRow => ({
  key, label, color, inv: 0, invStore: 0, invGit: 0, invWh: 0, units: 0, revenue: 0, mrp: 0, cogs: 0, costCovered: 0,
  disc: null, gp: null, doi: null, str: null, inward30: 0, returnsPct: null, asp: null, target: null, ach: null, projection: null, projAch: null, share: null,
});

/**
 * Category view: one row per category (or per product type when one category is selected) for the overall business
 * and for each channel. Period metrics follow the selected period; DOI is always on the last 30 days.
 * Gross profit % = (revenue ÷ 1.18 − COGS) ÷ (revenue ÷ 1.18), COGS = units × unit cost from the SKU master.
 */
export async function categoryViews(ctx: Ctx, sc: Scope): Promise<{ grouping: "category" | "type"; tables: Record<CvView, CvTable> }> {
  const { range, compare } = ctx.period;
  const multi = ctx.filters.cats.length > 1;
  const [st, ucSku, inwards] = await Promise.all([
    getSkuFacts({ range, compare, asOf: ctx.asOf, cats: ctx.filters.cats, ch: "store" }),
    getChannelSku({ range, compare, asOf: ctx.asOf }),
    cached(`cv:inward30:${ctx.asOf}`, 1800, () => getRecentInwards(30)).catch(() => [] as Awaited<ReturnType<typeof getRecentInwards>>),
  ]);
  const cats = new Set(ctx.filters.cats);
  const groupOf = (sku: string): { key: string; label: string; color: string | null } | null => {
    const p = sc.pm.get(sku);
    if (!p?.category || !cats.has(p.category)) return null;
    if (multi) return { key: p.category, label: catLabel(p.category), color: catColor(p.category) };
    const t = productL1(p) ?? "Untyped";
    return { key: t, label: t, color: null };
  };
  const inw = new Map<string, number>();
  for (const r of inwards) inw.set(r.sku.toUpperCase(), (inw.get(r.sku.toUpperCase()) ?? 0) + r.qty);

  // per-SKU period figures by channel
  type Ch = "stores" | "online" | "omni" | "qcom" | "marketplace";
  const CHS: Ch[] = ["stores", "online", "omni", "qcom", "marketplace"];
  const sk = new Map<string, Record<Ch, { rs: number; rq: number; mrp: number; l30q: number }>>();
  const get = (s: string) => { let e = sk.get(s); if (!e) sk.set(s, (e = Object.fromEntries(CHS.map((c) => [c, { rs: 0, rq: 0, mrp: 0, l30q: 0 }])) as Record<Ch, { rs: number; rq: number; mrp: number; l30q: number }>)); return e; };
  for (const f of st) { const e = get(f.sku).stores; e.rs += f.rs; e.rq += f.rq; e.mrp += f.rs + f.disc; e.l30q += f.l30q; }
  const chOf = (mp: string): Ch | null => (mp === ONLINE ? "online" : mp === OMNI ? "omni" : mp === QCOM ? "qcom" : (MARKETPLACES as readonly string[]).includes(mp) ? "marketplace" : null);
  for (const f of ucSku) { const k = chOf(f.mp); if (!k) continue; const e = get(f.sku)[k]; e.rs += f.rs; e.rq += f.rq; e.mrp += f.rm; e.l30q += f.l30q; }

  const skus = new Set<string>([...sk.keys(), ...sc.products.map((p) => p.sku)]);
  const build = (view: CvView): CvTable => {
    const rows = new Map<string, CvRow & { _l30: number; _ret: number; _sold30: number }>();
    for (const sku of skus) {
      const g = groupOf(sku); if (!g) continue;
      const p = sc.pm.get(sku)!;
      const r = rows.get(g.key) ?? Object.assign(blank(g.key, g.label, g.color), { _l30: 0, _ret: 0, _sold30: 0 });
      const e = sk.get(sku);
      const store = Math.max(0, p.invOffline ?? 0), git = sc.git.bySku.get(sku)?.units ?? 0, wh = Math.max(0, sc.wh.bySku.get(sku)?.units ?? 0);
      let rs = 0, rq = 0, mrp = 0, l30 = 0, ret: number | null = null, sold30: number | null = null, inv = 0;
      {
        const chs: Ch[] = view === "overall" ? CHS : [view];
        for (const c of chs) { if (!e) continue; rs += e[c].rs; rq += e[c].rq; mrp += e[c].mrp; l30 += e[c].l30q; }
        const by = view === "overall" ? "all" : view;
        ret = p.l30ReturnedQtyBy[by] ?? null; sold30 = p.l30QtyBy[by] ?? null;
        // stock that serves each view: stores and Omni ship from store stock, Online and Marketplace from the warehouse; Qcom stock isn't in the data
        inv = view === "overall" ? store + git + wh : view === "stores" || view === "omni" ? store : view === "qcom" ? 0 : wh;
      }
      r.revenue += rs; r.units += rq; r.mrp += mrp; r._l30 += l30;
      if (p.unitCost != null && p.unitCost > 0) { r.cogs += rq * p.unitCost; r.costCovered += rs; }
      r.inv = (r.inv ?? 0) + inv; r.invStore += store; r.invGit += git; r.invWh += wh;
      r.inward30 += inw.get(sku) ?? 0;
      if (ret != null) r._ret += ret; if (sold30 != null) r._sold30 += sold30;
      rows.set(g.key, r);
    }
    const finish = (r: CvRow & { _l30: number; _ret: number; _sold30: number }) => {
      const net = r.costCovered / GST;
      r.gp = r.costCovered > 0 ? (net - r.cogs) / net : null;
      r.disc = r.mrp > 0 ? 1 - r.revenue / r.mrp : null;
      r.asp = safeDiv(r.revenue, r.units);
      if (view === "qcom") { r.inv = null; r.doi = null; r.str = null; }
      else { r.doi = r._l30 > 0 ? (r.inv ?? 0) / (r._l30 / 30) : null; r.str = r.units + (r.inv ?? 0) > 0 ? r.units / (r.units + (r.inv ?? 0)) : null; }
      r.returnsPct = r._sold30 > 0 ? Math.min(1, r._ret / r._sold30) : null;
      return r;
    };
    const list = [...rows.values()].map(finish).filter((r) => r.revenue > 0 || (r.inv ?? 0) > 0 || r.units > 0);
    const tot = Object.assign(blank("__total", "Total", null), { _l30: 0, _ret: 0, _sold30: 0 });
    for (const r of rows.values()) {
      tot.revenue += r.revenue; tot.units += r.units; tot.mrp += r.mrp; tot.cogs += r.cogs; tot.costCovered += r.costCovered; tot.inv = (tot.inv ?? 0) + (r.inv ?? 0);
      tot.invStore += r.invStore; tot.invGit += r.invGit; tot.invWh += r.invWh; tot.inward30 += r.inward30; tot._l30 += r._l30; tot._ret += r._ret; tot._sold30 += r._sold30;
    }
    finish(tot);
    for (const r of list) r.share = safeDiv(r.revenue, tot.revenue);
    tot.share = tot.revenue > 0 ? 1 : null;
    list.sort((a, b) => (multi ? a.label.localeCompare(b.label) : b.revenue - a.revenue));
    return { view, rows: list, total: tot, note: view === "qcom" ? "Qcom stock sits in separate Qcom godowns that aren't in the current data, so inventory, DOI and STR are blank" : view === "omni" ? "Omni orders ship from store stock — inventory shown is store stock" : null };
  };
  const tables = { overall: build("overall"), stores: build("stores"), online: build("online"), omni: build("omni"), qcom: build("qcom"), marketplace: build("marketplace") } as Record<CvView, CvTable>;

  // targets, achievement and projection (categories only — targets are set per category and channel)
  if (multi) {
    const months = monthsBetween(range.from, minDate(range.to, ctx.asOf));
    const book = await getTargetBook(months[0] ?? startOfMonth(ctx.asOf), startOfMonth(ctx.asOf));
    const th = ctx.settings.thresholds;
    const days = eachDay(range.from, minDate(range.to, ctx.asOf));
    // Online targets cover all of Online (normal + Omni + Qcom), so they sit on the overall, stores and marketplace views
    for (const view of ["overall", "stores", "marketplace"] as const) {
      const ch: PlanChannel = view === "overall" ? "all" : view;
      let tT = 0, tA = 0, tP = 0, any = false;
      for (const r of tables[view].rows) {
        const f = sc.facts.filter((x) => x.c === r.key), u = sc.uc.filter((x) => x.c === r.key);
        const plans = new Map(months.map((m) => [m, computePlan(f, u, minDate(endOfMonth(m), ctx.asOf), ch, book, [r.key], th)]));
        let target = 0, has = false, achRev = 0;
        for (const d of days) {
          const t = dailyTarget(plans.get(startOfMonth(d))!, f, book, d);
          if (t == null) continue;
          target += t; has = true; achRev += channelMetrics(f, u, { from: d, to: d }, ch).revenue;
        }
        const cur = computePlan(f, u, ctx.asOf, ch, book, [r.key], th);
        r.target = has ? target : null; r.ach = has ? safeDiv(achRev, target) : null;
        r.projection = cur.projected; r.projAch = cur.projectedAch;
        if (has) { tT += target; tA += achRev; any = true; }
        tP += cur.projected;
      }
      const tt = tables[view].total;
      tt.target = any ? tT : null; tt.ach = any ? safeDiv(tA, tT) : null; tt.projection = tP;
    }
  }
  return { grouping: multi ? "category" : "type", tables };
}
