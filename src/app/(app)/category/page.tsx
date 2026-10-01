import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadScope, lastNDays } from "@/server/scope";
import { channelMetrics, channelBreakdown, channelSeries, CH_LABEL, type ChKey } from "@/server/channelData";
import { buildActions, actionStatuses } from "@/server/actions";
import { computePlan, type PlanChannel } from "@/server/plan";
import { getTargetBook } from "@/server/data/targetBook";
import { summarize } from "@/server/analytics";
import { getStoreInventory, getStoreInventoryHistory } from "@/server/data/inventory";
import { getWarehouseHistory } from "@/server/data/warehouse";
import { productRows, rollup, DEF, type ProductRow } from "@/server/productInsights";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Tabs, Kpi, KpiGrid, Section, Meter, Delta, ProductCell, Pill, achTone, DataPrompt, Tip } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { DataTable, type Col } from "@/components/table/DataTable";
import { TrendChart } from "@/components/charts/TrendChart";
import { compactNum, inr, num, pct } from "@/lib/format";
import { addDays, eachDay, fmtDate, fmtRange, rangeDays, startOfMonth } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { CH_COLORS } from "@/lib/colors";
import { cn } from "@/lib/cn";

export const metadata = { title: "Category Performance" };

const CHS: ChKey[] = ["stores", "online", "marketplace"];
const TH = "px-3 py-2 font-medium";

export default async function CategoryPerformance({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const tab = ctx.sp.tab === "products" ? "products" : "summary";
  const { range, compare } = ctx.period;
  const trendRange = rangeDays(range) >= 14 ? range : lastNDays(range.to > ctx.asOf ? ctx.asOf : range.to, 30);
  const sc = await loadScope(ctx, [trendRange]);
  const tabs = [
    { key: "summary", label: "Summary", href: withQs(ctx, "/category", { tab: null }) },
    { key: "products", label: "Product performance", href: withQs(ctx, "/category", { tab: "products" }) },
    { key: "master", label: "Product Master ↗", href: withQs(ctx, "/products", { tab: null }) },
  ];
  const multiCat = ctx.filters.cats.length > 1;
  const title = ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories";
  const chName = ctx.filters.channel === "all" ? "all channels" : CH_LABEL[ctx.filters.channel] + (ctx.filters.mp ? ` · ${ctx.filters.mp}` : "");
  const rows = await productRows(ctx, sc);

  if (tab === "products") {
    const facets = [...(multiCat ? [{ key: "catName", label: "Category" }] : []), { key: "l1", label: "Type" }, { key: "l2", label: "Sub-type" }, { key: "colour", label: "Colour" }];
    const pl = ctx.period.preset === "custom" ? "Period" : ctx.period.preset.toUpperCase();
    const cols: Col[] = [
      { key: "name", label: "Product", image: "image", imageSize: 44, sub: "sku", width: 280 },
      { key: "catName", label: "Category", hidden: !multiCat }, { key: "l1", label: "Type" }, { key: "l2", label: "Sub-type", hidden: true }, { key: "colour", label: "Colour" },
      { key: "revenue", label: "Revenue", type: "inr", bar: true, group: pl, tip: `${fmtRange(range)}, ${chName}` }, { key: "growth", label: "Growth", type: "delta", group: pl, tip: ctx.period.compareLabel },
      { key: "units", label: "Units", type: "num", group: pl },
      { key: "l7", label: "Sales", type: "inr", group: "Last 7 days", tip: DEF.l7 }, { key: "wow", label: "vs LW", type: "delta", group: "Last 7 days", tip: DEF.wow }, { key: "l7Units", label: "Units", type: "num", group: "Last 7 days" },
      { key: "l30", label: "Sales", type: "inr", group: "Last 30 days", tip: DEF.l30 }, { key: "mom", label: "vs LM", type: "delta", group: "Last 30 days", tip: DEF.mom }, { key: "l30Units", label: "Units", type: "num", group: "Last 30 days" },
      { key: "str30", label: "STR", type: "pct", group: "Last 30 days", tip: DEF.str30 },
      { key: "ltSales", label: "Sales", type: "inr", group: "Lifetime", tip: "Lifetime sales, all channels (Product Master)" }, { key: "ltUnits", label: "Units", type: "num", group: "Lifetime" },
      { key: "inward", label: "Inward qty", type: "num", group: "Lifetime", tip: DEF.inward }, { key: "ltStr", label: "STR", type: "pct", group: "Lifetime", tip: DEF.ltStr },
      { key: "returnPct", label: "Return %", type: "pct", group: "Lifetime", tip: DEF.ret },
      { key: "storeInv", label: "Stores", type: "num", group: "Inventory", tip: DEF.storeInv }, { key: "whInv", label: "Warehouse", type: "num", group: "Inventory", tip: DEF.wh },
      { key: "whNorth", label: "WH North", type: "num", group: "Inventory", hidden: true }, { key: "whSouth", label: "WH South", type: "num", group: "Inventory", hidden: true },
      { key: "totalInv", label: "Total", type: "num", group: "Inventory" }, { key: "doi", label: "Cover (days)", type: "num", group: "Inventory", tip: DEF.doi },
      { key: "storesSelling", label: "Stores selling", type: "num", tip: "Stores with a sale in the last 30 days" },
      { key: "flag", label: "Flag", tip: "Free gift = recent ASP under ₹10 (kept out of rankings); Low cover = ≥10 units L30 and under 21 days of cover; Slow = ≥30 units and over 180 days of cover" },
    ];
    const t = rollup(rows);
    const noType = rows.filter((r) => !r.l1), noColour = rows.filter((r) => !r.colour);
    const gaps = [noType.length > rows.length * 0.1 ? `${num(noType.length)} without type` : null, noColour.length > rows.length * 0.1 ? `${num(noColour.length)} without colour` : null].filter((x): x is string => !!x);
    const missCats = [...new Set([...noType, ...noColour].map((r) => r.catName))].sort().slice(0, 4);
    const totals = { name: `Total · ${num(rows.length)}`, revenue: t.revenue, growth: growth(t.revenue, t.prev), units: t.units, l7: t.l7, wow: growth(t.l7, t.p7), l30: t.l30, mom: growth(t.l30, t.p30), str30: t.str30,
      ltSales: t.ltSales, ltStr: t.ltStr, returnPct: t.returnPct, storeInv: t.storeInv, whInv: t.whInv, whNorth: t.whNorth, whSouth: t.whSouth, totalInv: t.totalInv, doi: t.doi };
    return (
      <>
        <PageHeader title="Category Performance" subtitle={<>{title} · product performance · {chName} · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel} · L7 / L30 to {fmtDate(ctx.asOf, true)}</span></>} />
        <Tabs active={tab} tabs={tabs} />
        {gaps.length > 0 && <div className="mb-3"><DataPrompt compact title={`Metafields missing: ${gaps.join(" · ")}`} href={ctx.user?.role === "admin" ? "/settings?tab=attributes" : undefined} cta="Add attributes">
          Type / colour filters and metafield search (e.g. “black shoes”) skip these products{missCats.length ? ` — mostly ${missCats.join(", ")}` : ""}.{ctx.user?.role !== "admin" && " Ask an admin to upload attributes in the Control Centre."}
        </DataPrompt></div>}
        <DataTable rows={rows as unknown as Record<string, unknown>[]} columns={cols} defaultSort={{ key: "revenue" }} rowHref="/products/{sku}" csvName="product-performance" height={720} dense={false}
          searchText="search" facets={facets} urlState searchPlaceholder='Search e.g. "black shoes", "chelsea", SKU' totals={totals} />
        <p className="mt-2 text-[11px] text-zinc-500">Search matches every word against name, SKU, type, sub-type, colour, collection, metafields and category. STR and cover use all-channel demand because stock is shared. Stores = store sales lines (gross); Online / Marketplace = Unicommerce items incl. cancellations.</p>
      </>
    );
  }

  // ─────────────── Summary ───────────────
  const ch = ctx.filters.channel as PlanChannel, mp = ctx.filters.mp;
  const histFrom = addDays(ctx.asOf, -59);
  const [act, statuses, book, storeInv, storeHist, whHist] = await Promise.all([
    buildActions(ctx), actionStatuses(), getTargetBook(startOfMonth(ctx.asOf)),
    getStoreInventory([...sc.pm.keys()]).catch(() => []),
    getStoreInventoryHistory(histFrom, ctx.asOf).catch(() => []), getWarehouseHistory(histFrom, ctx.asOf).catch(() => []),
  ]);
  const th = ctx.settings.thresholds;
  const m = channelMetrics(sc.facts, sc.uc, range, ch, mp), p = channelMetrics(sc.facts, sc.uc, compare, ch, mp);
  const plan = computePlan(sc.facts, sc.uc, ctx.asOf, ch, book, ctx.filters.cats, th);
  const st = summarize(sc.facts, range);
  const channels = channelBreakdown(sc.facts, sc.uc, range, compare);
  const all = rollup(rows);

  // groups: categories (Overall) or product types (one category)
  const skuGroup = new Map<string, string>();
  const groups = (multiCat
    ? ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), rows: rows.filter((r) => r.category === c) }))
    : [...new Set(rows.map((r) => r.l1 ?? "Untyped"))].map((k) => ({ key: k, label: k, color: catColor(ctx.filters.cats[0]), rows: rows.filter((r) => (r.l1 ?? "Untyped") === k) })))
    .map((g) => {
      for (const r of g.rows) skuGroup.set(r.sku, g.key);
      const agg = rollup(g.rows);
      let chRev = agg.chRev, rev = agg.revenue, prev = agg.prev, plan: ReturnType<typeof computePlan> | null = null;
      if (multiCat) {
        const f = sc.facts.filter((x) => x.c === g.key), u = sc.uc.filter((x) => x.c === g.key);
        chRev = CHS.map((k) => (ch === "all" || ch === k ? channelMetrics(f, u, range, k, mp).revenue : 0)) as [number, number, number];
        rev = channelMetrics(f, u, range, ch, mp).revenue; prev = channelMetrics(f, u, compare, ch, mp).revenue;
        plan = computePlan(f, u, ctx.asOf, ch, book, [g.key], th);
      }
      return { ...g, agg, chRev, rev, prev, plan };
    })
    .filter((g) => g.rows.length > 0 || g.rev > 0)
    .sort((a, b) => (multiCat ? 0 : b.rev - a.rev || b.agg.totalInv - a.agg.totalInv));
  const totRev = groups.reduce((a, g) => a + g.rev, 0);
  const stocked = new Map<string, Set<string>>();
  for (const r of storeInv) {
    if (r.units <= 0) continue;
    const g = skuGroup.get(r.sku); if (!g) continue;
    (stocked.get(g) ?? stocked.set(g, new Set()).get(g)!).add(r.b);
  }
  const allStocked = new Set(storeInv.filter((r) => r.units > 0 && skuGroup.has(r.sku)).map((r) => r.b));

  // trends
  const cats = new Set(ctx.filters.cats);
  const trend = multiCat
    ? eachDay(trendRange.from, trendRange.to).map((d) => {
      const o: Record<string, unknown> = { date: d };
      for (const c of ctx.filters.cats) o[c] = channelMetrics(sc.facts.filter((x) => x.c === c), sc.uc.filter((x) => x.c === c), { from: d, to: d }, ch, mp).revenue;
      return o;
    })
    : channelSeries(sc.facts, sc.uc, trendRange, mp).map((x) => ({ date: x.date, stores: ch === "all" || ch === "stores" ? x.stores : 0, online: ch === "all" || ch === "online" ? x.online : 0, marketplace: ch === "all" || ch === "marketplace" ? x.marketplace : 0 }));
  const sDay = new Map<string, number>(), nDay = new Map<string, number>(), soDay = new Map<string, number>();
  for (const r of storeHist) if (r.cat && cats.has(r.cat)) sDay.set(r.d, (sDay.get(r.d) ?? 0) + r.units);
  for (const r of whHist) if (cats.has(r.cat)) (r.zone === "North" ? nDay : soDay).set(r.d, ((r.zone === "North" ? nDay : soDay).get(r.d) ?? 0) + r.units);
  const invTrend = eachDay(histFrom, ctx.asOf).map((d) => ({ date: d, store: sDay.get(d) ?? null, south: soDay.has(d) || nDay.has(d) ? soDay.get(d) ?? 0 : null, north: soDay.has(d) || nDay.has(d) ? nDay.get(d) ?? 0 : null }));
  const firstWith = (k: "store" | "south" | "north") => invTrend.find((x) => x[k] != null)?.[k] ?? null;
  const lastWith = (k: "store" | "south" | "north") => [...invTrend].reverse().find((x) => x[k] != null)?.[k] ?? null;
  const invDelta = (k: "store" | "south" | "north") => growth(lastWith(k), firstWith(k));

  const top = rows.filter((r) => r.revenue > 0 && !r.gift).slice(0, 10);
  let cum = 0;
  const risksList = act.actions.filter((a) => (a.group === "sku" && ["fast_low_doi", "declining"].includes(a.type)) || a.type === "return_risk").slice(0, 4);
  const lowCover = rows.filter((r) => !r.gift && r.doi != null && r.doi < 21 && r.allL30Units >= 10).sort((a, b) => b.l30 - a.l30).slice(0, 6);
  const overstock = rows.filter((r) => !r.gift && r.totalInv >= 30 && (r.doi == null || r.doi > 180) && (r.daysLive ?? 999) >= 45).sort((a, b) => b.totalInv - a.totalInv).slice(0, 6);
  const gl = multiCat ? "Category" : "Product type";
  const hasT = plan.monthTarget != null;
  const noType = !multiCat && groups.some((g) => g.key === "Untyped");

  return (
    <>
      <PageHeader title="Category Performance" subtitle={<>{title} · {chName} · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel}</span></>} />
      <Tabs active={tab} tabs={tabs} />
      <KpiGrid cols={8}>
        <Kpi label="Revenue" value={inr(m.revenue)} delta={growth(m.revenue, p.revenue)} deltaLabel="vs comparable" />
        <Kpi label="Units" value={num(m.units)} delta={growth(m.units, p.units)} sub={m.asp ? `ASP ${inr(m.asp, { compact: false })}` : undefined} />
        <Kpi label="Achievement · MTD" value={hasT ? pct(plan.achievement, 0) : "Not set"} tone={hasT ? achTone(plan.achievement, th) : undefined} sub={hasT ? `of ${inr(plan.mtdTarget)} MTD target` : "no target for this selection"} tip="MTD revenue of slices with a target ÷ their phased MTD target" />
        <Kpi label="Active stores" value={num(st.storesSelling)} sub={`of ${num(st.stores)}`} tip="Stores with a sale in the period (Stores channel)" />
        <Kpi label="Products selling" value={num(all.selling)} sub={`of ${num(sc.products.length)} in master`} tip="Products with ≥1 unit sold in the period" />
        <Kpi label="Store stock" value={compactNum(all.storeInv)} sub={`${num(allStocked.size)} stores stocked`} tip={DEF.storeInv} />
        <Kpi label="Warehouse stock" value={compactNum(all.whInv)} sub={`S ${compactNum(all.whSouth)} · N ${compactNum(all.whNorth)}`} tip={DEF.wh} />
        <Kpi label="Days of cover" value={all.doi != null ? num(all.doi) : "—"} sub={`STR L30 ${pct(all.str30, 0)}`} tone={all.doi == null ? undefined : all.doi < 30 ? "bad" : all.doi > 180 ? "warn" : "good"} tip={`${DEF.doi}. ${DEF.str30}`} />
      </KpiGrid>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title={multiCat ? "Revenue trend by category" : "Revenue trend by channel"} tip={`Daily revenue, ${chName}`}>
          <TrendChart data={trend} height={230} series={multiCat ? ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), stack: "s" })) : CHS.map((k) => ({ key: k, label: CH_LABEL[k], color: CH_COLORS[k], stack: "s" }))} />
        </Section>
        <Section title="Channel contribution" tip="Share of revenue in the period and growth vs the comparison period (all channels)">
          <div className="space-y-2.5">{channels.map((c) => (
            <div key={c.key} className="grid grid-cols-[92px_1fr_64px_40px_56px] items-center gap-2 text-[12px]"><span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: CH_COLORS[c.key] }} />{c.label}</span><Meter value={c.share} color={CH_COLORS[c.key]} /><span className="tabular text-right text-zinc-600">{inr(c.revenue)}</span><span className="tabular text-right font-medium">{pct(c.share, 0)}</span><Delta v={c.growth} className="text-right" /></div>
          ))}</div>
          {multiCat && <div className="mt-4 space-y-2">
            <div className="text-[11px] font-medium text-zinc-500">By category</div>
            {groups.map((g) => {
              const t = g.chRev.reduce((a, x) => a + x, 0);
              return (
                <div key={g.key} className="grid grid-cols-[92px_1fr_56px] items-center gap-2 text-[11.5px]">
                  <Link href={withQs(ctx, "/category", { cat: g.key })} className="truncate hover:underline">{g.label}</Link>
                  <span className="flex h-3.5 overflow-hidden rounded bg-brand-50">{t > 0 && g.chRev.map((x, i) => x > 0 && <span key={i} title={`${CH_LABEL[CHS[i]]} ${inr(x)} · ${pct(x / t, 0)}`} style={{ width: `${(x / t) * 100}%`, background: CH_COLORS[CHS[i]] }} />)}</span>
                  <span className="tabular text-right text-zinc-500">{inr(t)}</span>
                </div>
              );
            })}
          </div>}
        </Section>
      </div>

      <div className="mt-3">
        <Section title={`${gl} scorecard`} pad={false} tip={multiCat ? "Revenue and channel split: DSR (Stores) + Unicommerce, same as the Executive Summary. Product metrics from product sales lines. Target / achievement are month-to-date." : "By product type (metafield L1). Revenue from product sales lines (Stores gross) + Unicommerce — may differ slightly from the DSR total."}>
          {noType && <div className="px-4 pb-2"><DataPrompt compact title="Some products have no product type" href={ctx.user?.role === "admin" ? "/settings?tab=attributes" : undefined} cta="Add types">They are grouped as “Untyped”. Add L1 / L2 metafields to break the category down properly.</DataPrompt></div>}
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-zinc-400"><th /><th colSpan={4} className="border-b border-line px-3 pt-2 text-center font-medium">{ctx.period.preset.toUpperCase()} · {chName}</th><th colSpan={3} className="border-b border-line px-3 pt-2 text-center font-medium">Channel share</th>{multiCat && <th colSpan={2} className="border-b border-line px-3 pt-2 text-center font-medium">Target · MTD</th>}<th colSpan={4} className="border-b border-line px-3 pt-2 text-center font-medium">Products</th><th colSpan={3} className="border-b border-line px-3 pt-2 text-center font-medium">Health</th></tr>
                <tr className="border-b border-line text-[11px] text-zinc-500">
                  {[gl, "Revenue", "Growth", "Share", "ASP", "Stores", "Online", "Mktplace", ...(multiCat ? ["Target", "Ach."] : []), "Selling", "Top 10 share", "80% of rev", "L30 vs P30", "Return %", "STR L30", "Cover"].map((h, i) => <th key={h} className={cn(TH, i ? "text-right" : "text-left")}>{h}</th>)}
                </tr>
              </thead>
              <tbody>{groups.map((g) => {
                const t = g.chRev.reduce((a, x) => a + x, 0);
                return (
                  <tr key={g.key} className="border-b border-brand-50 last:border-0 hover:bg-brand-50/40">
                    <td className="px-3 py-2">{multiCat ? <Link href={withQs(ctx, "/category", { cat: g.key })} className="flex items-center gap-2 font-medium hover:underline"><span className="size-2 rounded-full" style={{ background: g.color }} />{g.label}</Link>
                      : <Link href={withQs(ctx, "/category", { tab: "products", l1: g.key === "Untyped" ? null : g.key })} className="font-medium hover:underline">{g.label}</Link>}</td>
                    <td className="tabular px-3 text-right font-semibold">{inr(g.rev)}</td><td className="px-3 text-right"><Delta v={growth(g.rev, g.prev)} /></td>
                    <td className="tabular px-3 text-right">{pct(safeDiv(g.rev, totRev), 0)}</td><td className="tabular px-3 text-right">{inr(safeDiv(g.agg.revenue, g.agg.units), { compact: false })}</td>
                    {g.chRev.map((x, i) => <td key={i} className="tabular px-3 text-right text-zinc-600">{t > 0 ? pct(x / t, 0) : "—"}</td>)}
                    {multiCat && (g.plan?.monthTarget != null ? <><td className="tabular px-3 text-right">{inr(g.plan.mtdTarget)}</td><td className="px-3 text-right"><Pill tone={achTone(g.plan.achievement, th)}>{pct(g.plan.achievement, 0)}</Pill></td></> : <td colSpan={2} className="px-3 text-right text-[11.5px] text-zinc-400">not set</td>)}
                    <td className="tabular px-3 text-right">{num(g.agg.selling)} <span className="text-zinc-400">/ {num(g.agg.products)}</span></td>
                    <td className="tabular px-3 text-right">{pct(g.agg.top10, 0)}</td>
                    <td className="tabular px-3 text-right" title="Fewest products that make 80% of the period revenue">{num(g.agg.n80)} <span className="text-zinc-400">SKUs</span></td>
                    <td className="px-3 text-right"><Delta v={growth(g.agg.l30, g.agg.p30)} /></td>
                    <td className="tabular px-3 text-right">{pct(g.agg.returnPct, 1)}</td><td className="tabular px-3 text-right">{pct(g.agg.str30, 0)}</td>
                    <td className="px-3 text-right">{g.agg.doi != null ? <Pill tone={g.agg.doi < 21 ? "bad" : g.agg.doi > 180 ? "warn" : "good"}>{num(g.agg.doi)} d</Pill> : "—"}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr className="border-t border-line bg-zinc-50 font-semibold">
                <td className="px-3 py-2">Total</td><td className="tabular px-3 text-right">{inr(totRev)}</td><td className="px-3 text-right"><Delta v={growth(totRev, groups.reduce((a, g) => a + g.prev, 0))} /></td><td className="tabular px-3 text-right">100%</td>
                <td className="tabular px-3 text-right">{inr(safeDiv(all.revenue, all.units), { compact: false })}</td>
                {CHS.map((k, i) => { const t = groups.reduce((a, g) => a + g.chRev.reduce((x, y) => x + y, 0), 0); return <td key={k} className="tabular px-3 text-right">{t ? pct(groups.reduce((a, g) => a + g.chRev[i], 0) / t, 0) : "—"}</td>; })}
                {multiCat && (hasT ? <><td className="tabular px-3 text-right">{inr(plan.mtdTarget)}</td><td className="px-3 text-right"><Pill tone={achTone(plan.achievement, th)}>{pct(plan.achievement, 0)}</Pill></td></> : <td colSpan={2} className="px-3 text-right text-[11.5px] font-normal text-zinc-400">not set</td>)}
                <td className="tabular px-3 text-right">{num(all.selling)} <span className="font-normal text-zinc-400">/ {num(all.products)}</span></td><td className="tabular px-3 text-right">{pct(all.top10, 0)}</td><td className="tabular px-3 text-right">{num(all.n80)}</td>
                <td className="px-3 text-right"><Delta v={growth(all.l30, all.p30)} /></td><td className="tabular px-3 text-right">{pct(all.returnPct, 1)}</td><td className="tabular px-3 text-right">{pct(all.str30, 0)}</td><td className="tabular px-3 text-right">{all.doi != null ? `${num(all.doi)} d` : "—"}</td>
              </tr></tfoot>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-zinc-500">
            <span>Top 10 share = revenue of the 10 best products ÷ group revenue</span><span>80% of rev = fewest products making 80% of revenue</span><span>Return %: lifetime, value-based</span><span>STR / cover: {DEF.str30.split("=")[1]?.trim()}</span>
          </div>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Section title="Product contribution" tip={`Top products by revenue in the period (${chName}); share of total and cumulative share`} right={<Link href={withQs(ctx, "/category", { tab: "products" })} className="text-[11.5px] text-zinc-500 hover:text-ink">All products →</Link>}>
          <div className="mb-2 text-[12px] text-zinc-500">Top 10 = <b className="font-semibold text-zinc-800">{pct(all.top10, 0)}</b> of revenue · <b className="font-semibold text-zinc-800">{num(all.n80)}</b> products make 80% · {num(all.selling)} selling{all.gifts ? <span className="text-zinc-400"> · {num(all.gifts)} free gifts excluded</span> : null}</div>
          {top.length ? <ul className="space-y-1.5">{top.map((r) => {
            cum += r.revenue;
            return (
              <li key={r.sku} className="grid grid-cols-[1fr_90px_78px_44px] items-center gap-3">
                <ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(ctx, `/products/${encodeURIComponent(r.sku)}`, { tab: null })} sub={multiCat ? r.catName : r.l1 ?? undefined} />
                <Meter value={safeDiv(r.revenue, top[0]?.revenue)} />
                <span className="tabular text-right text-[12px]"><b className="font-semibold">{inr(r.revenue)}</b><Delta v={r.growth} className="block text-[11px]" /></span>
                <span className="tabular text-right text-[11px] text-zinc-500" title="Share of total · cumulative">{pct(safeDiv(r.revenue, all.revenue), 0)}<span className="block text-zinc-400">{pct(safeDiv(cum, all.revenue), 0)}</span></span>
              </li>
            );
          })}</ul> : <div className="py-6 text-center text-[12.5px] text-zinc-500">No product sales in this period.</div>}
        </Section>
        <Section title="Product risks">
          <div className="space-y-2">{risksList.length ? risksList.map((a) => <ActionCard key={a.key} a={a} compact qs={ctx.qs} status={statuses.get(a.key)} />) : <div className="py-4 text-center text-[12.5px] text-zinc-500">No material product risks.</div>}</div>
        </Section>
      </div>

      <div className="mt-3">
        <Section title={`Inventory position by ${gl.toLowerCase()}`} pad={false} tip={`${DEF.storeInv}. ${DEF.wh}. ${DEF.doi}.`}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-zinc-400"><th /><th colSpan={3} className="border-b border-line px-3 pt-2 text-center font-medium">Stores</th><th colSpan={5} className="border-b border-line px-3 pt-2 text-center font-medium">Warehouse · South (WH1 + WH2) / North (Tauru)</th><th colSpan={5} className="border-b border-line px-3 pt-2 text-center font-medium">Total</th></tr>
                <tr className="border-b border-line text-[11px] text-zinc-500">
                  {[gl, "Units", "Stores stocked", "Share", "SAPL-WH1", "SAPL-WH2", "South", "North", "WH total", "Units", "L30 sold", "STR L30", "Cover", "Risk"].map((h, i) => <th key={h + i} className={cn(TH, i ? "text-right" : "text-left")}>{h}</th>)}
                </tr>
              </thead>
              <tbody>{groups.map((g) => {
                const a = g.agg;
                return (
                  <tr key={g.key} className="border-b border-brand-50 last:border-0 hover:bg-brand-50/40">
                    <td className="px-3 py-2 font-medium"><span className="flex items-center gap-2">{multiCat && <span className="size-2 rounded-full" style={{ background: g.color }} />}{g.label}</span></td>
                    <td className="tabular px-3 text-right">{num(a.storeInv)}</td><td className="tabular px-3 text-right">{num(stocked.get(g.key)?.size ?? 0)}</td>
                    <td className="tabular px-3 text-right text-zinc-500" title="Store units ÷ total units">{pct(safeDiv(a.storeInv, a.totalInv), 0)}</td>
                    <td className="tabular px-3 text-right text-zinc-600">{num(a.wh1)}</td><td className="tabular px-3 text-right text-zinc-600">{num(a.wh2)}</td>
                    <td className="tabular px-3 text-right">{num(a.whSouth)}</td><td className="tabular px-3 text-right">{num(a.whNorth)}</td><td className="tabular px-3 text-right font-medium">{num(a.whInv)}</td>
                    <td className="tabular px-3 text-right font-semibold">{num(a.totalInv)}</td><td className="tabular px-3 text-right">{num(a.l30Units)}</td><td className="tabular px-3 text-right">{pct(a.str30, 0)}</td>
                    <td className="px-3 text-right">{a.doi != null ? <Pill tone={a.doi < 21 ? "bad" : a.doi > 180 ? "warn" : "good"}>{num(a.doi)} d</Pill> : "—"}</td>
                    <td className="px-3 text-right text-[11.5px]">{a.lowCover > 0 && <span className="text-rose-600">{a.lowCover} low</span>}{a.lowCover > 0 && a.slow > 0 && " · "}{a.slow > 0 && <span className="text-amber-700" title={`${num(a.slowUnits)} units in products with >180 days of cover`}>{a.slow} slow</span>}{!a.lowCover && !a.slow && <span className="text-zinc-400">—</span>}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr className="border-t border-line bg-zinc-50 font-semibold">
                <td className="px-3 py-2">Total</td><td className="tabular px-3 text-right">{num(all.storeInv)}</td><td className="tabular px-3 text-right">{num(allStocked.size)}</td><td className="tabular px-3 text-right">{pct(safeDiv(all.storeInv, all.totalInv), 0)}</td>
                <td className="tabular px-3 text-right">{num(all.wh1)}</td><td className="tabular px-3 text-right">{num(all.wh2)}</td><td className="tabular px-3 text-right">{num(all.whSouth)}</td><td className="tabular px-3 text-right">{num(all.whNorth)}</td><td className="tabular px-3 text-right">{num(all.whInv)}</td>
                <td className="tabular px-3 text-right">{num(all.totalInv)}</td><td className="tabular px-3 text-right">{num(all.l30Units)}</td><td className="tabular px-3 text-right">{pct(all.str30, 0)}</td><td className="tabular px-3 text-right">{all.doi != null ? `${num(all.doi)} d` : "—"}</td>
                <td className="tabular px-3 text-right text-[11.5px] font-normal">{all.lowCover} low · {all.slow} slow</td>
              </tr></tfoot>
            </table>
          </div>
          <div className="px-4 py-2 text-[11px] text-zinc-500">Low = products selling ≥10 units in L30 with under 21 days of cover. Slow = ≥30 units in stock and over 180 days of cover (or no L30 sales). Warehouse as of {sc.inventory.asOf ? sc.inventory.asOf.slice(0, 16) : "—"}.</div>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Inventory trend · last 60 days" tip="Daily snapshots — store report (all stores) and warehouse history (SNITCH_FINAL_INVENTORY_WH2), never summed across days. Gaps = no snapshot that day.">
          {invTrend.some((x) => x.store != null || x.south != null) ? <>
            <div className="mb-2 flex flex-wrap gap-4 text-[11.5px] text-zinc-500">
              {([["store", "Stores"], ["south", "WH South"], ["north", "WH North"]] as const).map(([k, l]) => <span key={k}>{l} <b className="tabular font-semibold text-zinc-800">{compactNum(lastWith(k))}</b> <Delta v={invDelta(k)} className="text-[11px]" /> <span className="text-zinc-400">in 60d</span></span>)}
            </div>
            <TrendChart data={invTrend} height={220} yFormat="num" series={[{ key: "store", label: "Stores", color: CH_COLORS.stores, type: "line" }, { key: "south", label: "WH South", color: "#c08f60", type: "line" }, { key: "north", label: "WH North", color: "#2e6f73", type: "line", dashed: true }]} />
          </> : <DataPrompt title="No inventory history in the last 60 days">The store report and warehouse history tables returned no snapshots for this scope.</DataPrompt>}
        </Section>
        <Section title="Warehouse split" tip={DEF.wh}>
          {all.whInv > 0 ? <div className="space-y-3">
            {([["South", all.whSouth, [["SAPL-WH1", all.wh1], ["SAPL-WH2", all.wh2]]], ["North", all.whNorth, [["SAPL-NORTH-TAURU", all.whNorth]]]] as const).map(([z, v, facs]) => (
              <div key={z}>
                <div className="mb-1 flex items-baseline justify-between text-[12px]"><span className="font-medium">{z}</span><span className="tabular"><b className="font-semibold">{num(v)}</b> <span className="text-zinc-400">{pct(safeDiv(v, all.whInv), 0)}</span></span></div>
                {facs.map(([f, u]) => <div key={f} className="grid grid-cols-[128px_1fr_56px] items-center gap-2 text-[11.5px] text-zinc-600"><span>{f}</span><Meter value={safeDiv(u, all.whInv)} color={z === "North" ? "#d97706" : "#c08f60"} /><span className="tabular text-right">{num(u)}</span></div>)}
              </div>
            ))}
            <div className="border-t border-zinc-100 pt-2">
              <div className="mb-1.5 text-[11px] font-medium text-zinc-500">North share by {gl.toLowerCase()}</div>
              <div className="space-y-1">{groups.filter((g) => g.agg.whInv > 0).slice(0, 8).map((g) => (
                <div key={g.key} className="grid grid-cols-[100px_1fr_40px] items-center gap-2 text-[11.5px]"><span className="truncate">{g.label}</span>
                  <span className="flex h-2.5 overflow-hidden rounded bg-zinc-100"><span style={{ width: `${(g.agg.whSouth / g.agg.whInv) * 100}%`, background: "#c08f60" }} /><span style={{ width: `${(g.agg.whNorth / g.agg.whInv) * 100}%`, background: "#2e6f73" }} /></span>
                  <span className="tabular text-right text-zinc-500">{pct(g.agg.whNorth / g.agg.whInv, 0)}</span></div>
              ))}</div>
            </div>
          </div> : <div className="py-6 text-center text-[12.5px] text-zinc-500">No warehouse stock for this scope.</div>}
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Section title="Low cover · top sellers" tip="Selling ≥10 units in 30 days (all channels) with under 21 days of total cover">
          <InvList rows={lowCover} ctx={ctx} empty="No top seller is short of stock." kind="low" />
        </Section>
        <Section title="Overstock · slow movers" tip="≥30 units in stock, live ≥45 days, and over 180 days of cover or no L30 sales">
          <InvList rows={overstock} ctx={ctx} empty="No slow products with meaningful stock." kind="slow" />
        </Section>
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-500"><Tip text="Stores = DSR (gross sales) for Perfumes / Shoes and store sales lines for other categories; Online / Marketplace = Unicommerce items incl. cancellations. Product-level metrics use store sales lines (gross)." /> Data to {fmtDate(ctx.asOf, true)}.</p>
    </>
  );
}

function InvList({ rows, ctx, empty, kind }: { rows: ProductRow[]; ctx: Parameters<typeof withQs>[0]; empty: string; kind: "low" | "slow" }) {
  if (!rows.length) return <div className="py-6 text-center text-[12.5px] text-zinc-500">{empty}</div>;
  return (
    <table className="w-full text-[12px]">
      <thead><tr className="text-[11px] text-zinc-500"><th className="pb-1.5 text-left font-medium">Product</th><th className="text-right font-medium">L30 units</th><th className="text-right font-medium">Stores</th><th className="text-right font-medium">WH (S · N)</th><th className="text-right font-medium">Cover</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.sku} className="border-t border-zinc-100">
          <td className="max-w-[260px] py-1.5 pr-2"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(ctx, `/products/${encodeURIComponent(r.sku)}`, { tab: null })} /></td>
          <td className="tabular text-right">{num(r.allL30Units)}</td><td className="tabular text-right">{num(r.storeInv)}</td>
          <td className="tabular text-right">{num(r.whInv)} <span className="text-zinc-400">({num(r.whSouth)} · {num(r.whNorth)})</span></td>
          <td className="text-right"><Pill tone={kind === "low" ? (r.doi! < 10 ? "bad" : "warn") : "warn"}>{r.doi != null ? `${num(r.doi)} d` : "no sales"}</Pill></td>
        </tr>
      ))}</tbody>
    </table>
  );
}
