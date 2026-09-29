import { pageContext, type SP } from "@/server/context";
import { loadSkus } from "@/server/skus";
import { catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Notice } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num } from "@/lib/format";
import { diffDays, fmtRange } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";

export default async function StoreSku({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const { rows, products, skus } = await loadSkus(ctx);
  const pen = new Map(skus.map((s) => [s.sku, s.penetration]));
  const data = rows.map((r) => {
    const p = products.get(r.sku);
    return {
      b: r.b, store: r.store, sku: r.sku, name: p?.name ?? null, category: catLabel(r.c), mrp: p?.mrp ?? r.price,
      sales: r.rs, qty: r.rq, prev: r.ps, growth: growth(r.rs, r.ps), l7: r.l7s, l7q: r.l7q, l30: r.l30s, l30q: r.l30q, mtd: r.mtds, mtdq: r.mtdq,
      velocity: r.l30q / 30, last: r.last, daysSince: r.last ? diffDays(r.last, ctx.asOf) : null, penetration: pen.get(r.sku) ?? null, asp: safeDiv(r.rs, r.rq),
    };
  });
  const cols: Col[] = [
    { key: "store", label: "Store", width: 180 },
    { key: "sku", label: "SKU", type: "code" },
    { key: "name", label: "Product", width: 170 },
    { key: "category", label: "Category" },
    { key: "mrp", label: "MRP", type: "inrFull", hidden: true },
    { key: "sales", label: "Revenue", type: "inr", bar: true, group: "Selected period" },
    { key: "qty", label: "Units", type: "num", group: "Selected period" },
    { key: "growth", label: "vs prev", type: "delta", group: "Selected period" },
    { key: "asp", label: "ASP", type: "inrFull", group: "Selected period", hidden: true },
    { key: "l7", label: "L7", type: "inr", group: "Rolling (to as-of)" },
    { key: "l30", label: "L30", type: "inr", group: "Rolling (to as-of)" },
    { key: "l30q", label: "L30 units", type: "num", group: "Rolling (to as-of)" },
    { key: "mtd", label: "MTD", type: "inr", group: "Rolling (to as-of)" },
    { key: "velocity", label: "Units/day", type: "dec", tip: "L30 units ÷ 30 (rate of sale)", group: "Velocity" },
    { key: "last", label: "Last sale", type: "date", group: "Velocity" },
    { key: "daysSince", label: "Days since", type: "num", group: "Velocity", tip: "90-day lookback" },
    { key: "penetration", label: "SKU penetration", type: "pct", tip: "Share of active stores where this SKU sold in the period (network-wide)" },
  ];
  const totalSales = data.reduce((a, r) => a + r.sales, 0);
  const pairs = data.filter((r) => r.qty > 0).length;
  return (
    <>
      <PageHeader title="Store × SKU" subtitle={<>{fmtRange(ctx.period.range)} · rolling windows end {ctx.asOf} · {ctx.filters.ch === "store" ? "offline stores" : `channel: ${ctx.filters.ch}`}</>} />
      <KpiGrid cols={4}>
        <Kpi label="Store × SKU pairs selling" value={num(pairs)} />
        <Kpi label="Revenue" value={inr(totalSales)} />
        <Kpi label="SKUs" value={num(new Set(data.filter((r) => r.qty > 0).map((r) => r.sku)).size)} />
        <Kpi label="Stores" value={num(new Set(data.filter((r) => r.qty > 0).map((r) => r.store)).size)} />
      </KpiGrid>
      <Notice>Includes store × SKU pairs with any sale in the last 90 days, so you can spot pairs that have stopped selling (sort by “Days since”). Store-level inventory is not in the source tables.</Notice>
      <DataTable rows={data} columns={cols} defaultSort={{ key: "sales" }} rowHref="/products/skus/{sku}" csvName="store-sku" height={700} searchKeys={["store", "sku", "name", "category"]} />
    </>
  );
}
