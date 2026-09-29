import "server-only";
import { z } from "zod";
import { CATEGORIES } from "@/lib/categories";
import { addDays, addMonths, diffDays, endOfMonth, minDate, maxDate, rangeDays, resolvePeriod, startOfMonth, startOfWeek, eachDay, type Preset, type Range } from "@/lib/dates";
import type { Filters } from "@/lib/filters";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";
import { getSettings } from "../settings";
import { getFreshness } from "../data/freshness";
import { getStoreMap, type Store } from "../data/stores";
import { getProductMap, productType } from "../data/products";
import { getSkuDailyMulti } from "../data/sku";
import { getNetworkInventory, getStoreInventory, getStoreInventoryCoverage } from "../data/inventory";
import { groupFacts, monthOutlook, summarize, storeMatcher } from "../analytics";
import { loadFacts, type Ctx } from "../context";
import { loadSkus } from "../skus";
import { storeSignals, exceptionRanges } from "../exceptions";
import { catLabel } from "../views";
import { resolveLocation, resolveProduct } from "./resolve";

/* ------------------------------------------------------------------ shared parameter schemas */

const CatKey = z.enum(CATEGORIES.map((c) => c.key) as [string, ...string[]]);
const PeriodSchema = z.strictObject({
  preset: z.enum(["today", "yesterday", "this_week", "last_week", "l7", "l30", "mtd", "last_month", "custom"]).describe(
    "today is partial (still filling); yesterday = last complete day; this_week = Mon→as-of (WTD); last_week = previous full Mon–Sun; l7/l30 end at the as-of date; mtd = 1st→as-of; last_month = previous full month",
  ),
  from: z.string().nullable().describe("YYYY-MM-DD, only for preset=custom"),
  to: z.string().nullable().describe("YYYY-MM-DD, only for preset=custom"),
});
const CompareSchema = z.enum(["auto", "previous_period", "same_days_last_week", "previous_month_same_days", "previous_month_full", "none"]).describe(
  "auto picks the like-for-like default (MTD → prev month same days; WTD → same weekdays last week; yesterday → same weekday last week).",
);
const ScopeSchema = z.strictObject({
  branch_codes: z.array(z.string()).nullable().describe("Store branch codes from resolve_location"),
  cities: z.array(z.string()).nullable(),
  states: z.array(z.string()).nullable(),
  regions: z.array(z.string()).nullable().describe("North / South / East / West / Central"),
  store_types: z.array(z.enum(["COCO", "COFO", "FOCO"])).nullable(),
  area_managers: z.array(z.string()).nullable(),
});
const Categories = z.array(CatKey).nullable().describe("null = all enabled categories");
const Limit = z.number().int().min(1).max(200).nullable().describe("default 25");
type Period = z.infer<typeof PeriodSchema>;
type Scope = z.infer<typeof ScopeSchema>;

/* ------------------------------------------------------------------ context */

interface Base { asOf: string; today: string; settings: Awaited<ReturnType<typeof getSettings>>; stores: Store[]; byCode: Map<string, Store>; byName: Map<string, Store>; refreshedAt: string | null }
export async function aiBase(): Promise<Base> {
  const [settings, fresh, sm] = await Promise.all([getSettings(), getFreshness(), getStoreMap()]);
  return { asOf: fresh.asOf, today: fresh.today, settings, refreshedAt: fresh.refreshedAt, ...sm };
}

const PRESET: Record<Period["preset"], Preset> = { today: "today", yesterday: "yesterday", this_week: "cw", last_week: "pw", l7: "l7", l30: "l30", mtd: "mtd", last_month: "pm", custom: "custom" };

function compareRange(r: Range, mode: z.infer<typeof CompareSchema>, auto: Range): Range | null {
  const n = rangeDays(r);
  switch (mode) {
    case "none": return null;
    case "previous_period": return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
    case "same_days_last_week": return { from: addDays(r.from, -7), to: addDays(r.to, -7) };
    case "previous_month_same_days": {
      const pm = addMonths(r.from, -1);
      const shift = diffDays(startOfMonth(r.from), r.from);
      return { from: addDays(pm, shift), to: minDate(addDays(pm, shift + n - 1), endOfMonth(pm)) };
    }
    case "previous_month_full": { const pm = addMonths(r.from, -1); return { from: pm, to: endOfMonth(pm) }; }
    default: return auto;
  }
}

function buildCtx(b: Base, period: Period, compare: z.infer<typeof CompareSchema>, cats: string[] | null, scope: Scope | null, ch: Filters["ch"] = "store"): Ctx & { compareNone: boolean } {
  const p = resolvePeriod(PRESET[period.preset], b.asOf, b.today, { from: period.from ?? undefined, to: period.to ?? undefined });
  const cmp = compareRange(p.range, compare, p.compare);
  const enabled = b.settings.enabledCategories;
  const filters: Filters = {
    preset: p.preset, cats: cats?.filter((c) => enabled.includes(c)).length ? cats.filter((c) => enabled.includes(c)) : enabled,
    stores: scope?.branch_codes ?? [], city: scope?.cities ?? [], state: scope?.states ?? [], region: scope?.regions ?? [], om: scope?.store_types ?? [],
    am: scope?.area_managers ?? [], sst: [], ct: [], lt: [], ch, pb: [],
  };
  return {
    sp: {}, qs: "", settings: b.settings, asOf: b.asOf, today: b.today, filters, stores: b.stores, byCode: b.byCode, byName: b.byName, user: null,
    period: { ...p, compare: cmp ?? { from: addDays(p.range.from, -1), to: addDays(p.range.from, -2) } },
    compareNone: !cmp,
  };
}

const periodInfo = (c: Ctx & { compareNone: boolean }) => ({
  from: c.period.range.from, to: c.period.range.to, days: rangeDays(c.period.range),
  complete: !c.period.partial, note: c.period.partial ? "Includes today — partial day" : c.period.range.to === c.asOf && ["cw", "mtd"].includes(c.period.preset) ? "Period to date (incomplete period)" : undefined,
});
const compareInfo = (c: Ctx & { compareNone: boolean }) =>
  c.compareNone ? null : { from: c.period.compare.from, to: c.period.compare.to, days: rangeDays(c.period.compare), label: c.period.compareLabel };

const scopeText = (s: Scope | null) => {
  if (!s) return null;
  const parts = Object.entries(s).filter(([, v]) => v?.length).map(([k, v]) => `${k}=${(v as string[]).join(",")}`);
  return parts.length ? parts.join("; ") : null;
};
const r0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);

export interface ToolEnvelope {
  tool: string;
  description: string;
  filters: Record<string, unknown>;
  period?: unknown;
  comparison?: unknown;
  as_of: string | null;
  source: string;
  columns?: { key: string; label: string; format: "text" | "inr" | "num" | "dec" | "pct" | "delta" | "date" | "datetime" }[];
  data?: Record<string, unknown>[];
  row_count?: number;
  summary?: Record<string, unknown>;
  notes?: string[];
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ tools */

interface ToolDef<S extends z.ZodTypeAny> { name: string; description: string; schema: S; run: (input: z.infer<S>, b: Base) => Promise<ToolEnvelope> }
const def = <S extends z.ZodTypeAny>(t: ToolDef<S>) => t;

const resolveProductTool = def({
  name: "resolve_product",
  description: "Resolve a product name, style, typo or SKU code (e.g. 'Stryker', 'chelsea boots', 'SH0173') to product families and SKU groups using the product masters. ALWAYS call before product-specific metrics. Returns confidence (high/medium/low/none) and whether the match is ambiguous; also returns MRP, colour and status for direct lookups.",
  schema: z.strictObject({ query: z.string(), category: CatKey.nullable() }),
  run: async (i) => {
    const r = await resolveProduct(i.query, i.category);
    const pm = await getProductMap();
    return {
      tool: "resolve_product", description: `Product resolution for "${i.query}"`, filters: { query: i.query, category: i.category }, as_of: null, source: "product_master",
      confidence: r.confidence, ambiguous: r.ambiguous, guidance: r.guidance, suggestions: r.suggestions,
      matches: r.matches.map((m) => ({ ...m, product_type: (() => { const p = pm.get(m.skus[0]?.sku); return p ? productType(p) : null; })() })),
    };
  },
});

const resolveLocationTool = def({
  name: "resolve_location",
  description: "Resolve a place or store mention (e.g. 'Bangalore', 'Indiranagar', 'South', 'HSR') to a city / state / region / area manager / specific store with branch codes. Handles aliases (Bangalore→Bengaluru, Gurgaon→Gurugram) and typos.",
  schema: z.strictObject({ query: z.string() }),
  run: async (i, b) => {
    const r = resolveLocation(i.query, b.stores.filter((s) => s.last_seen && s.last_seen >= addDays(b.asOf, -60)));
    return { tool: "resolve_location", description: `Location resolution for "${i.query}"`, filters: { query: i.query }, as_of: null, source: "store_dimension", confidence: r.confidence,
      matches: r.matches.map((m) => ({ kind: m.kind, value: m.value, store_count: m.stores.length, branch_codes: m.stores.map((s) => s.branch_code), stores: m.stores.slice(0, 15).map((s) => s.store) })) };
  },
});

const PERF_GROUPS = ["none", "category", "store", "city", "state", "region", "store_type", "area_manager", "date", "week", "month"] as const;
const getPerformance = def({
  name: "get_performance",
  description: "Store-level sales vs target from the DSR + target tables (net revenue, units, bills, target, achievement, gap, growth vs a comparison period, stores selling, productivity, month outlook). Use for category/store/region performance, rankings of stores, trends over dates/weeks/months, and target questions. NOT for SKU/product-level questions (use get_sku_performance).",
  schema: z.strictObject({
    period: PeriodSchema, compare: CompareSchema, categories: Categories, scope: ScopeSchema.nullable(),
    group_by: z.enum(PERF_GROUPS), sort_by: z.enum(["revenue", "units", "achievement", "gap", "growth", "target", "sales_per_store_day"]).nullable(),
    sort_dir: z.enum(["desc", "asc"]).nullable(), limit: Limit,
  }),
  run: async (i, b) => {
    const c = buildCtx(b, i.period, i.compare, i.categories, i.scope);
    const trend = ["date", "week", "month"].includes(i.group_by);
    const facts = await loadFacts(c, trend ? [] : []);
    const { range, compare } = c.period;
    const th = c.settings.thresholds;
    const keyOf = (f: (typeof facts)[number]): string => {
      const s = c.byCode.get(f.b);
      switch (i.group_by) {
        case "category": return f.c;
        case "store": return f.b;
        case "city": return s?.city ?? "Unknown";
        case "state": return s?.state ?? "Unknown";
        case "region": return s?.region ?? "Unknown";
        case "store_type": return s?.operating_model ?? "Unknown";
        case "area_manager": return s?.am ?? "Unknown";
        default: return "all";
      }
    };
    let rows: Record<string, unknown>[] = [];
    if (trend) {
      const buckets = i.group_by === "date" ? eachDay(range.from, range.to).map((d) => ({ key: d, r: { from: d, to: d } }))
        : i.group_by === "week" ? Array.from(new Set(eachDay(range.from, range.to).map(startOfWeek))).map((w) => ({ key: w, r: { from: maxDate(w, range.from), to: minDate(addDays(w, 6), range.to) } }))
        : Array.from(new Set(eachDay(range.from, range.to).map(startOfMonth))).map((m) => ({ key: m.slice(0, 7), r: { from: maxDate(m, range.from), to: minDate(endOfMonth(m), range.to) } }));
      // trend buckets need facts across the whole range (loadFacts covers range + compare + current month)
      rows = buckets.map(({ key, r }, idx) => {
        const m = summarize(facts, r);
        const prevBucket = idx > 0 ? summarize(facts, buckets[idx - 1].r) : null;
        return { key, from: r.from, to: r.to, days: rangeDays(r), complete: i.group_by === "date" || rangeDays(r) === (i.group_by === "week" ? 7 : rangeDays({ from: r.from.slice(0, 8) + "01", to: endOfMonth(r.from) })),
          revenue: r0(m.sales), units: m.qty, bills: m.bills, target: r0(m.target), achievement: r2(m.ach), stores_selling: m.storesSelling,
          sales_per_store_day: r0(m.salesPerStoreDay), asp: r0(m.asp), change_vs_prev_bucket: prevBucket ? r2(growth(m.sales / m.days, prevBucket.sales / prevBucket.days)) : null };
      });
    } else {
      for (const [key, fs] of groupFacts(facts, keyOf)) {
        const m = summarize(fs, range);
        const p = c.compareNone ? null : summarize(fs, compare);
        if (m.stores === 0 && !(p && p.sales)) continue;
        const s = i.group_by === "store" ? c.byCode.get(key) : undefined;
        const mo = monthOutlook(fs, c.asOf);
        rows.push({
          key, label: i.group_by === "category" ? catLabel(key) : i.group_by === "store" ? s?.short_name ?? `Branch ${key}` : key,
          ...(s ? { city: s.city, region: s.region, store_type: s.operating_model } : {}),
          revenue: r0(m.sales), units: m.qty, bills: m.bills, target: r0(m.target), achievement: r2(m.ach), gap: r0(m.gap), status: targetStatus(m.sales, m.target, th),
          prev_revenue: p ? r0(p.sales) : null, growth: p ? r2(growth(m.sales, p.sales)) : null,
          stores_active: m.stores, stores_selling: m.storesSelling, sales_per_store_day: r0(m.salesPerStoreDay), units_per_store_day: r2(m.unitsPerStoreDay),
          asp: r0(m.asp), atv: r0(m.atv), upt: r2(m.upt), discount_pct: r2(m.disc),
          mtd_achievement: r2(safeDiv(mo.mtdSales, mo.mtdTarget)), required_per_day: r0(mo.requiredRunRate),
        });
      }
      const sk = i.sort_by ?? "revenue";
      const field = sk === "sales_per_store_day" ? "sales_per_store_day" : sk;
      const dir = i.sort_dir === "asc" ? 1 : -1;
      rows.sort((x, y) => ((x[field] as number | null) ?? -Infinity) > ((y[field] as number | null) ?? -Infinity) ? dir : -dir);
    }
    const total = summarize(facts, range);
    const prev = c.compareNone ? null : summarize(facts, compare);
    const mo = monthOutlook(facts, c.asOf);
    const all = rows.length;
    const limit = trend ? 400 : i.limit ?? 25;
    // Pareto for store-level rankings
    let concentration: Record<string, unknown> | undefined;
    if (i.group_by === "store" && all > 5) {
      const rev = [...rows].map((r) => (r.revenue as number) ?? 0).sort((a, b) => b - a);
      const tot = rev.reduce((a, v) => a + v, 0) || 1;
      concentration = { top_10_share: r2(rev.slice(0, 10).reduce((a, v) => a + v, 0) / tot), top_20pct_stores_share: r2(rev.slice(0, Math.ceil(all * 0.2)).reduce((a, v) => a + v, 0) / tot), stores_below_50pct_achievement: rows.filter((r) => (r.achievement as number | null) != null && (r.achievement as number) < 0.5).length, zero_sale_stores: rows.filter((r) => !r.revenue).length };
    }
    return {
      tool: "get_performance", description: `Store-level performance${i.group_by !== "none" ? ` by ${i.group_by}` : ""}`,
      filters: { categories: c.filters.cats, scope: scopeText(i.scope), group_by: i.group_by, sort_by: i.sort_by },
      period: periodInfo(c), comparison: compareInfo(c), as_of: c.period.partial ? `${c.today} (partial)` : c.period.range.to, source: "store_daily + store_targets",
      summary: {
        revenue: r0(total.sales), units: total.qty, bills: total.bills, target: r0(total.target), achievement: r2(total.ach), gap: r0(total.gap),
        prev_revenue: prev ? r0(prev.sales) : null, growth: prev ? r2(growth(total.sales, prev.sales)) : null, prev_units: prev?.qty ?? null,
        stores_active: total.stores, stores_selling: total.storesSelling, prev_stores_selling: prev?.storesSelling ?? null,
        sales_per_store_day: r0(total.salesPerStoreDay), asp: r0(total.asp), atv: r0(total.atv), upt: r2(total.upt),
        month: { as_of: c.asOf, mtd_revenue: r0(mo.mtdSales), mtd_target: r0(mo.mtdTarget), month_target: r0(mo.monthTarget), projected: r0(mo.projected), projected_achievement: r2(mo.projectedAch), required_per_day: r0(mo.requiredRunRate), current_per_day: r0(mo.currentRunRate), remaining_days: mo.remainingDays },
        ...(concentration ? { concentration } : {}),
      },
      columns: trend
        ? [{ key: "key", label: i.group_by === "date" ? "Date" : i.group_by === "week" ? "Week of" : "Month", format: i.group_by === "month" ? "text" : "date" }, { key: "revenue", label: "Revenue", format: "inr" }, { key: "units", label: "Units", format: "num" }, { key: "target", label: "Target", format: "inr" }, { key: "achievement", label: "Ach %", format: "pct" }, { key: "stores_selling", label: "Stores selling", format: "num" }, { key: "change_vs_prev_bucket", label: "vs prev (per day)", format: "delta" }]
        : [{ key: "label", label: i.group_by === "none" ? "Scope" : i.group_by.replace("_", " "), format: "text" }, { key: "revenue", label: "Revenue", format: "inr" }, { key: "target", label: "Target", format: "inr" }, { key: "achievement", label: "Ach %", format: "pct" }, { key: "growth", label: "Growth", format: "delta" }, { key: "units", label: "Units", format: "num" }, { key: "stores_selling", label: "Stores selling", format: "num" }, { key: "sales_per_store_day", label: "Sales/store/day", format: "inr" }],
      data: rows.slice(0, limit), row_count: all,
      notes: [
        ...(c.period.partial ? ["Period includes today, which is still filling — do not compare it with complete days without saying so."] : []),
        ...(trend && rows.some((r) => !r.complete) ? ["Some buckets are incomplete (see `complete`/`days`); compare per-day rates, not totals."] : []),
      ],
    };
  },
});

const SKU_GROUPS = ["sku", "product_family", "store", "category", "date", "week"] as const;
const getSkuPerformance = def({
  name: "get_sku_performance",
  description: "SKU / product-level sales from order lines (gross): revenue, units, growth, stores selling, store penetration, ASP, L7 vs prior 7, L30, MTD, last sale date. Filter to specific SKUs (from resolve_product) and/or categories and store scope; group by sku, product_family, store, category, date or week. Use for 'top SKUs', 'how is <product> doing', product trends and store-by-product breakdowns.",
  schema: z.strictObject({
    period: PeriodSchema, compare: CompareSchema, categories: Categories, skus: z.array(z.string()).nullable().describe("SKU group codes from resolve_product"),
    scope: ScopeSchema.nullable(), channel: z.enum(["store", "website_app", "marketplace", "all"]), group_by: z.enum(SKU_GROUPS),
    sort_by: z.enum(["revenue", "units", "growth", "stores_selling", "l7", "l30", "days_since_last_sale"]).nullable(), sort_dir: z.enum(["desc", "asc"]).nullable(), limit: Limit,
  }),
  run: async (i, b) => {
    const ch: Filters["ch"] = i.channel === "website_app" ? "shopify" : i.channel;
    const c = buildCtx(b, i.period, i.compare, i.categories, i.scope, ch);
    const skuSet = i.skus?.length ? new Set(i.skus) : null;
    const { rows: raw, products, network } = await loadSkus(c);
    const facts = skuSet ? raw.filter((r) => skuSet.has(r.sku)) : raw;
    const notes: string[] = [];
    if (skuSet && !facts.length) notes.push("No sales in the last 90 days for these SKUs in this scope/channel.");
    let rows: Record<string, unknown>[];
    if (i.group_by === "date" || i.group_by === "week") {
      const skus = skuSet ? [...skuSet] : Array.from(new Set(facts.map((f) => f.sku)));
      const storeNames = c.filters.stores.length || scopeText(i.scope) ? Array.from(new Set(facts.filter((f) => f.type === "Store").map((f) => f.ch))) : null;
      const daily = skus.length ? await getSkuDailyMulti(skus, c.period.range, ch, storeNames) : [];
      const bucket = (d: string) => (i.group_by === "week" ? startOfWeek(d) : d);
      const m = new Map<string, { revenue: number; units: number; stores: number }>();
      for (const d of daily) { const k = bucket(d.date); const e = m.get(k) ?? { revenue: 0, units: 0, stores: 0 }; e.revenue += d.sales; e.units += d.qty; e.stores = Math.max(e.stores, d.stores); m.set(k, e); }
      const keys = Array.from(new Set(eachDay(c.period.range.from, c.period.range.to).map(bucket)));
      rows = keys.map((k) => ({ key: k, revenue: r0(m.get(k)?.revenue ?? 0), units: m.get(k)?.units ?? 0, max_daily_stores: m.get(k)?.stores ?? 0, days: i.group_by === "week" ? rangeDays({ from: maxDate(k, c.period.range.from), to: minDate(addDays(k, 6), c.period.range.to) }) : 1 }));
    } else {
      const key = (f: (typeof facts)[number]) => i.group_by === "store" ? f.ch : i.group_by === "category" ? f.c : i.group_by === "product_family" ? `${f.c}|${(products.get(f.sku)?.name ?? f.sku).toUpperCase()}` : f.sku;
      const g = new Map<string, typeof facts>();
      for (const f of facts) { const k = key(f); let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(f); }
      rows = [...g.entries()].map(([k, fs]) => {
        const sum = (sel: (x: (typeof fs)[number]) => number) => fs.reduce((a, x) => a + sel(x), 0);
        const rev = sum((x) => x.rs), prev = sum((x) => x.ps), units = sum((x) => x.rq);
        const stores = new Set(fs.filter((x) => x.rq > 0).map((x) => x.ch)).size;
        const last = fs.reduce<string | null>((m2, x) => (x.last && (!m2 || x.last > m2) ? x.last : m2), null);
        const p = products.get(fs[0].sku);
        const label = i.group_by === "store" ? fs[0].store : i.group_by === "category" ? catLabel(k) : i.group_by === "product_family" ? p?.name ?? fs[0].sku : p?.name ?? k;
        return {
          key: i.group_by === "product_family" ? label : k, label, ...(i.group_by === "sku" ? { sku: k, colour: p?.colour ?? null, mrp: p?.mrp ?? fs[0].price, category: catLabel(fs[0].c) } : {}),
          ...(i.group_by === "product_family" ? { skus: Array.from(new Set(fs.map((x) => x.sku))) } : {}),
          revenue: r0(rev), units, prev_revenue: c.compareNone ? null : r0(prev), growth: c.compareNone ? null : r2(growth(rev, prev)),
          ...(i.group_by === "store" ? {} : { stores_selling: stores, penetration: r2(safeDiv(stores, network)) }),
          asp: r0(safeDiv(rev, units)), l7: r0(sum((x) => x.l7s)), prior_7: r0(sum((x) => x.p7s)), l7_vs_prior7: r2(growth(sum((x) => x.l7s), sum((x) => x.p7s))),
          l30: r0(sum((x) => x.l30s)), l30_units: sum((x) => x.l30q), mtd: r0(sum((x) => x.mtds)), last_sale: last, days_since_last_sale: last ? diffDays(last, c.asOf) : null,
        };
      });
      const sk = i.sort_by === "stores_selling" ? "stores_selling" : i.sort_by ?? "revenue";
      const dir = i.sort_dir === "asc" ? 1 : -1;
      rows.sort((x, y) => (((x[sk] as number | null) ?? -Infinity) > ((y[sk] as number | null) ?? -Infinity) ? dir : -dir));
    }
    const rev = facts.reduce((a, f) => a + f.rs, 0), prev = facts.reduce((a, f) => a + f.ps, 0), units = facts.reduce((a, f) => a + f.rq, 0);
    const bySku = new Map<string, number>(); for (const f of facts) bySku.set(f.sku, (bySku.get(f.sku) ?? 0) + f.rs);
    const skuRev = [...bySku.values()].sort((a, b2) => b2 - a);
    const unitsBySku = new Map<string, number>(); for (const f of facts) unitsBySku.set(f.sku, (unitsBySku.get(f.sku) ?? 0) + f.rq);
    return {
      tool: "get_sku_performance", description: `SKU-level sales by ${i.group_by}`, filters: { categories: c.filters.cats, skus: i.skus, scope: scopeText(i.scope), channel: i.channel },
      period: periodInfo(c), comparison: compareInfo(c), as_of: c.period.range.to, source: "sku_sales (gross line value) + product_master",
      summary: {
        revenue: r0(rev), units, prev_revenue: c.compareNone ? null : r0(prev), growth: c.compareNone ? null : r2(growth(rev, prev)),
        selling_skus: [...unitsBySku.values()].filter((u) => u > 0).length, stores_selling: new Set(facts.filter((f) => f.rq > 0).map((f) => f.ch)).size, penetration_base_stores: network,
        top5_sku_share: r2(safeDiv(skuRev.slice(0, 5).reduce((a, v) => a + v, 0), rev)), skus_under_5_units: [...unitsBySku.values()].filter((u) => u > 0 && u < 5).length,
        rolling_windows_end: c.asOf,
      },
      columns: i.group_by === "date" || i.group_by === "week"
        ? [{ key: "key", label: i.group_by === "date" ? "Date" : "Week of", format: "date" }, { key: "revenue", label: "Revenue", format: "inr" }, { key: "units", label: "Units", format: "num" }]
        : [{ key: "label", label: i.group_by === "store" ? "Store" : "Product", format: "text" }, ...(i.group_by === "sku" ? [{ key: "sku", label: "SKU", format: "text" as const }] : []), { key: "revenue", label: "Revenue", format: "inr" }, { key: "units", label: "Units", format: "num" }, { key: "growth", label: "Growth", format: "delta" }, ...(i.group_by === "store" ? [] : [{ key: "stores_selling", label: "Stores", format: "num" as const }]), { key: "l7", label: "L7", format: "inr" }, { key: "l30", label: "L30", format: "inr" }, { key: "last_sale", label: "Last sale", format: "date" }],
      data: rows.slice(0, i.group_by === "date" || i.group_by === "week" ? 400 : i.limit ?? 25), row_count: rows.length, notes,
    };
  },
});

const getInventory = def({
  name: "get_current_inventory",
  description: "CURRENT inventory (latest snapshot only — never summed across dates). level=network: per-SKU online (warehouse) and offline (all stores combined) units, with each SKU's own snapshot timestamp. level=store: per-store units from the store-inventory feed, which covers only ~20 stores (coverage is returned — always disclose it). Use for 'how much inventory', 'where is X available', 'stores with stock', 'size split', stocked-but-not-selling analysis (include_sales_velocity).",
  schema: z.strictObject({
    skus: z.array(z.string()).nullable().describe("SKU group codes from resolve_product; null = whole categories"),
    categories: Categories, level: z.enum(["network", "store"]), scope: ScopeSchema.nullable(),
    group_by: z.enum(["sku", "store", "size", "category"]).nullable(), include_sales_velocity: z.boolean(), limit: Limit,
  }),
  run: async (i, b) => {
    const pm = await getProductMap();
    const cats = i.categories?.length ? i.categories : b.settings.enabledCategories;
    const skuList = i.skus?.length ? i.skus : [...pm.values()].filter((p) => p.category && cats.includes(p.category)).map((p) => p.sku);
    const skuSet = new Set(skuList);
    const notes: string[] = [];
    if (i.level === "network") {
      const inv = (await getNetworkInventory()).filter((r) => skuSet.has(r.sku));
      const rows = inv.map((r) => {
        const p = pm.get(r.sku);
        return { key: r.sku, sku: r.sku, label: p?.name ?? r.sku, category: catLabel(p?.category ?? ""), colour: p?.colour ?? null, offline_units: r.offline, online_units: r.online, total_units: r.offline + r.online, snapshot_ts: r.snapshot_ts,
          bible_offline_units: p?.inBible ? p.invOffline : null, bible_stores_stocked: p?.inBible ? p.storesStocked : null };
      }).sort((a, b2) => b2.total_units - a.total_units);
      const ts = rows.map((r) => r.snapshot_ts).sort();
      const stale = rows.filter((r) => r.snapshot_ts.slice(0, 10) < addDays(b.today, -2));
      if (stale.length) notes.push(`${stale.length} SKU(s) have an older latest snapshot (not updated in >2 days): ${stale.slice(0, 5).map((r) => `${r.sku} @ ${r.snapshot_ts.slice(0, 10)}`).join(", ")}. Their latest value is used, not summed.`);
      const missing = skuList.filter((s) => !inv.some((r) => r.sku === s));
      if (missing.length && i.skus?.length) notes.push(`No inventory snapshot for: ${missing.join(", ")}.`);
      const bibleDiff = rows.filter((r) => r.bible_offline_units != null && Math.abs((r.bible_offline_units ?? 0) - r.offline_units) > Math.max(20, 0.1 * r.offline_units));
      if (bibleDiff.length) notes.push(`SKU Bible reports different store inventory for ${bibleDiff.length} SKU(s) (e.g. ${bibleDiff[0].sku}: snapshot ${bibleDiff[0].offline_units} vs Bible ${bibleDiff[0].bible_offline_units}). Sources disagree — state which source you quote.`);
      notes.push("Network inventory does not give a store count; use level=store for store-level presence (limited coverage).");
      return {
        tool: "get_current_inventory", description: "Current network inventory (latest snapshot per SKU)", filters: { skus: i.skus, categories: cats, level: "network" },
        as_of: ts.at(-1) ?? null, snapshot_range: ts.length ? { oldest: ts[0], latest: ts.at(-1) } : null, source: "network_inventory (INVENTORY_DAILY_SNAPSHOT_LATEST, latest per SKU × cut-size)",
        summary: { skus: rows.length, offline_units: rows.reduce((a, r) => a + r.offline_units, 0), online_units: rows.reduce((a, r) => a + r.online_units, 0), total_units: rows.reduce((a, r) => a + r.total_units, 0) },
        columns: [{ key: "label", label: "Product", format: "text" }, { key: "sku", label: "SKU", format: "text" }, { key: "offline_units", label: "Stores (offline)", format: "num" }, { key: "online_units", label: "Warehouse (online)", format: "num" }, { key: "total_units", label: "Total", format: "num" }, { key: "snapshot_ts", label: "Snapshot", format: "datetime" }],
        data: rows.slice(0, i.limit ?? 50), row_count: rows.length, notes,
      };
    }
    // store level
    const [inv, coverage] = await Promise.all([getStoreInventory([...pm.keys()]), getStoreInventoryCoverage()]);
    const m = storeMatcher({ preset: "mtd", cats, stores: i.scope?.branch_codes ?? [], city: i.scope?.cities ?? [], state: i.scope?.states ?? [], region: i.scope?.regions ?? [], om: i.scope?.store_types ?? [], am: i.scope?.area_managers ?? [], sst: [], ct: [], lt: [], ch: "store", pb: [] }, b.byCode);
    const feed = coverage.filter((cv) => !m || m(String(cv.b)));
    const rowsRaw = inv.filter((r) => skuSet.has(r.sku) && (!m || m(r.b)));
    let velocity = new Map<string, { l7: number; l30: number }>();
    if (i.include_sales_velocity) {
      const c = buildCtx(b, { preset: "l30", from: null, to: null }, "none", cats, i.scope);
      const { rows: sf } = await loadSkus(c);
      velocity = new Map();
      for (const f of sf) {
        if (!skuSet.has(f.sku) || !f.b) continue;
        const k = i.group_by === "sku" ? f.sku : i.group_by === "size" ? "" : f.b;
        const e = velocity.get(k) ?? { l7: 0, l30: 0 }; e.l7 += f.l7q; e.l30 += f.l30q; velocity.set(k, e);
      }
    }
    const gb = i.group_by ?? "store";
    const g = new Map<string, typeof rowsRaw>();
    for (const r of rowsRaw) { const k = gb === "sku" ? r.sku : gb === "size" ? r.size : gb === "category" ? pm.get(r.sku)?.category ?? "?" : r.b; let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(r); }
    if (gb === "store") for (const cv of feed) if (!g.has(String(cv.b))) g.set(String(cv.b), []); // include zero-stock feed stores
    const rows = [...g.entries()].map(([k, rs]) => {
      const units = rs.reduce((a, r) => a + r.units, 0);
      const st = gb === "store" ? b.byCode.get(k) : undefined;
      const v = velocity.get(k);
      return {
        key: k, label: gb === "store" ? st?.short_name ?? feed.find((f) => String(f.b) === k)?.store ?? k : gb === "sku" ? pm.get(k)?.name ?? k : gb === "category" ? catLabel(k) : k,
        ...(gb === "store" ? { city: st?.city ?? null, snapshot_date: rs[0]?.saved_date ?? feed.find((f) => String(f.b) === k)?.saved_date ?? null } : {}),
        ...(gb === "sku" ? { sku: k } : {}),
        units, skus_in_stock: new Set(rs.filter((r) => r.units > 0).map((r) => r.sku)).size, sizes_in_stock: new Set(rs.filter((r) => r.units > 0).map((r) => `${r.sku}|${r.size}`)).size,
        ...(i.include_sales_velocity ? { units_sold_l7: v?.l7 ?? 0, units_sold_l30: v?.l30 ?? 0, weeks_of_cover: v && v.l30 > 0 ? r2(units / (v.l30 / 30) / 7) : null } : {}),
      };
    }).sort((a, b2) => b2.units - a.units);
    const withStock = rows.filter((r) => r.units > 0);
    const total = withStock.reduce((a, r) => a + r.units, 0);
    const storesWithStock = new Set(rowsRaw.filter((r) => r.units > 0).map((r) => r.b));
    const sortedStoreUnits = [...new Map(rowsRaw.reduce((mm, r) => mm.set(r.b, (mm.get(r.b) ?? 0) + r.units), new Map<string, number>())).values()].filter((u) => u > 0).sort((a, b2) => b2 - a);
    const topN = Math.max(1, Math.ceil(sortedStoreUnits.length * 0.25));
    const dates = Array.from(new Set(feed.map((f) => f.saved_date))).sort();
    notes.push(`Store-level inventory covers only ${feed.length} store(s) in the store-inventory feed (of ~${b.stores.filter((s) => s.last_seen && s.last_seen >= addDays(b.asOf, -30)).length} active stores). Store counts are for these stores only.`);
    if (dates.length > 1) notes.push(`Stores have different latest snapshot dates (${dates[0]} … ${dates.at(-1)}); each store's own latest snapshot is used.`);
    return {
      tool: "get_current_inventory", description: `Current store-level inventory by ${gb}`, filters: { skus: i.skus, categories: cats, scope: scopeText(i.scope), level: "store" },
      as_of: dates.at(-1) ?? null, snapshot_dates: dates, source: "store_inventory (SPEED_INVENTORY, latest SAVED_DATE per store; bins and sizes summed)",
      coverage: { feed_stores: feed.length, feed_store_names: feed.map((f) => f.store.replace(/^SNITCH\s*-\s*/i, "")) },
      summary: { total_units: total, stores_with_stock: storesWithStock.size, feed_stores_without_stock: feed.length - storesWithStock.size, avg_units_per_stocked_store: r2(safeDiv(total, storesWithStock.size)),
        top_25pct_stores_share: r2(safeDiv(sortedStoreUnits.slice(0, topN).reduce((a, v) => a + v, 0), total)), top_25pct_store_count: topN },
      columns: [{ key: "label", label: gb === "store" ? "Store" : gb === "sku" ? "Product" : gb, format: "text" }, { key: "units", label: "Units", format: "num" }, { key: "skus_in_stock", label: "SKUs in stock", format: "num" }, ...(i.include_sales_velocity ? [{ key: "units_sold_l7", label: "Sold L7", format: "num" as const }, { key: "units_sold_l30", label: "Sold L30", format: "num" as const }, { key: "weeks_of_cover", label: "Weeks of cover", format: "dec" as const }] : []), ...(gb === "store" ? [{ key: "snapshot_date", label: "Snapshot", format: "date" as const }] : [])],
      data: rows.slice(0, i.limit ?? 50), row_count: rows.length, notes,
    };
  },
});

const EXC = ["stores_zero_sale_yesterday", "stores_zero_sale_this_week", "stores_below_daily_target", "stores_below_weekly_target", "stores_major_wow_decline", "stores_low_category_productivity", "stores_high_required_run_rate", "stores_largest_mtd_gap", "skus_zero_sale", "skus_declining", "skus_strong_low_penetration", "skus_few_stores", "stocked_but_not_selling"] as const;
const FLAG: Partial<Record<(typeof EXC)[number], string>> = {
  stores_zero_sale_yesterday: "Zero sale yesterday", stores_zero_sale_this_week: "Zero sale this week", stores_below_daily_target: "Below daily target",
  stores_below_weekly_target: "Below weekly target", stores_major_wow_decline: "Major WoW decline", stores_low_category_productivity: "Low category productivity", stores_high_required_run_rate: "High required run rate",
};
const getExceptions = def({
  name: "get_exceptions",
  description: "Action-centre lists using the configured exception rules (as of the last complete day): stores with zero sale / below target / major WoW decline / low productivity / high required run rate / largest MTD gap; SKUs that are zero-sale, declining, strong-but-under-distributed or selling in few stores; stocked_but_not_selling = store × SKU with current stock (store-inventory feed stores only) but no sale in the last 7 days.",
  schema: z.strictObject({ type: z.enum(EXC), categories: Categories, scope: ScopeSchema.nullable(), limit: Limit }),
  run: async (i, b) => {
    const rules = b.settings.exceptions;
    const base = { tool: "get_exceptions", filters: { type: i.type, categories: i.categories, scope: scopeText(i.scope) }, as_of: b.asOf, notes: [] as string[] };
    if (i.type.startsWith("stores_")) {
      const c = buildCtx(b, { preset: "mtd", from: null, to: null }, "auto", i.categories, i.scope);
      const facts = await loadFacts(c, exceptionRanges(c.asOf));
      let sig = storeSignals(c, facts);
      sig = i.type === "stores_largest_mtd_gap" ? sig.filter((s) => (s.mGap ?? 0) > 0).sort((a, b2) => (b2.mGap ?? 0) - (a.mGap ?? 0)) : sig.filter((s) => s.flags.includes(FLAG[i.type]!)).sort((a, b2) => (b2.mGap ?? 0) - (a.mGap ?? 0));
      const rows = sig.map((s) => ({ key: `${s.b}|${s.c}`, branch_code: s.b, label: s.store, city: s.city, category: s.category, area_manager: s.am, yesterday_sales: r0(s.ySales), yesterday_achievement: r2(s.yAch), wtd_sales: r0(s.wSales), wtd_achievement: r2(s.wAch), wow: r2(s.wow), mtd_sales: r0(s.mSales), mtd_target: r0(s.mTarget), mtd_achievement: r2(s.mAch), mtd_gap: r0(s.mGap), required_vs_current: r2(s.rrrMultiple), vs_network_productivity: r2(s.relProductivity), last_sale: s.lastSale, all_flags: s.flagText }));
      return { ...base, description: `Stores: ${i.type}`, source: "store_daily + store_targets", rules: { at_risk_below: b.settings.thresholds.atRisk, wow_decline: rules.wowDecline, low_productivity: rules.lowPenetration, high_run_rate_multiple: rules.highRunRateMultiple },
        columns: [{ key: "label", label: "Store", format: "text" }, { key: "category", label: "Category", format: "text" }, { key: "mtd_sales", label: "MTD", format: "inr" }, { key: "mtd_achievement", label: "MTD ach", format: "pct" }, { key: "mtd_gap", label: "Gap", format: "inr" }, { key: "wow", label: "WoW", format: "delta" }, { key: "all_flags", label: "Flags", format: "text" }],
        data: rows.slice(0, i.limit ?? 25), row_count: rows.length, summary: { count: rows.length, total_mtd_gap: r0(rows.reduce((a, r) => a + (r.mtd_gap ?? 0), 0)) } };
    }
    if (i.type === "stocked_but_not_selling") {
      const pm = await getProductMap();
      const cats = i.categories?.length ? i.categories : b.settings.enabledCategories;
      const [inv, cov] = await Promise.all([getStoreInventory([...pm.keys()]), getStoreInventoryCoverage()]);
      const c = buildCtx(b, { preset: "l7", from: null, to: null }, "none", cats, i.scope);
      const { rows: sf } = await loadSkus(c);
      const sold = new Set(sf.filter((f) => f.l7q > 0 && f.b).map((f) => `${f.b}|${f.sku}`));
      const m = storeMatcher(c.filters, b.byCode);
      const agg = new Map<string, { b: string; sku: string; units: number }>();
      for (const r of inv) {
        const p = pm.get(r.sku);
        if (!p?.category || !cats.includes(p.category) || (m && !m(r.b)) || r.units <= 0) continue;
        const k = `${r.b}|${r.sku}`; const e = agg.get(k) ?? { b: r.b, sku: r.sku, units: 0 }; e.units += r.units; agg.set(k, e);
      }
      const rows = [...agg.entries()].filter(([k]) => !sold.has(k)).map(([, e]) => ({ key: `${e.b}|${e.sku}`, branch_code: e.b, label: b.byCode.get(e.b)?.short_name ?? e.b, sku: e.sku, product: pm.get(e.sku)?.name ?? e.sku, category: catLabel(pm.get(e.sku)?.category ?? ""), units_in_stock: e.units })).sort((a, b2) => b2.units_in_stock - a.units_in_stock);
      const byStore = new Map<string, number>(); for (const r of rows) byStore.set(r.label, (byStore.get(r.label) ?? 0) + r.units_in_stock);
      return { ...base, description: "Store × SKU with current stock but no sale in the last 7 days", source: "store_inventory + sku_sales", as_of: cov.map((x) => x.saved_date).sort().at(-1) ?? b.asOf,
        columns: [{ key: "label", label: "Store", format: "text" }, { key: "product", label: "Product", format: "text" }, { key: "sku", label: "SKU", format: "text" }, { key: "units_in_stock", label: "Units in stock", format: "num" }],
        data: rows.slice(0, i.limit ?? 40), row_count: rows.length, summary: { pairs: rows.length, stores_affected: byStore.size, units_idle: rows.reduce((a, r) => a + r.units_in_stock, 0), feed_stores: cov.length },
        notes: [`Only the ${cov.length} stores in the store-inventory feed can be checked.`] };
    }
    // SKU exceptions over rolling windows
    const c = buildCtx(b, { preset: "l30", from: null, to: null }, "previous_period", i.categories, i.scope);
    const { skus, products, network } = await loadSkus(c);
    const selling = skus.filter((s) => s.l30q > 0);
    const perStore = selling.map((s) => safeDiv(s.l30, s.storesL30) ?? 0).sort((a, b2) => a - b2);
    const q75 = perStore[Math.floor(perStore.length * 0.75)] ?? 0;
    const sold = new Set(selling.map((s) => s.sku));
    const pick = i.type === "skus_zero_sale"
      ? [...products.values()].filter((p) => p.category && c.filters.cats.includes(p.category) && !sold.has(p.sku) && (p.inBible ? p.lifecycle === "LIVE" && (p.invOffline ?? 0) > 0 : p.status === "ACTIVE" && skus.some((s) => s.sku === p.sku)))
          .map((p) => ({ key: p.sku, sku: p.sku, label: p.name ?? p.sku, category: catLabel(p.category!), store_inventory_bible: p.invOffline, last_sale: skus.find((s) => s.sku === p.sku)?.last ?? null }))
      : (i.type === "skus_declining" ? selling.filter((s) => s.p7 > 0 && (growth(s.l7, s.p7) ?? 0) <= rules.wowDecline)
        : i.type === "skus_strong_low_penetration" ? selling.filter((s) => (safeDiv(s.l30, s.storesL30) ?? 0) >= q75 && (safeDiv(s.storesL30, network) ?? 1) < rules.lowPenetration)
        : selling.filter((s) => s.storesL30 <= rules.fewStores))
          .map((s) => ({ key: s.sku, sku: s.sku, label: s.name ?? s.sku, category: catLabel(s.c), l7: r0(s.l7), prior_7: r0(s.p7), l7_vs_prior7: r2(growth(s.l7, s.p7)), l30: r0(s.l30), l30_units: s.l30q, stores_l30: s.storesL30, penetration: r2(safeDiv(s.storesL30, network)), l30_per_selling_store: r0(safeDiv(s.l30, s.storesL30)) }));
    return { ...base, description: `SKUs: ${i.type}`, source: "sku_sales + product_master", penetration_base_stores: network,
      columns: i.type === "skus_zero_sale" ? [{ key: "label", label: "Product", format: "text" }, { key: "sku", label: "SKU", format: "text" }, { key: "store_inventory_bible", label: "Store inv (Bible)", format: "num" }, { key: "last_sale", label: "Last sale", format: "date" }]
        : [{ key: "label", label: "Product", format: "text" }, { key: "sku", label: "SKU", format: "text" }, { key: "l7", label: "L7", format: "inr" }, { key: "l7_vs_prior7", label: "L7 vs P7", format: "delta" }, { key: "l30", label: "L30", format: "inr" }, { key: "stores_l30", label: "Stores", format: "num" }, { key: "penetration", label: "Penetration", format: "pct" }],
      data: pick.slice(0, i.limit ?? 25), row_count: pick.length, summary: { count: pick.length },
      notes: i.type === "skus_zero_sale" ? ["Perfumes use fresh Bible inventory; other categories: sold in last 90 days but not in last 30."] : [] };
  },
});

const explainChange = def({
  name: "explain_change",
  description: "Diagnose WHY revenue changed between two periods using only measurable drivers. Store level (no skus): decomposes the change into stores selling × bills per selling store × ATV (= UPT × ASP), plus category, region and biggest store contributors. Product level (skus given): stores selling × units per selling store × ASP, biggest store contributors, and current stock in the largest decliners where the store-inventory feed covers them. Returns which data is unavailable (e.g. footfall) so you never invent causes.",
  schema: z.strictObject({ period: PeriodSchema, compare: CompareSchema, categories: Categories, skus: z.array(z.string()).nullable(), scope: ScopeSchema.nullable() }),
  run: async (i, b) => {
    const c = buildCtx(b, i.period, i.compare === "none" ? "auto" : i.compare, i.categories, i.scope);
    const days = { cur: rangeDays(c.period.range), prev: rangeDays(c.period.compare) };
    const perDay = days.cur !== days.prev;
    const lr = (x: number | null | undefined, y: number | null | undefined) => (x && y && x > 0 && y > 0 ? Math.log(x / y) : null);
    const decompose = (parts: Record<string, [number | null, number | null]>, total: [number, number]) => {
      const tot = lr(total[0], total[1]);
      return Object.fromEntries(Object.entries(parts).map(([k, [a, p]]) => { const l = lr(a, p); return [k, { current: r2(a), previous: r2(p), change: r2(growth(a, p)), share_of_log_change: tot && l != null ? r2(l / tot) : null }]; }));
    };
    if (!i.skus?.length) {
      const facts = await loadFacts(c);
      const m = summarize(facts, c.period.range), p = summarize(facts, c.period.compare);
      const bills = (x: typeof m) => safeDiv(x.bills, x.storesSelling);
      const f = (x: typeof m, d: number) => (perDay ? x.sales / d : x.sales);
      const contrib = (key: (x: (typeof facts)[number]) => string, label: (k: string) => string) =>
        [...groupFacts(facts, key)].map(([k, fs]) => { const a = summarize(fs, c.period.range).sales, pp = summarize(fs, c.period.compare).sales; return { key: k, label: label(k), current: r0(a), previous: r0(pp), delta: r0(perDay ? a / days.cur - pp / days.prev : a - pp) }; }).sort((x, y) => (x.delta ?? 0) - (y.delta ?? 0));
      const stores = contrib((x) => x.b, (k) => b.byCode.get(k)?.short_name ?? k);
      return {
        tool: "explain_change", description: "Revenue change decomposition (store level)", filters: { categories: c.filters.cats, scope: scopeText(i.scope) }, period: periodInfo(c), comparison: compareInfo(c),
        as_of: c.period.range.to, source: "store_daily", basis: perDay ? "per-day rates (periods have different lengths)" : "period totals",
        summary: { revenue: r0(m.sales), prev_revenue: r0(p.sales), change: r2(growth(f(m, days.cur), f(p, days.prev))), target_achievement: r2(m.ach), prev_target_achievement: r2(p.ach) },
        drivers: decompose({ stores_selling: [m.storesSelling, p.storesSelling], bills_per_selling_store: [perDay ? safeDiv(bills(m), days.cur) : bills(m), perDay ? safeDiv(bills(p), days.prev) : bills(p)], atv: [m.atv, p.atv], upt: [m.upt, p.upt], asp: [m.asp, p.asp], discount_pct: [m.disc, p.disc] }, [f(m, days.cur), f(p, days.prev)]),
        by_category: contrib((x) => x.c, catLabel), by_region: contrib((x) => b.byCode.get(x.b)?.region ?? "Unknown", (k) => k),
        biggest_store_declines: stores.slice(0, 8), biggest_store_gains: stores.slice(-5).reverse(),
        unavailable: ["footfall/conversion (not loaded for long-tail categories)", "competitor or marketing activity", "store-level inventory outside the ~20-store feed"],
        notes: ["share_of_log_change: how much of the revenue change each multiplicative driver explains (stores × bills/store × ATV; ATV = UPT × ASP). Discount is informational."],
      };
    }
    const skuSet = new Set(i.skus);
    const { rows } = await loadSkus(c);
    const fs = rows.filter((r) => skuSet.has(r.sku));
    const agg = (sel: "cur" | "prev") => {
      const s = fs.reduce((a, r) => a + (sel === "cur" ? r.rs : r.ps), 0), q = fs.reduce((a, r) => a + (sel === "cur" ? r.rq : r.pq), 0);
      const st = new Set(fs.filter((r) => (sel === "cur" ? r.rq : r.pq) > 0).map((r) => r.ch)).size;
      return { s: perDay ? s / (sel === "cur" ? days.cur : days.prev) : s, q, st, ups: safeDiv(perDay ? q / (sel === "cur" ? days.cur : days.prev) : q, st), asp: safeDiv(s, q) };
    };
    const cur = agg("cur"), prev = agg("prev");
    const byStore = new Map<string, { label: string; b: string | null; cur: number; prev: number }>();
    for (const r of fs) { const e = byStore.get(r.ch) ?? { label: r.store, b: r.b, cur: 0, prev: 0 }; e.cur += r.rs; e.prev += r.ps; byStore.set(r.ch, e); }
    const storeDelta = [...byStore.values()].map((e) => ({ ...e, delta: r0(perDay ? e.cur / days.cur - e.prev / days.prev : e.cur - e.prev) })).sort((a, b2) => (a.delta ?? 0) - (b2.delta ?? 0));
    const pm = await getProductMap();
    const inv = await getStoreInventory([...pm.keys()]);
    const stockOf = (bc: string | null) => (bc ? inv.filter((x) => x.b === bc && skuSet.has(x.sku)).reduce((a, x) => a + x.units, 0) : null);
    const inFeed = new Set(inv.map((x) => x.b));
    return {
      tool: "explain_change", description: "Revenue change decomposition (product level)", filters: { skus: i.skus, scope: scopeText(i.scope) }, period: periodInfo(c), comparison: compareInfo(c), as_of: c.period.range.to,
      source: "sku_sales + store_inventory", basis: perDay ? "per-day rates" : "period totals",
      summary: { revenue: r0(cur.s), prev_revenue: r0(prev.s), change: r2(growth(cur.s, prev.s)), units: cur.q, prev_units: prev.q },
      drivers: decompose({ stores_selling: [cur.st, prev.st], units_per_selling_store: [cur.ups, prev.ups], asp: [cur.asp, prev.asp] }, [cur.s, prev.s]),
      stores_lost: storeDelta.filter((e) => e.prev > 0 && e.cur === 0).length, stores_gained: storeDelta.filter((e) => e.prev === 0 && e.cur > 0).length,
      biggest_store_declines: storeDelta.slice(0, 8).map((e) => ({ store: e.label, current: r0(e.cur), previous: r0(e.prev), delta: e.delta, current_stock_units: e.b && inFeed.has(e.b) ? stockOf(e.b) : "not in inventory feed" })),
      unavailable: ["footfall/conversion", "store-level inventory outside the ~20-store feed", "price/promo calendar (only realised ASP)"],
    };
  },
});

export const TOOLS = [resolveProductTool, resolveLocationTool, getPerformance, getSkuPerformance, getInventory, getExceptions, explainChange] as const;
export type ToolName = (typeof TOOLS)[number]["name"];
export const toolByName = new Map<string, ToolDef<z.ZodTypeAny>>(TOOLS.map((t) => [t.name, t as unknown as ToolDef<z.ZodTypeAny>]));

// Keywords strict tool schemas don't accept; zod still enforces them when the input is validated server-side.
const UNSUPPORTED = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern"]);
function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node).filter(([k]) => !UNSUPPORTED.has(k)).map(([k, v]) => [k, strip(v)]));
}
export function jsonSchema(s: z.ZodTypeAny) {
  return strip(z.toJSONSchema(s)) as Record<string, unknown>;
}
