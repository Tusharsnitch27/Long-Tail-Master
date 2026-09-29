import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadSkus } from "@/server/skus";
import { getSkuDaily } from "@/server/data/sku";
import { productType } from "@/server/data/products";
import { catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Section, Empty } from "@/components/ui";
import { TrendChart } from "@/components/charts/TrendChart";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num, pct } from "@/lib/format";
import { addDays, diffDays, eachDay, fmtDate } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";

export default async function SkuDetail({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<SP> }) {
  const { sku: raw } = await params;
  const sku = decodeURIComponent(raw);
  const ctx = await pageContext(searchParams);
  const trendRange = { from: addDays(ctx.asOf, -59), to: ctx.asOf };
  const [{ rows, skus, products, network }, daily] = await Promise.all([loadSkus(ctx), getSkuDaily(sku, trendRange, ctx.filters.ch)]);
  const p = products.get(sku);
  const s = skus.find((x) => x.sku === sku);
  const mine = rows.filter((r) => r.sku === sku);
  if (!p && !s) return <Empty title={`SKU ${sku} not found`}>It is not in the product masters and has no sales in the last 90 days for the selected channel.</Empty>;

  const dmap = new Map(daily.map((d) => [d.date, d]));
  const trend = eachDay(trendRange.from, trendRange.to).map((d) => ({ date: d, sales: +(dmap.get(d)?.sales ?? 0), qty: +(dmap.get(d)?.qty ?? 0), stores: +(dmap.get(d)?.stores ?? 0) }));
  const storeRows = mine.map((r) => ({ b: r.b, store: r.store, sales: r.rs, qty: r.rq, l7: r.l7s, l30: r.l30s, l30q: r.l30q, mtd: r.mtds, last: r.last, daysSince: r.last ? diffDays(r.last, ctx.asOf) : null, growth: growth(r.rs, r.ps) }));
  const cols: Col[] = [
    { key: "store", label: "Store", width: 200 }, { key: "sales", label: "Revenue", type: "inr", bar: true }, { key: "qty", label: "Units", type: "num" }, { key: "growth", label: "vs prev", type: "delta" },
    { key: "l7", label: "L7", type: "inr" }, { key: "l30", label: "L30", type: "inr" }, { key: "l30q", label: "L30 units", type: "num" }, { key: "mtd", label: "MTD", type: "inr" },
    { key: "last", label: "Last sale", type: "date" }, { key: "daysSince", label: "Days since", type: "num" },
  ];
  const selling = storeRows.filter((r) => r.qty > 0).sort((a, b) => b.sales - a.sales);
  const lapsed = storeRows.filter((r) => r.qty <= 0);
  const attrs: [string, React.ReactNode][] = p ? [
    ["Category", catLabel(p.category ?? "")], ["Sub-type", productType(p) ?? "—"], ["Colour", p.colour ?? "—"], ["Material", p.material ?? "—"], ["Vendor", p.vendor ?? "—"],
    ["MRP", inr(p.mrp, { compact: false })], ["Selling price", inr(p.sellingPrice, { compact: false })], ["COGS", inr(p.cogs, { compact: false })],
    ["Shopify status", p.status ?? "—"], ["Lifecycle", p.lifecycle ?? "—"], ["Allocation", p.allocation ?? "—"], ["Live date", p.liveDate ? fmtDate(p.liveDate, true) : "—"],
    ...(p.inBible ? ([
      ["Total inventory", num(p.invTotal)], ["Warehouse inv", num(p.invWarehouse)], ["Store inv", num(p.invOffline)], ["Stores stocked", num(p.storesStocked)],
      ["Lifetime units", num(p.qtySoldTd)], ["Lifetime return %", pct(p.returnPctTd)], ["Lifetime GP %", pct(p.gpPctTd)], ["Last inward", p.lastInward ? fmtDate(p.lastInward, true) : "—"],
    ] as [string, React.ReactNode][]) : [["Inventory", <span key="x" className="text-zinc-400">Not in SKU Bible</span>] as [string, React.ReactNode]]),
  ] : [];

  return (
    <>
      <Link href={withQs(ctx, "/products/skus")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-zinc-500 hover:text-zinc-900"><ChevronLeft className="size-3.5" />All SKUs</Link>
      <div className="mb-4 flex gap-4">
        {p?.image && <img src={p.image} alt="" className="size-24 rounded-lg border border-zinc-200 object-cover" />}
        <PageHeader title={p?.name ?? sku} subtitle={<><span className="font-mono">{sku}</span> · {catLabel(s?.c ?? p?.category ?? "")} · {p?.tags.slice(0, 8).join(" · ")}</>} />
      </div>
      <KpiGrid>
        <Kpi label="Revenue" value={inr(s?.sales ?? 0)} delta={s?.growth ?? null} deltaLabel={ctx.period.compareLabel} />
        <Kpi label="Units" value={num(s?.qty ?? 0)} sub={`ASP ${inr(s?.asp ?? null, { compact: false })}`} />
        <Kpi label="Store penetration" value={pct(s?.penetration ?? null, 0)} sub={`${s?.stores ?? 0} of ${network} stores`} />
        <Kpi label="L7 vs prior 7" value={inr(s?.l7 ?? 0)} delta={growth(s?.l7, s?.p7)} />
        <Kpi label="L30" value={inr(s?.l30 ?? 0)} sub={`${num(s?.l30q ?? 0)} units · ${num(safeDiv(s?.l30q ?? 0, 30), 1)}/day`} />
        <Kpi label="Last sale" value={s?.last ? fmtDate(s.last, true) : "—"} sub={s?.last ? `${diffDays(s.last, ctx.asOf)} days ago` : "none in 90 days"} />
      </KpiGrid>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Section title="Daily units & revenue — last 60 days">
          <TrendChart data={trend} height={240} series={[{ key: "sales", label: "Revenue", color: "#5b4fd6" }, { key: "qty", label: "Units", color: "#d97a2b", type: "line", axis: "right" }]} rightFormat="num" />
        </Section>
        <Section title="Master attributes">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px]">
            {attrs.map(([k, v]) => (<div key={k} className="flex justify-between gap-2 border-b border-zinc-100 py-1"><dt className="text-zinc-500">{k}</dt><dd className="tabular text-right font-medium">{v}</dd></div>))}
          </dl>
        </Section>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Top stores" tip="Highest revenue in the selected period">
          <ol className="space-y-1 text-[12.5px]">{selling.slice(0, 8).map((r, i) => (<li key={r.store} className="flex justify-between"><span><span className="mr-1.5 text-zinc-400">{i + 1}</span>{r.store}</span><span className="tabular">{inr(r.sales)} · {r.qty}u</span></li>))}</ol>
        </Section>
        <Section title="Weak stores" tip="Selling stores with the lowest revenue, then stores that sold in the last 90 days but not in this period">
          <ol className="space-y-1 text-[12.5px]">
            {[...selling.slice(-5).reverse(), ...lapsed.slice(0, 5)].map((r) => (<li key={r.store} className="flex justify-between"><span>{r.store}</span><span className="tabular text-zinc-600">{r.qty > 0 ? `${inr(r.sales)} · ${r.qty}u` : `no sale · last ${r.last ? fmtDate(r.last) : "—"}`}</span></li>))}
          </ol>
        </Section>
      </div>
      <div className="mt-4"><DataTable title="By store" rows={storeRows} columns={cols} defaultSort={{ key: "sales" }} rowHref="/stores/{b}" csvName={`sku-${sku}-stores`} height={480} /></div>
    </>
  );
}
