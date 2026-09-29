import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadScope, productPerformance, lastNDays } from "@/server/scope";
import { channelMetrics, channelBreakdown, channelSeries } from "@/server/channelData";
import { buildActions } from "@/server/actions";
import { storeRows } from "@/server/analytics";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Section, Delta, Meter, Notice, ProductCell } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { compactNum, inr, num, pct } from "@/lib/format";
import { addDays, fmtRange, rangeDays } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { CH_COLORS } from "@/lib/colors";

export const metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const { range, compare } = ctx.period;
  const trendRange = rangeDays(range) >= 14 ? range : lastNDays(range.to > ctx.asOf ? ctx.asOf : range.to, 30);
  const sc = await loadScope(ctx, [trendRange, { from: addDays(compare.from, -1), to: compare.to }]);
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const [perf, act] = await Promise.all([productPerformance(ctx, sc.pm, whUnits), buildActions(ctx)]);
  const ch = ctx.filters.channel;
  const m = channelMetrics(sc.facts, sc.uc, range, ch, ctx.filters.mp), p = channelMetrics(sc.facts, sc.uc, compare, ch, ctx.filters.mp);
  const channels = channelBreakdown(sc.facts, sc.uc, range, compare);
  const series = channelSeries(sc.facts, sc.uc, trendRange, ctx.filters.mp);
  const cats = ctx.filters.cats.map((c) => ({ c, revenue: channelMetrics(sc.facts.filter((x) => x.c === c), sc.uc.filter((x) => x.c === c), range, ch, ctx.filters.mp).revenue }));
  const catTot = cats.reduce((a, x) => a + x.revenue, 0);
  const stores = storeRows(sc.facts, range, compare, ctx.byCode, ctx.settings.thresholds, ctx.filters.cats).slice(0, 6);
  const alerts = act.actions.filter((a) => a.priority !== "medium").slice(0, 4);
  const show = (k: string) => ch === "all" || ch === k;
  return (
    <>
      <PageHeader title="Overview" subtitle={<>What is happening right now · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel}</span></>} />
      {ctx.period.partial && <Notice tone="warn">Includes today — data is still arriving, so today is partial.</Notice>}
      <KpiGrid cols={6}>
        <Kpi label="Revenue" value={inr(m.revenue)} delta={growth(m.revenue, p.revenue)} deltaLabel="vs comparable" />
        <Kpi label="Units" value={num(m.units)} delta={growth(m.units, p.units)} />
        <Kpi label="ASP" value={inr(m.asp, { compact: false })} delta={growth(m.asp, p.asp)} />
        <Kpi label="Active products" value={num(perf.activeSkus)} sub="≥1 sale in period" />
        <Kpi label="Store inventory" value={compactNum(sc.inventory.store)} sub="units · all stores" />
        <Kpi label="Warehouse inventory" value={compactNum(sc.inventory.warehouse)} sub="units · live" />
      </KpiGrid>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Recent trend" tip="Daily revenue by channel">
          <TrendChart data={series} height={240} series={[
            ...(show("stores") ? [{ key: "stores", label: "Stores", color: CH_COLORS.stores, stack: "s" }] : []),
            ...(show("online") ? [{ key: "online", label: "Online", color: CH_COLORS.online, stack: "s" }] : []),
            ...(show("marketplace") ? [{ key: "marketplace", label: "Marketplace", color: CH_COLORS.marketplace, stack: "s" }] : []),
          ]} />
        </Section>
        <Section title="Mix">
          <div className="text-[11px] font-medium text-zinc-500">Channel</div>
          <div className="mt-1.5 space-y-2">{channels.map((c) => (
            <Link key={c.key} href={withQs(ctx, c.key === "stores" ? "/stores" : `/${c.key}`)} className="-mx-1.5 grid grid-cols-[92px_1fr_40px_56px] items-center gap-2 rounded-md px-1.5 py-0.5 text-[12px] hover:bg-zinc-50">
              <span>{c.label}</span><Meter value={c.share} color={CH_COLORS[c.key]} /><span className="tabular text-right font-medium">{pct(c.share, 0)}</span><Delta v={c.growth} className="text-right" />
            </Link>
          ))}</div>
          <div className="mt-4 text-[11px] font-medium text-zinc-500">Category</div>
          <div className="mt-1.5 space-y-2">{cats.map((c) => (
            <Link key={c.c} href={withQs(ctx, "/category", { cat: c.c })} className="-mx-1.5 grid grid-cols-[92px_1fr_40px_56px] items-center gap-2 rounded-md px-1.5 py-0.5 text-[12px] hover:bg-zinc-50">
              <span>{catLabel(c.c)}</span><Meter value={safeDiv(c.revenue, catTot)} color={catColor(c.c)} /><span className="tabular text-right font-medium">{pct(safeDiv(c.revenue, catTot), 0)}</span><span className="tabular text-right text-zinc-500">{inr(c.revenue)}</span>
            </Link>
          ))}</div>
        </Section>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Section title="Top stores" right={<Link href={withQs(ctx, "/stores", { tab: "stores" })} className="flex items-center gap-0.5 text-[11.5px] text-zinc-500 hover:text-ink">All<ArrowUpRight className="size-3" /></Link>}>
          <ul className="space-y-1">{stores.map((s) => (
            <li key={s.branch_code}><Link href={withQs(ctx, `/stores/${s.branch_code}`)} className="-mx-2 flex items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] hover:bg-zinc-50"><span className="truncate">{s.store}<span className="ml-1.5 text-[11px] text-zinc-400">{s.city}</span></span><span className="tabular shrink-0"><b className="font-semibold">{inr(s.sales)}</b> <Delta v={s.growth} className="ml-1 text-[11px]" /></span></Link></li>
          ))}</ul>
        </Section>
        <Section title="Top products" right={<Link href={withQs(ctx, "/category", { tab: "products" })} className="flex items-center gap-0.5 text-[11.5px] text-zinc-500 hover:text-ink">All<ArrowUpRight className="size-3" /></Link>}>
          <ul className="space-y-1.5">{perf.rows.slice(0, 6).map((r) => (
            <li key={r.sku} className="flex items-center justify-between gap-2"><ProductCell name={r.name} sku={r.sku} image={r.image} href={withQs(ctx, `/products/${encodeURIComponent(r.sku)}`)} /><span className="tabular shrink-0 text-right text-[12px]"><b className="font-semibold">{inr(r.revenue)}</b><span className="block text-[11px] text-zinc-500">{num(r.units)} units</span></span></li>
          ))}</ul>
        </Section>
        <Section title="Key alerts" right={<Link href={withQs(ctx, "/actions")} className="flex items-center gap-0.5 text-[11.5px] text-zinc-500 hover:text-ink">Action Centre<ArrowUpRight className="size-3" /></Link>}>
          <div className="space-y-2">{alerts.length ? alerts.map((a) => <ActionCard key={a.key} a={a} compact qs={ctx.qs} />) : <div className="py-4 text-center text-[12.5px] text-zinc-500">No urgent or high-priority alerts.</div>}</div>
        </Section>
      </div>
    </>
  );
}
