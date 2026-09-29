import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadScope, productPerformance } from "@/server/scope";
import { getSkuFacts, getSkuDailyMulti } from "@/server/data/sku";
import { getChannelSkuDaily } from "@/server/data/channels";
import { getStoreInventory } from "@/server/data/inventory";
import { buildActions, actionStatuses } from "@/server/actions";
import { ucChannel } from "@/server/channelData";
import { catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Section, Meter, Empty, Stat } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { compactNum, inr, num, pct } from "@/lib/format";
import { addDays, eachDay, fmtDate, fmtRange } from "@/lib/dates";
import { safeDiv } from "@/lib/metrics";
import { CH_COLORS } from "@/lib/colors";

export default async function ProductDetail({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<SP> }) {
  const sku = decodeURIComponent((await params).sku);
  const ctx = await pageContext(searchParams);
  const sc = await loadScope(ctx);
  const p = sc.pm.get(sku);
  if (!p) return <Empty title={`Product ${sku} not found`}>It isn’t in the Product Master.</Empty>;
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const trendRange = { from: addDays(ctx.asOf, -59), to: ctx.asOf };
  const [perf, storeDaily, ucDaily, storeSku, inv, act, statuses] = await Promise.all([
    productPerformance({ ...ctx, filters: { ...ctx.filters, cats: [p.category ?? ctx.filters.cats[0]] } }, sc.pm, whUnits, "all", null),
    getSkuDailyMulti([sku], trendRange, "store"), getChannelSkuDaily([sku], trendRange),
    getSkuFacts({ range: ctx.period.range, compare: ctx.period.compare, asOf: ctx.asOf, cats: [p.category ?? "perfumes"], ch: "store" }),
    getStoreInventory([...sc.pm.keys()]), buildActions({ ...ctx, filters: { ...ctx.filters, cats: [p.category ?? ctx.filters.cats[0]] } }), actionStatuses(),
  ]);
  const me = perf.rows.find((r) => r.sku === sku);
  const wh = sc.wh.bySku.get(sku);
  const trend = eachDay(trendRange.from, trendRange.to).map((d) => {
    const o = { date: d, stores: 0, online: 0, marketplace: 0 };
    for (const r of storeDaily) if (r.date === d) o.stores += r.sales;
    for (const r of ucDaily) if (r.d === d) { const k = ucChannel(r.mp); if (k) o[k] += r.revenue; }
    return o;
  });
  const stores = storeSku.filter((f) => f.sku === sku).map((f) => ({ ...f, b: ctx.byName.get(f.ch.toUpperCase())?.branch_code ?? null, name: ctx.byName.get(f.ch.toUpperCase())?.short_name ?? f.ch.replace(/^SNITCH\s*-\s*/i, "") }))
    .filter((f) => f.l30q > 0 || f.rq > 0).sort((a, b) => b.l30q - a.l30q);
  const stockRows = inv.filter((r) => r.sku === sku);
  const stockBy = new Map<string, number>(); for (const r of stockRows) stockBy.set(r.b, (stockBy.get(r.b) ?? 0) + r.units);
  const lifetime = (["stores", "online", "marketplace"] as const).map((k) => ({ k, sales: p.sales[k] ?? 0, ret: p.returnPct[k] }));
  const ltTot = lifetime.reduce((a, x) => a + x.sales, 0) || 1;
  const period = (["stores", "online", "marketplace"] as const).map((k) => ({ k, revenue: me?.byChannel[k].revenue ?? 0, units: me?.byChannel[k].units ?? 0 }));
  const pTot = period.reduce((a, x) => a + x.revenue, 0) || 1;
  const opps = act.actions.filter((a) => a.product?.sku === sku);
  const label = { stores: "Stores", online: "Online", marketplace: "Marketplace" } as const;
  const facilities = Object.entries(wh?.byFacility ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const sizes = Object.entries(wh?.bySize ?? {}).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

  return (
    <>
      <Link href={withQs(ctx, "/products")} className="mb-2 inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-ink"><ChevronLeft className="size-3.5" />Products</Link>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        {p.image ? <img src={p.image} alt="" className="size-20 rounded-xl border border-line bg-white object-cover" /> : <div className="size-20 rounded-xl bg-zinc-100" />}
        <PageHeader title={p.name ?? sku} subtitle={<><span className="font-mono">{sku}</span> · {catLabel(p.category ?? "")} · MRP {inr(p.mrp, { compact: false })}{p.liveDate ? ` · live ${fmtDate(p.liveDate, true)}` : ""}{p.lifecycle ? ` · ${p.lifecycle.toLowerCase()}` : ""}</>} />
      </div>
      <KpiGrid cols={6}>
        <Kpi label="Overall sales" value={inr(p.sales.all)} sub="lifetime" />
        <Kpi label="Units sold" value={num(p.qty.all)} sub={`inwarded ${num(p.inwardTotal)}`} />
        <Kpi label="Return %" value={pct(p.returnPct.all)} sub="lifetime, value-based" />
        <Kpi label="Store inventory" value={num(p.invOffline)} sub={`${num(p.storesStocked)} stores stocked`} />
        <Kpi label="Warehouse inventory" value={num(wh?.units ?? 0)} sub={wh?.updated ? `live · ${wh.updated.slice(5, 16)}` : "live"} />
        <Kpi label={`Revenue · ${ctx.period.preset.toUpperCase()}`} value={inr(me?.revenue ?? 0)} sub={`${num(me?.units ?? 0)} units · ${num(me?.storesSelling ?? 0)} stores selling`} />
      </KpiGrid>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Sales trend — last 60 days" tip="Stores = store sales lines; Online/Marketplace = Unicommerce order items">
          <TrendChart data={trend} height={220} series={(["stores", "online", "marketplace"] as const).map((k) => ({ key: k, label: label[k], color: CH_COLORS[k], stack: "s" }))} />
        </Section>
        <Section title="Channel split">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-[11px] text-zinc-500"><th className="pb-1.5 text-left font-medium">Channel</th><th className="text-right font-medium">{fmtRange(ctx.period.range)}</th><th className="text-right font-medium">Lifetime</th><th className="text-right font-medium">Return %</th></tr></thead>
            <tbody>{(["stores", "online", "marketplace"] as const).map((k, i) => (
              <tr key={k} className="border-t border-zinc-100">
                <td className="py-2"><span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: CH_COLORS[k] }} />{label[k]}</span></td>
                <td className="tabular text-right">{inr(period[i].revenue)} <span className="text-[11px] text-zinc-400">{pct(period[i].revenue / pTot, 0)}</span></td>
                <td className="tabular text-right">{inr(lifetime[i].sales)} <span className="text-[11px] text-zinc-400">{pct(lifetime[i].sales / ltTot, 0)}</span></td>
                <td className="tabular text-right">{pct(lifetime[i].ret)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="Store distribution" tip={`Stores selling this product (L30 units) with current store stock where the store is in the inventory feed`}>
          {stores.length ? (
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-[11px] text-zinc-500"><th className="pb-1.5 text-left font-medium">Store</th><th className="text-right font-medium">L7</th><th className="text-right font-medium">L30</th><th className="text-right font-medium">Revenue (period)</th><th className="text-right font-medium">Stock</th></tr></thead>
              <tbody>{stores.slice(0, 12).map((s) => (
                <tr key={s.ch} className="border-t border-zinc-100 hover:bg-zinc-50">
                  <td className="py-1.5">{s.b ? <Link href={withQs(ctx, `/stores/${s.b}`)} className="hover:underline">{s.name}</Link> : s.name}</td>
                  <td className="tabular text-right">{s.l7q}</td><td className="tabular text-right">{s.l30q}</td><td className="tabular text-right">{inr(s.rs)}</td>
                  <td className="tabular text-right">{s.b && stockBy.has(s.b) ? stockBy.get(s.b) : <span className="text-zinc-300">—</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="py-4 text-center text-[12.5px] text-zinc-500">No store sales in the last 30 days.</div>}
          {stores.length > 12 && <div className="mt-2 text-[11.5px] text-zinc-500">+{stores.length - 12} more stores</div>}
        </Section>
        <Section title="Inventory distribution">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Stores (all)" value={num(p.invOffline)} sub="Product Master" />
            <Stat label="Warehouse" value={num(wh?.units ?? 0)} sub="live" />
            <Stat label="Days of inventory" value={me?.doi != null ? num(me.doi) : "—"} sub="at L30 rate" />
          </div>
          {facilities.length > 0 && <div className="mt-4 space-y-1.5">{facilities.map(([f, v]) => (
            <div key={f} className="grid grid-cols-[1fr_120px_60px] items-center gap-2 text-[12px]"><span className="text-zinc-600">{f}</span><Meter value={v / (wh?.units || 1)} /><span className="tabular text-right font-medium">{num(v)}</span></div>
          ))}</div>}
          {sizes.length > 1 && <div className="mt-4"><div className="mb-1.5 text-[11px] text-zinc-500">Warehouse by size</div><div className="flex flex-wrap gap-1.5">{sizes.map(([s, v]) => (
            <span key={s} className={`tabular rounded-md px-2 py-1 text-[11.5px] ring-1 ${v === 0 ? "bg-rose-50 text-rose-700 ring-rose-100" : "bg-zinc-50 text-zinc-700 ring-zinc-100"}`}>{s} <b className="font-semibold">{v}</b></span>
          ))}</div></div>}
          {stockRows.length > 0 && <div className="mt-3 text-[11.5px] text-zinc-500">In the store-inventory feed: {compactNum(stockRows.reduce((a, r) => a + r.units, 0))} units across {stockBy.size} stores.</div>}
        </Section>
      </div>
      <div className="mt-3">
        <Section title={`Action opportunities${opps.length ? ` · ${opps.length}` : ""}`}>
          {opps.length ? <div className="grid gap-2 xl:grid-cols-2">{opps.slice(0, 8).map((a) => <ActionCard key={a.key} a={a} qs={ctx.qs} status={statuses.get(a.key) ?? "open"} />)}</div>
            : <div className="py-4 text-center text-[12.5px] text-zinc-500">No open actions for this product.</div>}
        </Section>
      </div>
      <p className="mt-2 text-[11.5px] text-zinc-500">Lifetime sales, return % and store inventory: Product Master. Warehouse: Unicommerce live inventory. Period sales: store sales lines + Unicommerce order items (cancellations excluded).</p>
    </>
  );
}
