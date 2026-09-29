import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadScope, productPerformance, lastNDays } from "@/server/scope";
import { channelMetrics, channelBreakdown } from "@/server/channelData";
import { buildActions, actionStatuses } from "@/server/actions";
import { computePlan } from "@/server/plan";
import { getChannelTargets } from "@/server/data/channelTargets";
import { summarize } from "@/server/analytics";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Tabs, Kpi, KpiGrid, Section, Meter, Delta, ProductCell } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { DataTable, type Col } from "@/components/table/DataTable";
import { TrendChart } from "@/components/charts/TrendChart";
import { compactNum, inr, num, pct } from "@/lib/format";
import { eachDay, fmtRange, rangeDays, startOfMonth } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { CH_COLORS } from "@/lib/colors";

export const metadata = { title: "Category Overview" };

export default async function CategoryOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const tab = ctx.sp.tab === "products" ? "products" : ctx.sp.tab === "master" ? "master" : "summary";
  const { range, compare } = ctx.period;
  const trendRange = rangeDays(range) >= 14 ? range : lastNDays(range.to > ctx.asOf ? ctx.asOf : range.to, 30);
  const sc = await loadScope(ctx, [trendRange]);
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const tabs = [
    { key: "summary", label: "Summary", href: withQs(ctx, "/category", { tab: null }) },
    { key: "products", label: "Product performance", href: withQs(ctx, "/category", { tab: "products" }) },
    { key: "master", label: "Product Master", href: withQs(ctx, "/category", { tab: "master" }) },
  ];
  const title = ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories";

  if (tab === "master") {
    const rows = sc.products.filter((p) => (p.sales.all ?? 0) > 0 || (p.invOffline ?? 0) > 0 || whUnits(p.sku) > 0).map((p) => {
      const tot = (p.sales.stores ?? 0) + (p.sales.online ?? 0) + (p.sales.marketplace ?? 0);
      return { sku: p.sku, name: p.name ?? p.sku, image: p.image, category: catLabel(p.category ?? ""), mrp: p.mrp, sales: p.sales.all, inwards: p.inwardTotal, units: p.qty.all,
        asp: safeDiv(p.sales.all, p.qty.all), returnPct: p.returnPct.all, split: tot > 0 ? [(p.sales.stores ?? 0) / tot, (p.sales.online ?? 0) / tot, (p.sales.marketplace ?? 0) / tot] : null,
        storeInv: p.invOffline, whInv: whUnits(p.sku), stores: p.storesStocked, status: p.lifecycle ?? p.status };
    });
    const cols: Col[] = [
      { key: "name", label: "Product", image: "image", sub: "sku", width: 260 }, { key: "category", label: "Category" },
      { key: "sales", label: "Overall sales", type: "inr", bar: true, tip: "Lifetime, all channels" }, { key: "split", label: "Channel split", type: "split", tip: "Lifetime share: Stores · Online · Marketplace" },
      { key: "inwards", label: "Inwards", type: "num" }, { key: "units", label: "Units", type: "num" }, { key: "asp", label: "ASP", type: "inrFull" },
      { key: "returnPct", label: "Return %", type: "pct", tip: "Lifetime returned ₹ ÷ sold ₹" }, { key: "stores", label: "Stores stocked", type: "num" },
      { key: "storeInv", label: "Store inv", type: "num" }, { key: "whInv", label: "Warehouse", type: "num" }, { key: "mrp", label: "MRP", type: "inrFull", hidden: true }, { key: "status", label: "Status", hidden: true },
    ];
    return (
      <>
        <PageHeader title="Category Overview" subtitle={<>{title} · Product Master — lifetime performance and current inventory</>} />
        <Tabs active={tab} tabs={tabs} />
        <DataTable rows={rows} columns={cols} defaultSort={{ key: "sales" }} rowHref="/products/{sku}" csvName="product-master" height={720} dense={false} searchKeys={["name", "sku", "category"]} />
      </>
    );
  }

  const perf = await productPerformance(ctx, sc.pm, whUnits);
  if (tab === "products") {
    const rows = perf.rows.filter((r) => r.units > 0 || r.prev > 0 || (r.storeInv ?? 0) + r.whInv > 0).map((r) => ({
      sku: r.sku, name: r.name, image: r.image, category: catLabel(r.category ?? ""), revenue: r.revenue, units: r.units, growth: r.growth, returnPct: r.returnPct,
      storesSelling: r.storesSelling, salesPerStore: r.salesPerStore, storeInv: r.storeInv, whInv: r.whInv, doi: r.doi }));
    const cols: Col[] = [
      { key: "name", label: "Product", image: "image", sub: "sku", width: 260 }, { key: "category", label: "Category" },
      { key: "revenue", label: "Revenue", type: "inr", bar: true }, { key: "units", label: "Units", type: "num" }, { key: "growth", label: "Growth", type: "delta" },
      { key: "returnPct", label: "Return %", type: "pct", tip: "Lifetime, selected channel" }, { key: "storesSelling", label: "Stores selling", type: "num" }, { key: "salesPerStore", label: "Sales / store", type: "inr" },
      { key: "storeInv", label: "Store inv", type: "num" }, { key: "whInv", label: "Warehouse", type: "num" }, { key: "doi", label: "Days of inventory", type: "num", tip: "(store + warehouse) ÷ L30 daily units" },
    ];
    return (
      <>
        <PageHeader title="Category Overview" subtitle={<>{title} · product performance · {fmtRange(range)} · {ctx.period.compareLabel}</>} />
        <Tabs active={tab} tabs={tabs} />
        <DataTable rows={rows} columns={cols} defaultSort={{ key: "revenue" }} rowHref="/products/{sku}" csvName="product-performance" height={720} dense={false} searchKeys={["name", "sku", "category"]} />
      </>
    );
  }

  const ch = ctx.filters.channel;
  const [act, statuses, chTargets] = await Promise.all([buildActions(ctx), actionStatuses(), getChannelTargets(startOfMonth(ctx.asOf))]);
  const m = channelMetrics(sc.facts, sc.uc, range, ch, ctx.filters.mp), p = channelMetrics(sc.facts, sc.uc, compare, ch, ctx.filters.mp);
  const plan = computePlan(sc.facts, sc.uc, ctx.asOf, ch === "all" ? "all" : ch, chTargets, ctx.filters.cats, ctx.settings.thresholds);
  const st = summarize(sc.facts, range);
  const channels = channelBreakdown(sc.facts, sc.uc, range, compare);
  const trend = eachDay(trendRange.from, trendRange.to).map((d) => {
    const o: Record<string, unknown> = { date: d };
    for (const c of ctx.filters.cats) o[c] = channelMetrics(sc.facts.filter((x) => x.c === c), sc.uc.filter((x) => x.c === c), { from: d, to: d }, ch, ctx.filters.mp).revenue;
    return o;
  });
  const top = perf.rows.slice(0, 8);
  const tot = perf.rows.reduce((a, r) => a + r.revenue, 0);
  const risksList = act.actions.filter((a) => a.group === "sku" && ["fast_low_doi", "declining"].includes(a.type) || a.type === "return_risk").slice(0, 4);
  const invRows = perf.rows.filter((r) => (r.storeInv ?? 0) + r.whInv > 0).slice(0, 12);
  return (
    <>
      <PageHeader title="Category Overview" subtitle={<>{title} · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel}</span></>} />
      <Tabs active={tab} tabs={tabs} />
      <KpiGrid cols={5}>
        <Kpi label="Revenue" value={inr(m.revenue)} delta={growth(m.revenue, p.revenue)} deltaLabel="vs comparable" />
        <Kpi label="Units" value={num(m.units)} delta={growth(m.units, p.units)} />
        <Kpi label={`Target${plan.missing.length && plan.covered.length ? " · " + plan.covered.join(" + ") : ""}`} value={plan.monthTarget != null ? inr(plan.mtdTarget) : "Not configured"} sub={plan.achievement != null ? <><b className="font-semibold text-zinc-800">{pct(plan.achievement, 0)}</b> achieved MTD</> : undefined} />
        <Kpi label="Active stores" value={num(st.storesSelling)} sub={`of ${num(st.stores)}`} />
        <Kpi label="Active products" value={num(perf.activeSkus)} sub={`${compactNum(sc.inventory.store)} store · ${compactNum(sc.inventory.warehouse)} WH units`} />
      </KpiGrid>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Category trend" tip="Daily revenue by category for the selected channel">
          <TrendChart data={trend} height={230} series={ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), stack: "s" }))} />
        </Section>
        <Section title="Channel contribution">
          <div className="space-y-2">{channels.map((c) => (
            <div key={c.key} className="grid grid-cols-[92px_1fr_40px_56px] items-center gap-2 text-[12px]"><span>{c.label}</span><Meter value={c.share} color={CH_COLORS[c.key]} /><span className="tabular text-right font-medium">{pct(c.share, 0)}</span><Delta v={c.growth} className="text-right" /></div>
          ))}</div>
        </Section>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Section title="Product contribution" right={<Link href={withQs(ctx, "/category", { tab: "products" })} className="text-[11.5px] text-zinc-500 hover:text-ink">All products →</Link>}>
          <div className="mb-2 text-[12px] text-zinc-500">Top 8 products = <b className="font-semibold text-zinc-800">{pct(safeDiv(top.reduce((a, r) => a + r.revenue, 0), tot), 0)}</b> of revenue</div>
          <ul className="space-y-1.5">{top.map((r) => (
            <li key={r.sku} className="grid grid-cols-[1fr_110px_70px] items-center gap-3"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(ctx, `/products/${encodeURIComponent(r.sku)}`)} /><Meter value={safeDiv(r.revenue, top[0]?.revenue)} /><span className="tabular text-right text-[12px]"><b className="font-semibold">{inr(r.revenue)}</b><Delta v={r.growth} className="block text-[11px]" /></span></li>
          ))}</ul>
        </Section>
        <Section title="Product risks">
          <div className="space-y-2">{risksList.length ? risksList.map((a) => <ActionCard key={a.key} a={a} compact qs={ctx.qs} status={statuses.get(a.key)} />) : <div className="py-4 text-center text-[12.5px] text-zinc-500">No material product risks.</div>}</div>
        </Section>
      </div>
      <div className="mt-3">
        <Section title="Inventory position" tip="Latest store (all stores) + warehouse (live) inventory for the top-selling products" pad={false}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Product", "Revenue", "L30 units", "Store inv", "Warehouse", "Total", "Days of inventory"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody>{invRows.map((r) => (
                <tr key={r.sku} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-1.5"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(ctx, `/products/${encodeURIComponent(r.sku)}`)} /></td>
                  <td className="tabular px-4 text-right">{inr(r.revenue)}</td><td className="tabular px-4 text-right">{num(r.l30Units)}</td>
                  <td className="tabular px-4 text-right">{num(r.storeInv)}</td><td className="tabular px-4 text-right">{num(r.whInv)}</td><td className="tabular px-4 text-right font-medium">{num((r.storeInv ?? 0) + r.whInv)}</td>
                  <td className={`tabular px-4 text-right ${r.doi != null && r.doi < 14 ? "font-semibold text-rose-600" : r.doi != null && r.doi > 180 ? "text-amber-700" : ""}`}>{r.doi != null ? num(r.doi) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
