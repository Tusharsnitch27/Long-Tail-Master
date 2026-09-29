import Link from "next/link";
import { withQs, type Ctx } from "@/server/context";
import { loadScope, productPerformance, lastNDays } from "@/server/scope";
import { channelMetrics, channelSeries, marketplaceBreakdown, marketplacesWithData } from "@/server/channelData";
import { buildActions, actionStatuses } from "@/server/actions";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Tabs, Kpi, KpiGrid, Section, Delta, Meter, ProductCell } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { DataTable, type Col } from "@/components/table/DataTable";
import { TrendChart } from "@/components/charts/TrendChart";
import { inr, num, pct } from "@/lib/format";
import { fmtRange, rangeDays } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { CH_COLORS } from "@/lib/colors";

/** Shared body for Online Overview (Shopify) and Marketplace Overview. */
export async function ChannelDetail({ ctx: base, channel }: { ctx: Ctx; channel: "online" | "marketplace" }) {
  const { range, compare } = base.period;
  const trendRange = rangeDays(range) >= 14 ? range : lastNDays(range.to > base.asOf ? base.asOf : range.to, 30);
  const sc = await loadScope(base, [trendRange]);
  const mps = marketplacesWithData(sc.uc);
  const mp = channel === "marketplace" && typeof base.sp.mp === "string" && mps.includes(base.sp.mp) ? base.sp.mp : null;
  const ctx = { ...base, filters: { ...base.filters, channel, mp } };
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const [perf, act, statuses] = await Promise.all([productPerformance(ctx, sc.pm, whUnits, channel, mp), buildActions(base), actionStatuses()]);
  const m = channelMetrics(sc.facts, sc.uc, range, channel, mp), p = channelMetrics(sc.facts, sc.uc, compare, channel, mp);
  const all = channelMetrics(sc.facts, sc.uc, range, "all");
  const ret = sc.products.reduce((a, x) => ({ r: a.r + (x.returnsValue[channel] ?? 0), s: a.s + (x.sales[channel] ?? 0) }), { r: 0, s: 0 });
  const label = channel === "online" ? "Online" : mp ? mp[0] + mp.slice(1).toLowerCase() : "Marketplace";
  const series = channelSeries(sc.facts, sc.uc, trendRange, mp).map((r) => ({ date: r.date, value: r[channel] }));
  const cats = ctx.filters.cats.map((c) => {
    const f = sc.facts.filter((x) => x.c === c), u = sc.uc.filter((x) => x.c === c);
    const cm = channelMetrics(f, u, range, channel, mp), cp = channelMetrics(f, u, compare, channel, mp);
    return { c, revenue: cm.revenue, units: cm.units, growth: growth(cm.revenue, cp.revenue), share: safeDiv(cm.revenue, m.revenue) };
  });
  const rows = perf.rows.filter((r) => r.units > 0 || r.prev > 0).map((r) => ({ ...r, category: catLabel(r.category ?? ""), sellThrough: r.l30Units + r.whInv > 0 ? r.l30Units / (r.l30Units + r.whInv) : null }));
  const cols: Col[] = [
    { key: "name", label: "Product", image: "image", sub: "sku", width: 250 }, { key: "category", label: "Category" },
    { key: "revenue", label: "Revenue", type: "inr", bar: true }, { key: "units", label: "Units", type: "num" }, { key: "growth", label: "Growth", type: "delta" },
    { key: "returnPct", label: "Return %", type: "pct", tip: `Lifetime ${channel} return % (returned ₹ ÷ sold ₹)` },
    { key: "whInv", label: "Warehouse", type: "num" }, { key: "doi", label: "Days of inventory", type: "num", tip: "(store + warehouse) ÷ L30 daily units, all channels" },
  ];
  const highRet = [...sc.products].filter((x) => (x.sales[channel] ?? 0) >= 100_000 && x.returnPct[channel] != null).sort((a, b) => (b.returnPct[channel] ?? 0) - (a.returnPct[channel] ?? 0)).slice(0, 6);
  const avail = rows.filter((r) => r.units > 0).slice(0, 8);
  const risk = act.actions.filter((a) => (a.type === "channel_decline" && (channel === "online" ? a.key.includes(":online:") : a.key.includes(":marketplace:") || (mps.some((x) => a.key.includes(`:${x}:`)) && (!mp || a.key.includes(`:${mp}:`))))) || (a.type === "return_risk" && a.key.startsWith(`ret:${channel}:`)));
  const tabsMp = channel === "marketplace" && mps.length > 1
    ? <Tabs active={mp ?? "all"} tabs={[{ key: "all", label: "All marketplaces", href: withQs(base, "/marketplace", { mp: null }) }, ...mps.map((x) => ({ key: x, label: x[0] + x.slice(1).toLowerCase(), href: withQs(base, "/marketplace", { mp: x }) }))]} /> : null;

  // marketplace-only blocks
  const bd = channel === "marketplace" ? marketplaceBreakdown(sc.uc, range, compare) : [];
  const onlineStrong = channel === "marketplace" ? (await productPerformance(ctx, sc.pm, whUnits, "online", null)).rows.slice(0, 30) : [];
  const listing = onlineStrong.map((r) => ({ r, mk: perf.rows.find((x) => x.sku === r.sku)?.revenue ?? 0 })).filter((x) => x.r.revenue > 50_000 && x.mk < x.r.revenue * 0.1 && whUnits(x.r.sku) > 30).slice(0, 5);

  return (
    <>
      <PageHeader title={channel === "online" ? "Online Overview" : "Marketplace Overview"}
        subtitle={<>{channel === "online" ? "Shopify" : mp ?? `${mps.join(" · ") || "no marketplaces with data"}`} · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel} · Unicommerce, cancellations excluded</span></>} />
      {tabsMp}
      <KpiGrid cols={6}>
        <Kpi label="Revenue" value={inr(m.revenue)} delta={growth(m.revenue, p.revenue)} deltaLabel={`${pct(safeDiv(m.revenue, all.revenue), 0)} of overall`} />
        <Kpi label="Units" value={num(m.units)} delta={growth(m.units, p.units)} />
        <Kpi label="Orders" value={num(m.orders)} sub={`${inr(safeDiv(m.revenue, m.orders))} per order`} />
        <Kpi label="ASP" value={inr(m.asp, { compact: false })} delta={growth(m.asp, p.asp)} />
        <Kpi label="Active products" value={num(perf.activeSkus)} sub="≥1 sale" />
        <Kpi label="Return %" value={pct(safeDiv(ret.r, ret.s))} sub={`lifetime · ${channel === "marketplace" ? "all marketplaces" : "Shopify"}`} tip="Returned ₹ ÷ sold ₹ over each product's life (Product Master). Not split by individual marketplace." />
      </KpiGrid>
      {channel === "marketplace" && bd.length > 0 && (
        <div className="mt-3">
          <Section title="Marketplace comparison" pad={false}>
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Marketplace", "Revenue", "Units", "Growth", "Contribution", "ASP", "Orders"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody>{bd.map((r) => (
                <tr key={r.mp} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-2.5"><Link href={withQs(base, "/marketplace", { mp: r.mp })} className="font-medium hover:underline">{r.mp[0] + r.mp.slice(1).toLowerCase()}</Link></td>
                  <td className="tabular px-4 text-right font-semibold">{inr(r.revenue)}</td><td className="tabular px-4 text-right">{num(r.units)}</td><td className="px-4 text-right"><Delta v={r.growth} /></td>
                  <td className="px-4"><span className="flex items-center justify-end gap-2"><Meter value={r.share} className="w-20" /><span className="tabular w-9 text-right">{pct(r.share, 0)}</span></span></td>
                  <td className="tabular px-4 text-right">{inr(r.asp, { compact: false })}</td><td className="tabular px-4 text-right">{num(r.orders)}</td>
                </tr>
              ))}</tbody>
            </table>
          </Section>
        </div>
      )}
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title={`${label} daily revenue`}><TrendChart data={series} height={220} series={[{ key: "value", label, color: CH_COLORS[channel] }]} /></Section>
        <Section title="Category performance">
          <div className="space-y-3">{cats.map((r) => (
            <div key={r.c}>
              <div className="flex items-baseline justify-between text-[12.5px]"><span className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full" style={{ background: catColor(r.c) }} />{catLabel(r.c)}</span><span className="tabular font-semibold">{inr(r.revenue)}</span></div>
              <div className="mt-1.5 flex items-center gap-3 text-[11.5px] text-zinc-500"><Meter value={r.share} color={catColor(r.c)} className="w-28" /><span className="tabular w-8">{pct(r.share, 0)}</span><Delta v={r.growth} /><span className="tabular ml-auto">{num(r.units)} units</span></div>
            </div>
          ))}</div>
        </Section>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Section title="Top products">
          <ul className="space-y-1.5">{rows.slice(0, 6).map((r) => (
            <li key={r.sku} className="flex items-center justify-between gap-2"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(base, `/products/${encodeURIComponent(r.sku)}`)} /><span className="tabular shrink-0 text-right text-[12px]"><b className="font-semibold">{inr(r.revenue)}</b><Delta v={r.growth} className="block text-[11px]" /></span></li>
          ))}</ul>
        </Section>
        <Section title="High-return products" tip={`Lifetime ${channel} return %, products with ≥ ₹1L lifetime ${channel} sales`}>
          <ul className="space-y-1.5">{highRet.map((x) => (
            <li key={x.sku} className="flex items-center justify-between gap-2"><ProductCell name={x.name} sku={x.sku} image={x.image} href={withQs(base, `/products/${encodeURIComponent(x.sku)}`)} /><span className="tabular shrink-0 text-right text-[12px]"><b className="font-semibold text-rose-600">{pct(x.returnPct[channel])}</b><span className="block text-[11px] text-zinc-500">{inr(x.sales[channel])} sold</span></span></li>
          ))}</ul>
        </Section>
        <Section title="Inventory availability" tip="Warehouse stock and days of cover for the top sellers">
          <ul className="space-y-1.5">{avail.map((r) => (
            <li key={r.sku} className="flex items-center justify-between gap-2"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(base, `/products/${encodeURIComponent(r.sku)}`)} /><span className="tabular shrink-0 text-right text-[12px]"><b className="font-semibold">{num(r.whInv)}</b> WH<span className={`block text-[11px] ${r.doi != null && r.doi < 14 ? "font-semibold text-rose-600" : "text-zinc-500"}`}>{r.doi != null ? `${num(r.doi)} days` : "—"}</span></span></li>
          ))}</ul>
        </Section>
      </div>
      {(risk.length > 0 || listing.length > 0) && (
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <Section title="Risks">
            <div className="space-y-2">{risk.length ? risk.slice(0, 4).map((a) => <ActionCard key={a.key} a={a} compact qs={base.qs} status={statuses.get(a.key)} />) : <div className="py-4 text-center text-[12.5px] text-zinc-500">No material risks.</div>}</div>
          </Section>
          {channel === "marketplace" && (
            <Section title="Opportunities" tip="Strong Online (Shopify) sellers with little marketplace revenue and warehouse stock available — listing/visibility candidates">
              {listing.length ? <ul className="space-y-1.5">{listing.map(({ r, mk }) => (
                <li key={r.sku} className="flex items-center justify-between gap-2"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(base, `/products/${encodeURIComponent(r.sku)}`)} /><span className="tabular shrink-0 text-right text-[11.5px] text-zinc-600">Online {inr(r.revenue)} · Mkt {inr(mk)}<span className="block text-zinc-400">{num(whUnits(r.sku))} WH units</span></span></li>
              ))}</ul> : <div className="py-4 text-center text-[12.5px] text-zinc-500">No clear listing gaps.</div>}
            </Section>
          )}
        </div>
      )}
      <div className="mt-3">
        <DataTable title="Product performance" rows={rows} columns={cols} defaultSort={{ key: "revenue" }} rowHref="/products/{sku}" csvName={`${channel}${mp ? `-${mp}` : ""}-products`} height={560} dense={false} searchKeys={["name", "sku", "category"]} />
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Online = SHOPIFY; Marketplace = AJIO / MYNTRA / FLIPKART / AMAZON — only marketplaces with data are shown.</p>
    </>
  );
}
