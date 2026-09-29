import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { summarize, monthOutlook, storeRows } from "@/server/analytics";
import { trendByCategory, catColor, catLabel } from "@/server/views";
import { loadSkus } from "@/server/skus";
import { PageHeader, Kpi, KpiGrid, Section, StatusBadge, Delta } from "@/components/ui";
import { TrendChart } from "@/components/charts/TrendChart";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num, pct } from "@/lib/format";
import { addDays, diffDays, fmtRange } from "@/lib/dates";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";

export default async function StoreDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const { code } = await params;
  const ctx = await pageContext(searchParams);
  const store = ctx.byCode.get(decodeURIComponent(code));
  if (!store) notFound();
  // Scope everything to this store (keep category + date filters)
  const sctx = { ...ctx, filters: { ...ctx.filters, stores: [store.branch_code], region: [], state: [], city: [], om: [], sst: [], am: [], ct: [], lt: [] } };
  const trendRange = { from: addDays(ctx.asOf, -29), to: ctx.asOf };
  const netCtx = { ...ctx, filters: { ...ctx.filters, stores: [], region: [], state: [], city: [], om: [], sst: [], am: [], ct: [], lt: [] } };
  const [facts, netFacts, sku] = await Promise.all([loadFacts(sctx, [trendRange]), loadFacts(netCtx, [trendRange]), loadSkus({ ...sctx, filters: { ...sctx.filters, ch: "store" } })]);
  const { range, compare } = ctx.period;
  const th = ctx.settings.thresholds;
  const m = summarize(facts, range), p = summarize(facts, compare);
  const mo = monthOutlook(facts, ctx.asOf);
  const net = summarize(netFacts, range);
  const netPerStoreDay = net.salesPerStoreDay;
  const rank = storeRows(netFacts, range, compare, ctx.byCode, th, ctx.filters.cats).find((r) => r.branch_code === store.branch_code)?.rank;
  const trend = trendByCategory(facts, trendRange, ctx.filters.cats);

  const catRows = ctx.filters.cats.map((c) => {
    const fs = facts.filter((f) => f.c === c);
    const cm = summarize(fs, range), cp = summarize(fs, compare), co = monthOutlook(fs, ctx.asOf);
    const nm = summarize(netFacts.filter((f) => f.c === c), range);
    return { c, cm, cp, co, share: safeDiv(cm.sales, m.sales), vsNet: safeDiv(safeDiv(cm.sales, cm.days), nm.salesPerStoreDay) };
  });

  const skuRows = sku.rows.map((r) => ({
    sku: r.sku, name: sku.products.get(r.sku)?.name ?? null, image: sku.products.get(r.sku)?.image ?? null, category: catLabel(r.c),
    qty: r.rq, sales: r.rs, asp: safeDiv(r.rs, r.rq), last: r.last, daysSince: r.last ? diffDays(r.last, ctx.asOf) : null,
    l7: r.l7s, l7q: r.l7q, l30: r.l30s, l30q: r.l30q, mtd: r.mtds, mtdq: r.mtdq, prev: r.ps, growth: growth(r.rs, r.ps),
  }));
  const skuCols: Col[] = [
    { key: "image", label: "", type: "image" },
    { key: "sku", label: "SKU", type: "code" },
    { key: "name", label: "Product", width: 180 },
    { key: "category", label: "Category" },
    { key: "qty", label: "Units", type: "num", group: "Selected period" },
    { key: "sales", label: "Revenue", type: "inr", bar: true, group: "Selected period" },
    { key: "asp", label: "ASP", type: "inrFull", group: "Selected period" },
    { key: "growth", label: "vs prev", type: "delta", group: "Selected period" },
    { key: "l7", label: "L7 sales", type: "inr", group: "Windows (to as-of date)" },
    { key: "l7q", label: "L7 units", type: "num", group: "Windows (to as-of date)" },
    { key: "l30", label: "L30 sales", type: "inr", group: "Windows (to as-of date)" },
    { key: "l30q", label: "L30 units", type: "num", group: "Windows (to as-of date)" },
    { key: "mtd", label: "MTD sales", type: "inr", group: "Windows (to as-of date)" },
    { key: "last", label: "Last sale", type: "date" },
    { key: "daysSince", label: "Days since", type: "num", tip: "Days since last sale (90-day lookback)" },
  ];

  const meta = [store.city, store.state, store.region, store.operating_model, store.location_type, store.store_status].filter(Boolean).join(" · ");
  return (
    <>
      <Link href={withQs(ctx, "/stores")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-zinc-500 hover:text-zinc-900"><ChevronLeft className="size-3.5" />All stores</Link>
      <PageHeader title={store.short_name} subtitle={<>{meta} · Branch {store.branch_code} · AM {store.am ?? "—"} · RM {store.rm ?? "—"}{store.partner && store.partner !== "COCO" ? ` · Partner ${store.partner}` : ""}</>}
        right={<div className="text-right text-[12px] text-zinc-500">{fmtRange(range)}<br />{rank ? `Rank #${rank} of network by revenue` : ""}</div>} />
      <KpiGrid>
        <Kpi label="Revenue" value={inr(m.sales)} delta={growth(m.sales, p.sales)} deltaLabel={ctx.period.compareLabel} />
        <Kpi label="Target" value={inr(m.target)} status={<StatusBadge status={targetStatus(m.sales, m.target, th)} ach={m.ach} />} />
        <Kpi label="Gap" value={m.gap == null ? "—" : m.gap > 0 ? inr(m.gap) : `+${inr(-m.gap)}`} sub={m.gap != null && m.gap <= 0 ? "above target" : "to go"} />
        <Kpi label="Units" value={num(m.qty)} sub={`${num(m.bills)} bills · UPT ${num(m.upt, 2)}`} />
        <Kpi label="Avg daily sales" value={inr(safeDiv(m.sales, m.days))} sub={<>network avg {inr(netPerStoreDay)} · <Delta v={growth(safeDiv(m.sales, m.days), netPerStoreDay)} /></>} />
        <Kpi label="Month outlook" value={pct(safeDiv(mo.mtdSales, mo.mtdTarget), 0)} sub={`MTD ach · projected ${inr(mo.projected)} · need ${inr(mo.requiredRunRate)}/day`} />
      </KpiGrid>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Section title="Daily sales — last 30 days">
          <TrendChart data={trend} height={250} series={[...ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), stack: "s" })), { key: "target", label: "Target", color: "#18181b", type: "line" as const, dashed: true }]} />
        </Section>
        <Section title="Category split" pad={false}>
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead><tr className="border-b border-zinc-200 text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2 text-left">Category</th><th className="px-2 text-right">Sales</th><th className="px-2 text-right">Mix</th><th className="px-2 text-right">Units</th><th className="px-2 text-right">Target</th><th className="px-2 text-right">Growth</th><th className="px-4 text-right" title="Store's sales/day ÷ network average per store/day">vs network</th>
            </tr></thead>
            <tbody>{catRows.map((r) => (
              <tr key={r.c} className="border-b border-zinc-100">
                <td className="px-4 py-2"><span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: catColor(r.c) }} />{catLabel(r.c)}<div className="mt-0.5"><StatusBadge status={targetStatus(r.cm.sales, r.cm.target, th)} ach={r.cm.ach} /></div></td>
                <td className="tabular px-2 text-right font-medium">{inr(r.cm.sales)}</td>
                <td className="tabular px-2 text-right">{pct(r.share, 0)}</td>
                <td className="tabular px-2 text-right">{num(r.cm.qty)}</td>
                <td className="tabular px-2 text-right">{inr(r.cm.target)}</td>
                <td className="px-2 text-right"><Delta v={growth(r.cm.sales, r.cp.sales)} /></td>
                <td className="tabular px-4 text-right">{r.vsNet == null ? "—" : `${(r.vsNet * 100).toFixed(0)}%`}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="px-4 py-2 text-[11.5px] text-zinc-500">“vs network” = this store’s sales per day ÷ average store’s sales per day (100% = average).</p>
        </Section>
      </div>
      <div className="mt-4">
        <DataTable title="SKU performance in this store" rows={skuRows} columns={skuCols} defaultSort={{ key: "sales" }} rowHref="/products/skus/{sku}" csvName={`store-${store.branch_code}-skus`} height={560}
          emptyText="No SKU sales for this store in the lookback window." />
        <p className="mt-2 text-[11.5px] text-zinc-500">SKU revenue is gross line value from HORIZONTAL_SALES_CATEGORIES and can differ slightly from DSR net sales above. Store-level inventory is not available in the source tables.</p>
      </div>
    </>
  );
}
