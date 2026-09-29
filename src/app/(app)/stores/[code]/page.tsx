import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { summarize, monthOutlook } from "@/server/analytics";
import { trendByCategory, catColor, catLabel } from "@/server/views";
import { getSkuFacts } from "@/server/data/sku";
import { getProductMap } from "@/server/data/products";
import { getStoreInventory } from "@/server/data/inventory";
import { buildActions, actionStatuses } from "@/server/actions";
import { PageHeader, Kpi, KpiGrid, Section, Delta, Meter, ProductCell } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num, pct } from "@/lib/format";
import { addDays, diffDays, fmtDate, fmtRange } from "@/lib/dates";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";

export default async function StoreDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const { code } = await params;
  const base = await pageContext(searchParams);
  const store = base.byCode.get(decodeURIComponent(code));
  if (!store) notFound();
  const ctx = { ...base, filters: { ...base.filters, stores: [store.branch_code] } };
  const { range, compare } = ctx.period;
  const trendRange = { from: addDays(ctx.asOf, -29), to: ctx.asOf };
  const [facts, skus, pm, act, statuses] = await Promise.all([
    loadFacts(ctx, [trendRange]), getSkuFacts({ range, compare, asOf: ctx.asOf, cats: ctx.filters.cats, ch: "store" }), getProductMap(), buildActions(base), actionStatuses(),
  ]);
  const inv = (await getStoreInventory([...pm.keys()])).filter((r) => r.b === store.branch_code);
  const inFeed = inv.length > 0;
  const stock = new Map<string, number>();
  for (const r of inv) stock.set(r.sku, (stock.get(r.sku) ?? 0) + r.units);
  const cats = new Set(ctx.filters.cats);
  const mine = skus.filter((f) => f.ch.toUpperCase() === store.store_name.toUpperCase() && cats.has(f.c));
  const m = summarize(facts, range), p = summarize(facts, compare), mo = monthOutlook(facts, ctx.asOf);
  const th = ctx.settings.thresholds;
  const catRows = ctx.filters.cats.map((c) => { const fs = facts.filter((f) => f.c === c); const cm = summarize(fs, range), cp = summarize(fs, compare); return { c, cm, g: growth(cm.sales, cp.sales), share: safeDiv(cm.sales, m.sales) }; });
  const prodRows = mine.map((f) => {
    const pr = pm.get(f.sku);
    return { sku: f.sku, name: pr?.name ?? f.sku, image: pr?.image ?? null, category: catLabel(f.c), revenue: f.rs, units: f.rq, growth: growth(f.rs, f.ps), l7: f.l7q, l30: f.l30q,
      stock: inFeed ? stock.get(f.sku) ?? 0 : null, cover: inFeed && f.l30q > 0 ? (stock.get(f.sku) ?? 0) / (f.l30q / 30) : null, last: f.last, days: f.last ? diffDays(f.last, ctx.asOf) : null };
  });
  const top = [...prodRows].filter((r) => r.units > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const low = [...prodRows].filter((r) => r.l30 > 0 || (r.growth != null && r.growth < 0)).sort((a, b) => (a.growth ?? 0) - (b.growth ?? 0)).slice(0, 5);
  const opps = act.actions.filter((a) => a.store?.code === store.branch_code);
  const cols: Col[] = [
    { key: "name", label: "Product", image: "image", sub: "sku", width: 240 }, { key: "category", label: "Category" },
    { key: "revenue", label: "Revenue", type: "inr", bar: true }, { key: "units", label: "Units", type: "num" }, { key: "growth", label: "Growth", type: "delta" },
    { key: "l7", label: "L7 units", type: "num" }, { key: "l30", label: "L30 units", type: "num" },
    { key: "stock", label: "Store stock", type: "num", tip: "Latest store-inventory snapshot" }, { key: "cover", label: "Days of cover", type: "num" },
    { key: "last", label: "Last sale", type: "date" },
  ];
  const meta = [store.city, store.state, store.region, store.operating_model, store.store_status].filter(Boolean).join(" · ");
  const trend = trendByCategory(facts, trendRange, ctx.filters.cats);

  return (
    <>
      <Link href={withQs(base, "/stores")} className="mb-2 inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-ink"><ChevronLeft className="size-3.5" />Stores</Link>
      <PageHeader title={store.short_name} subtitle={<>{meta} · AM {store.am ?? "—"} · {fmtRange(range)}</>} />
      <KpiGrid cols={6}>
        <Kpi label="Revenue" value={inr(m.sales)} delta={growth(m.sales, p.sales)} deltaLabel={ctx.period.compareLabel} />
        <Kpi label="Units" value={num(m.qty)} sub={`${num(m.bills)} bills`} />
        <Kpi label="Target" value={inr(m.target)} sub={<><span className="font-medium text-zinc-800">{pct(m.ach, 0)}</span> · {targetStatus(m.sales, m.target, th).replace("_", " ")}</>} />
        <Kpi label="Sales / day" value={inr(safeDiv(m.sales, m.days))} />
        <Kpi label="Month outlook" value={pct(mo.projectedAch, 0)} sub={`need ${inr(mo.requiredRunRate)}/day`} tip="Projected month-end achievement at the current MTD rate" />
        <Kpi label="Current inventory" value={inFeed ? num([...stock.entries()].filter(([s]) => cats.has(pm.get(s)?.category ?? "")).reduce((a, [, v]) => a + v, 0)) : "—"} sub={inFeed ? `as of ${fmtDate(inv[0].saved_date)}` : "not in the store-inventory feed"} />
      </KpiGrid>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Daily sales — last 30 days">
          <TrendChart data={trend} height={220} series={[...ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), stack: "s" })), { key: "target", label: "Target", color: "#111114", type: "line" as const, dashed: true }]} />
        </Section>
        <Section title="Category mix">
          <div className="space-y-3">
            {catRows.map((r) => (
              <div key={r.c}>
                <div className="flex items-baseline justify-between text-[12.5px]"><span className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full" style={{ background: catColor(r.c) }} />{catLabel(r.c)}</span><span className="tabular font-semibold">{inr(r.cm.sales)}</span></div>
                <div className="mt-1.5 flex items-center gap-3 text-[11.5px] text-zinc-500"><Meter value={r.share} color={catColor(r.c)} className="w-28" /><span className="tabular w-8">{pct(r.share, 0)}</span><Delta v={r.g} /><span className="tabular ml-auto">{pct(r.cm.ach, 0)} of target</span></div>
              </div>
            ))}
          </div>
        </Section>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="Top products">
          <ul className="space-y-1.5">{top.map((r) => (
            <li key={r.sku} className="flex items-center justify-between gap-3"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(base, `/products/${encodeURIComponent(r.sku)}`)} /><span className="tabular shrink-0 text-right text-[12px]"><b className="font-semibold">{inr(r.revenue)}</b><span className="block text-[11px] text-zinc-500">{r.units} units</span></span></li>
          ))}</ul>
        </Section>
        <Section title="Low-performing products" tip="Largest declines vs the comparison period among products this store sells">
          <ul className="space-y-1.5">{low.map((r) => (
            <li key={r.sku} className="flex items-center justify-between gap-3"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(base, `/products/${encodeURIComponent(r.sku)}`)} /><span className="shrink-0 text-right text-[12px]"><Delta v={r.growth} /><span className="block text-[11px] text-zinc-500">{inr(r.revenue)} · stock {r.stock ?? "—"}</span></span></li>
          ))}</ul>
        </Section>
      </div>
      <div className="mt-3">
        <Section title={`Inventory & action opportunities${opps.length ? ` · ${opps.length}` : ""}`} tip="Fast sellers with low store stock where the warehouse has units, plus other open actions for this store">
          {opps.length ? <div className="grid gap-2 xl:grid-cols-2">{opps.slice(0, 10).map((a) => <ActionCard key={a.key} a={a} qs={base.qs} status={statuses.get(a.key) ?? "open"} />)}</div>
            : <div className="py-4 text-center text-[12.5px] text-zinc-500">{inFeed ? "No open opportunities for this store." : "Store-level stock isn’t available for this store, so allocation opportunities can’t be computed."}</div>}
        </Section>
      </div>
      <div className="mt-3">
        <DataTable title="Products at this store" rows={prodRows} columns={cols} defaultSort={{ key: "revenue" }} rowHref="/products/{sku}" csvName={`store-${store.branch_code}-products`} height={520} dense={false} />
      </div>
    </>
  );
}
