import { pageContext, type SP } from "@/server/context";
import { loadSkus } from "@/server/skus";
import { catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num, pct } from "@/lib/format";
import { diffDays, fmtRange } from "@/lib/dates";
import { growth } from "@/lib/metrics";

export default async function Skus({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const { skus, products, network } = await loadSkus(ctx);
  const rows = skus.map((s) => {
    const p = products.get(s.sku);
    return {
      image: s.image, sku: s.sku, style: s.sku.split("-")[0], name: s.name, category: catLabel(s.c), type: s.type, colour: s.colour,
      mrp: s.mrp, sp: p?.sellingPrice ?? null, asp: s.asp, disc: s.disc,
      sales: s.sales, qty: s.qty, growth: s.growth, stores: s.stores, penetration: s.penetration,
      l7: s.l7, l7g: growth(s.l7, s.p7), l30: s.l30, l30q: s.l30q, mtd: s.mtd, last: s.last, daysSince: s.last ? diffDays(s.last, ctx.asOf) : null,
      inv: s.invOffline, status: p?.lifecycle ?? p?.status ?? null,
    };
  });
  const cols: Col[] = [
    { key: "image", label: "", type: "image" },
    { key: "sku", label: "SKU", type: "code" },
    { key: "style", label: "SKU group", type: "code", hidden: true, tip: "Style code (SKU without colour suffix)" },
    { key: "name", label: "Product", width: 190 },
    { key: "category", label: "Category" },
    { key: "type", label: "Sub-type", tip: "Derived from Shopify product tags" },
    { key: "colour", label: "Colour", hidden: true },
    { key: "mrp", label: "MRP", type: "inrFull", group: "Price" },
    { key: "sp", label: "Selling price", type: "inrFull", group: "Price", hidden: true, tip: "Listed slashed price (product master)" },
    { key: "asp", label: "ASP", type: "inrFull", group: "Price", tip: "Realised revenue ÷ units" },
    { key: "disc", label: "Disc %", type: "pct", group: "Price", hidden: true },
    { key: "sales", label: "Revenue", type: "inr", bar: true, group: "Selected period" },
    { key: "qty", label: "Units", type: "num", group: "Selected period" },
    { key: "growth", label: "vs prev", type: "delta", group: "Selected period" },
    { key: "stores", label: "Stores selling", type: "num", group: "Selected period" },
    { key: "penetration", label: "Penetration", type: "pct", group: "Selected period", tip: `Stores selling ÷ ${network} active stores in scope` },
    { key: "l7", label: "L7", type: "inr", group: "Rolling" },
    { key: "l7g", label: "L7 vs P7", type: "delta", group: "Rolling", tip: "Last 7 days vs the 7 days before" },
    { key: "l30", label: "L30", type: "inr", group: "Rolling" },
    { key: "l30q", label: "L30 units", type: "num", group: "Rolling", hidden: true },
    { key: "mtd", label: "MTD", type: "inr", group: "Rolling" },
    { key: "last", label: "Last sale", type: "date" },
    { key: "inv", label: "Store inv", type: "num", tip: "Offline inventory from SKU Bible (perfumes only; not available for other categories)" },
    { key: "status", label: "Status" },
  ];
  const selling = skus.filter((s) => s.qty > 0);
  const tot = skus.reduce((a, s) => a + s.sales, 0);
  const top10 = selling.slice(0, 10).reduce((a, s) => a + s.sales, 0);
  return (
    <>
      <PageHeader title="SKU Performance" subtitle={<>{fmtRange(ctx.period.range)} · {ctx.filters.ch === "store" ? "offline stores" : `channel: ${ctx.filters.ch}`} · SKU sales from HORIZONTAL_SALES_CATEGORIES (gross)</>} />
      <KpiGrid>
        <Kpi label="Selling SKUs" value={num(selling.length)} sub={`${skus.length - selling.length} sold in last 90d but not in period`} />
        <Kpi label="Revenue" value={inr(tot)} />
        <Kpi label="Units" value={num(skus.reduce((a, s) => a + s.qty, 0))} />
        <Kpi label="Top-10 concentration" value={pct(tot ? top10 / tot : null, 0)} sub="of revenue from top 10 SKUs" />
        <Kpi label="Avg penetration" value={pct(selling.length ? selling.reduce((a, s) => a + (s.penetration ?? 0), 0) / selling.length : null, 0)} sub={`across ${network} stores`} />
        <Kpi label="Single-store SKUs" value={num(selling.filter((s) => s.stores <= 1).length)} />
      </KpiGrid>
      <div className="mt-4">
        <DataTable rows={rows} columns={cols} defaultSort={{ key: "sales" }} rowHref="/products/skus/{sku}" csvName="sku-performance" height={700} searchKeys={["sku", "name", "category", "type", "colour"]} dense={false} />
      </div>
    </>
  );
}
