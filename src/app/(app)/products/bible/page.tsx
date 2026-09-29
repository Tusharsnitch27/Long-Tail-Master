import { pageContext, type SP } from "@/server/context";
import { loadSkus } from "@/server/skus";
import { productType } from "@/server/data/products";
import { catLabel } from "@/server/views";
import { PageHeader, Notice } from "@/components/ui";
import { BibleGrid, type BibleItem } from "@/components/BibleGrid";
import { resolvePeriod } from "@/lib/dates";

export default async function Bible({ searchParams }: { searchParams: Promise<SP> }) {
  const base = await pageContext(searchParams);
  // Bible uses rolling L30 windows regardless of the page period
  const ctx = { ...base, period: resolvePeriod("l30", base.asOf, base.today) };
  const { products, skus } = await loadSkus(ctx);
  const perf = new Map(skus.map((s) => [s.sku, s]));
  const items: BibleItem[] = [...products.values()]
    .filter((p) => p.category && ctx.filters.cats.includes(p.category))
    .filter((p) => p.status !== "DRAFT" || perf.has(p.sku))
    .map((p) => {
      const s = perf.get(p.sku);
      return {
        sku: p.sku, name: p.name, category: catLabel(p.category!), type: productType(p), colour: p.colour, image: p.image, mrp: p.mrp,
        status: p.status, lifecycle: p.lifecycle, allocation: p.allocation, liveDate: p.liveDate, inBible: p.inBible, invTotal: p.invTotal,
        invOffline: p.invOffline, storesStocked: p.storesStocked, qtyTd: p.qtySoldTd, returnPct: p.returnPctTd,
        l30q: s?.l30q ?? 0, l30: s?.l30 ?? 0, stores: s?.storesL30 ?? 0, material: p.material, vendor: p.vendor,
      };
    });
  return (
    <>
      <PageHeader title="SKU Bible" subtitle={<>{items.length} SKUs · product master for {ctx.filters.cats.map(catLabel).join(" & ")} · L30 = last 30 days to {ctx.asOf} ({ctx.filters.ch === "store" ? "stores" : ctx.filters.ch})</>} />
      <Notice>Sources: <b>LONG_TAIL_MASTER_BIBLE</b> (fresh; currently perfumes only — inventory, lifetime & returns) + <b>LONG_TAIL_PRODUCT_INVENTORY_MASTER</b> for names/colour/status of other categories. Draft SKUs with no sales are hidden.</Notice>
      <BibleGrid items={items} />
    </>
  );
}
