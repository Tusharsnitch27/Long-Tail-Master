import type { Ctx } from "@/server/context";
import { storeSkuRows, metaPivot } from "@/server/storeProducts";
import { DataTable, type Col } from "@/components/table/DataTable";
import { Section, Kpi, KpiGrid, Notice } from "@/components/ui";
import { MetaPivot } from "./MetaPivot";
import { fmtLt, LT_LABEL } from "@/server/storeInsights";
import { compactNum, inr, num } from "@/lib/format";
import { fmtRange } from "@/lib/dates";

/** Store × product: every SKU at store level with image — what sells where, what sits, and which metafields sell in which store. */
export async function StoreProductsTab({ ctx }: { ctx: Ctx }) {
  const [all, pivot] = await Promise.all([storeSkuRows(ctx), metaPivot(ctx)]);
  const only = new Set(ctx.filters.stores);
  const rows = only.size ? all.filter((r) => only.has(r.b)) : all;
  const pv = only.size ? { ...pivot, stores: pivot.stores.filter((s) => only.has(s.b)) } : pivot;
  const multiCat = ctx.filters.cats.length > 1;
  const cols: Col[] = [
    { key: "name", label: "Product", image: "image", imageSize: 44, sub: "sku", width: 260 },
    { key: "store", label: "Store", sub: "city", width: 170 },
    { key: "catName", label: "Category", hidden: !multiCat }, { key: "l1", label: "Type" }, { key: "l2", label: "Sub-type", hidden: true }, { key: "colour", label: "Colour" },
    { key: "state", label: "State", hidden: true }, { key: "format", label: "Format", hidden: true },
    { key: "revenue", label: "Revenue", type: "inr", bar: true, group: "Period", tip: fmtRange(ctx.period.range) }, { key: "units", label: "Units", type: "num", group: "Period" },
    { key: "share", label: "Share of store", type: "pct", group: "Period", tip: "This product's share of the store's revenue in its category" },
    { key: "l7Units", label: "L7 units", type: "num", group: "Rolling" }, { key: "l30Units", label: "L30 units", type: "num", group: "Rolling" },
    { key: "stock", label: "Store stock", type: "num", group: "Inventory", tip: "Latest store report" }, { key: "cover", label: "Cover (days)", type: "num", group: "Inventory", tip: "Store stock ÷ L30 daily units in this store" },
    { key: "last", label: "Last sale", type: "date", hidden: true },
  ];
  const tableRows = rows.map((r) => ({ ...r, format: LT_LABEL[fmtLt(r.format) ?? ""] ?? fmtLt(r.format) }));
  const rev = rows.reduce((a, r) => a + r.revenue, 0), stock = rows.reduce((a, r) => a + r.stock, 0);
  const selling = rows.filter((r) => r.units > 0).length, idle = rows.filter((r) => r.stock >= 3 && r.l30Units === 0).length;
  const facets = [{ key: "store", label: "Store" }, ...(multiCat ? [{ key: "catName", label: "Category" }] : []), { key: "l1", label: "Type" }, { key: "l2", label: "Sub-type" }, { key: "colour", label: "Colour" }, { key: "state", label: "State" }, { key: "format", label: "Format" }];
  return (
    <>
      <KpiGrid cols={4}>
        <Kpi label="Store × product lines" value={num(rows.length)} sub={`${num(new Set(rows.map((r) => r.b)).size)} stores · ${num(new Set(rows.map((r) => r.sku)).size)} products`} />
        <Kpi label="Revenue · period" value={inr(rev)} sub="store sales lines (gross)" />
        <Kpi label="Selling lines" value={num(selling)} sub={`${num(rows.length - selling)} with stock, no sale in period`} />
        <Kpi label="Store stock" value={compactNum(stock)} sub={`${num(idle)} lines idle 30 days (≥3 units)`} tone={idle ? "warn" : undefined} />
      </KpiGrid>
      <div className="mt-3">
        <Section title="Which metafields sell in which store" pad={false} tip="Pick an attribute (type, colour, occasion …) and a metric; cells are heat-mapped across stores">
          <MetaPivot attrs={pv.attrs} stores={pv.stores} cells={pv.cells} qs={ctx.qs} />
        </Section>
      </div>
      <div className="mt-3">
        {rows.length > 0 ? (
          <DataTable title="Products by store" rows={tableRows as unknown as Record<string, unknown>[]} columns={cols} defaultSort={{ key: "revenue" }} rowHref="/products/{sku}" csvName={`store-products-${ctx.period.range.from}-${ctx.period.range.to}`}
            height={680} dense={false} facets={facets} urlState searchKeys={["name", "sku", "store", "city", "l1", "l2", "colour"]} searchPlaceholder="Search product, SKU or store" />
        ) : <Notice>No store sold or holds these products in the selected period.</Notice>}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Pick a store with the store filter at the top right or the Store filter in the table. Click a row for the product; click a store in the heat map for the store.</p>
    </>
  );
}
