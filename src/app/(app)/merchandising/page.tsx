import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadScope, productPerformance } from "@/server/scope";
import { buildActions, actionStatuses } from "@/server/actions";
import { summarize, groupFacts } from "@/server/analytics";
import { getSkuFacts } from "@/server/data/sku";
import { catLabel } from "@/server/views";
import { PageHeader, Tabs, Kpi, KpiGrid, Section, ProductCell, Notice } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { DataTable, type Col } from "@/components/table/DataTable";
import { compactNum, inr, num } from "@/lib/format";
import { resolvePeriod, startOfMonth } from "@/lib/dates";

export const metadata = { title: "Merchandising Overview" };

export default async function Merchandising({ searchParams }: { searchParams: Promise<SP> }) {
  const base = await pageContext(searchParams);
  // inventory decisions use rolling velocity (L7 / L30 to the last complete day) regardless of the page period
  const ctx = { ...base, period: resolvePeriod("l30", base.asOf, base.today), filters: { ...base.filters, channel: "all" as const, mp: null } };
  const tab = ["position", "allocation", "distribution", "excess"].includes(String(base.sp.tab)) ? String(base.sp.tab) : "position";
  const sc = await loadScope(ctx);
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const [perf, act, statuses, storeSku] = await Promise.all([
    productPerformance(ctx, sc.pm, whUnits, "all", null), buildActions(base), actionStatuses(),
    getSkuFacts({ range: ctx.period.range, compare: ctx.period.compare, asOf: ctx.asOf, cats: ctx.filters.cats, ch: "store" }),
  ]);
  const open = (t: string[]) => act.actions.filter((a) => t.includes(a.type) && (statuses.get(a.key) ?? "open") === "open");
  const fast = open(["fast_low_doi"]), excess = open(["slow_moving"]), alloc = open(["allocation"]), dist = open(["distribution", "missed_distribution"]);
  const stockoutStores = new Set(alloc.filter((a) => a.evidence.find((e) => e.label === "Store stock")?.value === "0").map((a) => a.store?.code));

  // distribution vs comparable high-performing category stores (above-median category sales / day, MTD)
  const mtd = { from: startOfMonth(ctx.asOf), to: ctx.asOf };
  const perDay = new Map<string, number>();
  for (const [k, fs] of groupFacts(sc.facts, (f) => `${f.b}|${f.c}`)) { const m = summarize(fs, mtd); if (m.stores) perDay.set(k, m.sales / m.days); }
  const strongStores = new Map<string, Set<string>>();
  for (const c of ctx.filters.cats) {
    const xs = [...perDay.entries()].filter(([k]) => k.endsWith(`|${c}`)).map(([k, v]) => ({ b: k.split("|")[0], v })).sort((a, b) => a.v - b.v);
    const med = xs[Math.floor(xs.length / 2)]?.v ?? Infinity;
    strongStores.set(c, new Set(xs.filter((x) => x.v >= med).map((x) => ctx.byName.size ? ctx.byCode.get(x.b)?.store_name.toUpperCase() ?? x.b : x.b)));
  }
  const sellingIn = new Map<string, Set<string>>();
  for (const f of storeSku) if (f.l30q > 0) { const s = sellingIn.get(f.sku) ?? new Set(); s.add(f.ch.toUpperCase()); sellingIn.set(f.sku, s); }
  const distRows = perf.rows.filter((r) => r.byChannel.stores.units > 0 && r.category).slice(0, 40).map((r) => {
    const strong = strongStores.get(r.category!) ?? new Set<string>();
    const sold = sellingIn.get(r.sku) ?? new Set<string>();
    const strongSelling = [...strong].filter((s) => sold.has(s)).length;
    return { sku: r.sku, name: r.name, image: r.image, category: catLabel(r.category!), stores: sold.size, comparable: strong.size, gap: Math.max(strong.size - strongSelling, 0), perStore: r.salesPerStore, wh: r.whInv };
  }).filter((r) => r.gap > 0 && r.wh > 0).sort((a, b) => (b.perStore ?? 0) * b.gap - (a.perStore ?? 0) * a.gap).slice(0, 15);

  const posRows = perf.rows.filter((r) => (r.storeInv ?? 0) + r.git + r.whInv > 0 || r.l30Units > 0).map((r) => ({
    sku: r.sku, name: r.name, image: r.image, category: catLabel(r.category ?? ""), storeInv: r.storeInv, git: r.git, whInv: r.whInv, total: (r.storeInv ?? 0) + r.git + r.whInv,
    l7: r.l7Units, l30: r.l30Units, cover: r.doi, stocked: r.p?.storesStocked ?? null, selling: r.storesSelling,
  }));
  const posCols: Col[] = [
    { key: "name", label: "Product", image: "image", sub: "sku", width: 250 }, { key: "category", label: "Category" },
    { key: "storeInv", label: "Store inv", type: "num" }, { key: "git", label: "In transit", type: "num", tip: "Allocated to stores, not yet in store stock" }, { key: "whInv", label: "Warehouse", type: "num" }, { key: "total", label: "Total", type: "num", bar: true },
    { key: "l7", label: "L7 units", type: "num" }, { key: "l30", label: "L30 units", type: "num" }, { key: "cover", label: "Cover (days)", type: "num", tip: "Total inventory ÷ L30 daily units (all channels)" },
    { key: "stocked", label: "Stores stocked", type: "num" }, { key: "selling", label: "Stores selling", type: "num", tip: "Stores with ≥1 sale in the last 30 days" },
  ];
  const tabs = [
    { key: "position", label: "Inventory position", href: withQs(base, "/merchandising", { tab: null }) },
    { key: "allocation", label: "Allocation", count: alloc.length, href: withQs(base, "/merchandising", { tab: "allocation" }) },
    { key: "distribution", label: "Distribution", count: distRows.length, href: withQs(base, "/merchandising", { tab: "distribution" }) },
    { key: "excess", label: "Excess inventory", count: excess.length, href: withQs(base, "/merchandising", { tab: "excess" }) },
  ];
  return (
    <>
      <PageHeader title="Merchandising Overview" subtitle={<>Is the right inventory in the right place? · velocity to {ctx.asOf} · inventory latest (warehouse live)</>} />
      <KpiGrid cols={6}>
        <Kpi label="Store inventory" value={compactNum(sc.inventory.store)} sub="units · all stores" />
        <Kpi label="In transit" value={compactNum(sc.inventory.git)} sub="warehouse → stores" href={withQs(base, "/stores", { tab: "git" })} />
        <Kpi label="Warehouse inventory" value={compactNum(sc.inventory.warehouse)} sub="units · live" />
        <Kpi label="Active selling products" value={num(perf.rows.filter((r) => r.l30Units > 0).length)} sub="≥1 sale in 30 days" />
        <Kpi label="Fast sellers at risk" value={num(fast.length)} sub="< 14 days of cover" href={withQs(base, "/actions", { group: "sku", type: "Fast mover, low cover" })} />
        <Kpi label="Allocation opportunities" value={num(alloc.length)} sub={`${stockoutStores.size} stores out of stock on a fast seller`} href={withQs(base, "/merchandising", { tab: "allocation" })} />
        <Kpi label="Excess inventory" value={num(excess.length)} sub="products · > 180 days cover" href={withQs(base, "/merchandising", { tab: "excess" })} />
      </KpiGrid>
      <div className="mt-4"><Tabs active={tab} tabs={tabs} /></div>
      {tab === "position" && <DataTable rows={posRows} columns={posCols} defaultSort={{ key: "l30" }} rowHref="/products/{sku}" csvName="inventory-position" height={680} dense={false} searchKeys={["name", "sku", "category"]} />}
      {tab === "allocation" && (
        <>
          <Notice>Strong L7 velocity + low store stock + warehouse stock available. Store stock is from the latest store report ({act.coverage.feedStores} stores). Suggested quantities cover {21} days at the current rate, capped at 25% of warehouse stock.</Notice>
          {alloc.length ? <div className="grid gap-2.5 xl:grid-cols-2">{alloc.map((a) => <ActionCard key={a.key} a={a} qs={base.qs} status={statuses.get(a.key) ?? "open"} />)}</div> : <div className="py-6 text-center text-[12.5px] text-zinc-500">No allocation opportunities right now.</div>}
        </>
      )}
      {tab === "distribution" && (
        <>
          <Notice>Products selling in stores, compared with the <b>comparable high-performing stores</b> for their category (above-median category sales per day, MTD). A gap is a strong store that hasn’t sold the product in 30 days; the warehouse must have stock. Not every store is recommended.</Notice>
          <Section pad={false}>
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Product", "Sells in", "Comparable strong stores", "Opportunities", "Sales / selling store (L30)", "Warehouse"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody>{distRows.map((r) => (
                <tr key={r.sku} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-1.5"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(base, `/products/${encodeURIComponent(r.sku)}`)} /></td>
                  <td className="tabular px-4 text-right">{r.stores} stores</td><td className="tabular px-4 text-right">{r.comparable}</td>
                  <td className="tabular px-4 text-right font-semibold">{r.gap}</td><td className="tabular px-4 text-right">{inr(r.perStore)}</td><td className="tabular px-4 text-right">{num(r.wh)}</td>
                </tr>
              ))}</tbody>
            </table>
          </Section>
          {dist.length > 0 && <div className="mt-3 grid gap-2.5 xl:grid-cols-2">{dist.slice(0, 6).map((a) => <ActionCard key={a.key} a={a} qs={base.qs} status={statuses.get(a.key) ?? "open"} />)}</div>}
        </>
      )}
      {tab === "excess" && (
        <>
          <Notice>High inventory with low sales velocity. Options: redistribute to stores/channels where it sells, review visibility and range, or promote where business rules allow — the tool doesn’t prescribe discounts.</Notice>
          {excess.length ? <div className="grid gap-2.5 xl:grid-cols-2">{excess.map((a) => <ActionCard key={a.key} a={a} qs={base.qs} status={statuses.get(a.key) ?? "open"} />)}</div> : <div className="py-6 text-center text-[12.5px] text-zinc-500">No excess inventory flagged.</div>}
        </>
      )}
      <p className="mt-3 text-[11.5px] text-zinc-500">See also <Link href={withQs(base, "/actions", { group: "merchandising" })} className="text-brand-600 hover:underline">Action Centre → Merchandising</Link>.</p>
    </>
  );
}
