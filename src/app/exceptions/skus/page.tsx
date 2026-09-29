import { pageContext, withQs, type SP } from "@/server/context";
import { loadSkus } from "@/server/skus";
import { catLabel } from "@/server/views";
import { PageHeader, Tabs, Notice } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { diffDays, resolvePeriod } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { pct } from "@/lib/format";

export default async function SkuExceptions({ searchParams }: { searchParams: Promise<SP> }) {
  const base = await pageContext(searchParams);
  const ctx = { ...base, period: resolvePeriod("l30", base.asOf, base.today) }; // exceptions use rolling windows
  const { skus, products, network } = await loadSkus(ctx);
  const ex = ctx.settings.exceptions;
  const sold = new Set(skus.filter((s) => s.l30q > 0).map((s) => s.sku));
  const zero = [...products.values()]
    .filter((p) => p.category && ctx.filters.cats.includes(p.category) && !sold.has(p.sku))
    .filter((p) => (p.inBible ? p.lifecycle === "LIVE" && (p.invOffline ?? 0) > 0 : p.status === "ACTIVE" && skus.some((s) => s.sku === p.sku)))
    .map((p) => { const s = skus.find((x) => x.sku === p.sku); return { image: p.image, sku: p.sku, name: p.name, category: catLabel(p.category!), mrp: p.mrp, inv: p.invOffline, stocked: p.storesStocked, last: s?.last ?? null, daysSince: s?.last ? diffDays(s.last, ctx.asOf) : null, why: p.inBible ? "Live with store stock, no store sale in 30 days" : "Sold in last 90 days, none in last 30" }; });
  const selling = skus.filter((s) => s.l30q > 0);
  const perStore = selling.map((s) => safeDiv(s.l30, s.storesL30) ?? 0).sort((a, b) => a - b);
  const q75 = perStore[Math.floor(perStore.length * 0.75)] ?? 0;
  const mk = (s: (typeof skus)[number], why: string) => ({ image: s.image, sku: s.sku, name: s.name, category: catLabel(s.c), mrp: s.mrp, l7: s.l7, p7: s.p7, l7g: growth(s.l7, s.p7), l30: s.l30, l30q: s.l30q,
    stores: s.storesL30, pen: safeDiv(s.storesL30, network), perStore: safeDiv(s.l30, s.storesL30), inv: s.invOffline, last: s.last, why });
  const lists = {
    zero,
    declining: selling.filter((s) => s.p7 > 0 && (growth(s.l7, s.p7) ?? 0) <= ex.wowDecline).map((s) => mk(s, `L7 ${pct(growth(s.l7, s.p7), 0)} vs prior 7 days`)),
    strong: selling.filter((s) => (safeDiv(s.l30, s.storesL30) ?? 0) >= q75 && (safeDiv(s.storesL30, network) ?? 1) < ex.lowPenetration).map((s) => mk(s, "Top-quartile sales per store, low store penetration — expand distribution")),
    few: selling.filter((s) => s.storesL30 <= ex.fewStores).map((s) => mk(s, `Selling in ${s.storesL30} store(s) only`)),
  };
  const TABS = [
    { key: "zero", label: "Zero-sale SKUs" }, { key: "declining", label: "Declining" }, { key: "strong", label: "Strong, low penetration" }, { key: "few", label: `≤ ${ex.fewStores} stores` },
  ] as const;
  const tab = TABS.find((t) => t.key === ctx.sp.tab) ?? TABS[0];
  const rows = lists[tab.key] as Record<string, unknown>[];
  const cols: Col[] = tab.key === "zero"
    ? [{ key: "image", label: "", type: "image" }, { key: "sku", label: "SKU", type: "code" }, { key: "name", label: "Product", width: 180 }, { key: "category", label: "Category" }, { key: "mrp", label: "MRP", type: "inrFull" },
      { key: "inv", label: "Store inv", type: "num", tip: "Bible offline inventory (perfumes)" }, { key: "stocked", label: "Stores stocked", type: "num" }, { key: "last", label: "Last store sale", type: "date" }, { key: "daysSince", label: "Days since", type: "num" }, { key: "why", label: "Why", width: 240 }]
    : [{ key: "image", label: "", type: "image" }, { key: "sku", label: "SKU", type: "code" }, { key: "name", label: "Product", width: 180 }, { key: "category", label: "Category" },
      { key: "l7", label: "L7", type: "inr" }, { key: "p7", label: "Prior 7", type: "inr" }, { key: "l7g", label: "L7 vs P7", type: "delta" }, { key: "l30", label: "L30", type: "inr", bar: true }, { key: "l30q", label: "L30 units", type: "num" },
      { key: "stores", label: "Stores (L30)", type: "num" }, { key: "pen", label: "Penetration", type: "pct" }, { key: "perStore", label: "L30 / selling store", type: "inr" }, { key: "inv", label: "Store inv", type: "num", hidden: true }, { key: "why", label: "Why", width: 260 }];
  return (
    <>
      <PageHeader title="SKUs to Act On" subtitle={<>Rolling windows to {ctx.asOf} · {ctx.filters.ch === "store" ? "offline stores" : ctx.filters.ch} · penetration base {network} stores</>} />
      <Tabs active={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: lists[t.key].length, href: withQs(ctx, "/exceptions/skus", { tab: t.key === "zero" ? null : t.key }) }))} />
      {tab.key === "zero" && <Notice>Perfumes use fresh SKU Bible inventory. Other categories have no fresh inventory source, so “zero-sale” there means sold in the last 90 days but not the last 30.</Notice>}
      <DataTable rows={rows} columns={cols} rowHref="/products/skus/{sku}" defaultSort={{ key: tab.key === "zero" ? "inv" : tab.key === "declining" ? "l7g" : "l30", desc: tab.key !== "declining" }} csvName={`sku-exceptions-${tab.key}`} height={680} dense={false} />
    </>
  );
}
