import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadScope, productPerformance, lastNDays } from "@/server/scope";
import { channelBreakdown, channelMetrics, channelSeries, type ChKey } from "@/server/channelData";
import { computePlan } from "@/server/plan";
import { getChannelTargets } from "@/server/data/channelTargets";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Section, Delta, Meter } from "@/components/ui";
import { TrendChart } from "@/components/charts/TrendChart";
import { inr, num, pct } from "@/lib/format";
import { fmtRange, rangeDays, startOfMonth } from "@/lib/dates";
import { safeDiv } from "@/lib/metrics";
import { CH_COLORS } from "@/lib/colors";

export const metadata = { title: "Channel Overview" };

export default async function ChannelOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const { range, compare } = ctx.period;
  const trendRange = rangeDays(range) >= 14 ? range : lastNDays(range.to > ctx.asOf ? ctx.asOf : range.to, 30);
  const sc = await loadScope(ctx, [trendRange]);
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const [perf, chTargets] = await Promise.all([productPerformance({ ...ctx, filters: { ...ctx.filters, channel: "all", mp: null } }, sc.pm, whUnits, "all", null), getChannelTargets(startOfMonth(ctx.asOf))]);
  const rows = channelBreakdown(sc.facts, sc.uc, range, compare).map((c) => {
    const ret = sc.products.reduce((a, x) => ({ r: a.r + (x.returnsValue[c.key] ?? 0), s: a.s + (x.sales[c.key] ?? 0) }), { r: 0, s: 0 });
    const plan = computePlan(sc.facts, sc.uc, ctx.asOf, c.key, chTargets, ctx.filters.cats, ctx.settings.thresholds);
    const cats = ctx.filters.cats.map((k) => ({ k, rev: channelMetrics(sc.facts.filter((f) => f.c === k), sc.uc.filter((f) => f.c === k), range, c.key).revenue }));
    return { ...c, delta: c.revenue - c.prev, returnPct: safeDiv(ret.r, ret.s), active: perf.rows.filter((r) => r.byChannel[c.key].units > 0).length, plan, cats };
  });
  const maxDelta = Math.max(...rows.map((r) => Math.abs(r.delta)), 1);
  const series = channelSeries(sc.facts, sc.uc, trendRange);
  const href = (k: ChKey) => withQs(ctx, k === "stores" ? "/stores" : `/${k}`);
  return (
    <>
      <PageHeader title="Channel Overview" subtitle={<>Which channel is driving or dragging the result · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel}</span></>} />
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map((c) => (
          <Link key={c.key} href={href(c.key)} className="rounded-xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(17,17,20,.03)] transition-colors hover:border-zinc-300">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[12.5px] font-medium"><span className="size-2 rounded-full" style={{ background: CH_COLORS[c.key] }} />{c.label}</span><Delta v={c.growth} /></div>
            <div className="tabular mt-1 text-[22px] font-semibold tracking-[-0.02em]">{inr(c.revenue)}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
              <div><div className="text-zinc-500">Contribution</div><div className="tabular font-medium">{pct(c.share, 0)}</div></div>
              <div><div className="text-zinc-500">Units</div><div className="tabular font-medium">{num(c.units)}</div></div>
              <div><div className="text-zinc-500">ASP</div><div className="tabular font-medium">{inr(c.asp, { compact: false })}</div></div>
              <div><div className="text-zinc-500">Return %</div><div className="tabular font-medium">{pct(c.returnPct)}</div></div>
              <div><div className="text-zinc-500">Active products</div><div className="tabular font-medium">{num(c.active)}</div></div>
              <div><div className="text-zinc-500">Target</div><div className="tabular font-medium">{c.plan.monthTarget != null ? pct(c.plan.achievement, 0) : <span className="text-zinc-400">not configured</span>}</div></div>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Revenue by channel" tip="Daily revenue, stacked">
          <TrendChart data={series} height={240} series={(["stores", "online", "marketplace"] as const).map((k) => ({ key: k, label: rows.find((r) => r.key === k)!.label, color: CH_COLORS[k], stack: "s" }))} />
        </Section>
        <Section title="Driving vs dragging" tip="Revenue change vs the comparison period">
          <div className="space-y-3">{rows.map((c) => (
            <div key={c.key} className="text-[12px]">
              <div className="mb-1 flex justify-between"><span>{c.label}</span><span className={`tabular font-semibold ${c.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{c.delta >= 0 ? "+" : "−"}{inr(Math.abs(c.delta))}</span></div>
              <div className="grid grid-cols-2 gap-0.5">
                <div className="flex justify-end">{c.delta < 0 && <span className="h-2 rounded-l-full bg-rose-400" style={{ width: `${(Math.abs(c.delta) / maxDelta) * 100}%` }} />}</div>
                <div>{c.delta >= 0 && <span className="block h-2 rounded-r-full bg-emerald-500" style={{ width: `${(c.delta / maxDelta) * 100}%` }} />}</div>
              </div>
            </div>
          ))}</div>
        </Section>
      </div>
      <div className="mt-3">
        <Section title="Channel economics" pad={false}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Channel", "Revenue", "Growth", "Contribution", "Units", "ASP", "Return % (lifetime)", "Target", "Achievement", "Gap to date", "Projection", "Category mix"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i && i < 11 ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((c) => {
                const t = c.cats.reduce((a, x) => a + x.rev, 0) || 1;
                return (
                  <tr key={c.key} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="px-4 py-2.5"><Link href={href(c.key)} className="flex items-center gap-2 font-medium hover:underline"><span className="size-2 rounded-full" style={{ background: CH_COLORS[c.key] }} />{c.label}</Link></td>
                    <td className="tabular px-4 text-right font-semibold">{inr(c.revenue)}</td><td className="px-4 text-right"><Delta v={c.growth} /></td><td className="tabular px-4 text-right">{pct(c.share, 0)}</td>
                    <td className="tabular px-4 text-right">{num(c.units)}</td><td className="tabular px-4 text-right">{inr(c.asp, { compact: false })}</td><td className="tabular px-4 text-right">{pct(c.returnPct)}</td>
                    {c.plan.monthTarget != null ? (<>
                      <td className="tabular px-4 text-right">{inr(c.plan.monthTarget)}</td><td className="tabular px-4 text-right">{pct(c.plan.achievement, 0)}</td>
                      <td className="tabular px-4 text-right">{inr(Math.max(c.plan.gapToDate ?? 0, 0))}</td><td className="tabular px-4 text-right">{inr(c.plan.projected)} <span className="text-[11px] text-zinc-400">{pct(c.plan.projectedAch, 0)}</span></td>
                    </>) : <td colSpan={4} className="px-4 text-right text-[11.5px] text-zinc-400">Channel target not configured</td>}
                    <td className="px-4"><span className="flex h-2 w-28 overflow-hidden rounded-full bg-zinc-100">{c.cats.map((x) => <span key={x.k} title={`${catLabel(x.k)} ${pct(x.rev / t, 0)}`} style={{ width: `${(x.rev / t) * 100}%`, background: catColor(x.k) }} />)}</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 px-4 pb-3 text-[11px] text-zinc-500">{ctx.filters.cats.map((k) => <span key={k} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: catColor(k) }} />{catLabel(k)}</span>)}<span className="ml-auto">Targets: Stores from Snowflake; Online / Marketplace from Settings when configured.</span></div>
        </Section>
      </div>
    </>
  );
}
