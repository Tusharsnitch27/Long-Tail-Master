import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadScope, productPerformance } from "@/server/scope";
import { channelMetrics, channelBreakdown, type ChKey } from "@/server/channelData";
import { buildActions } from "@/server/actions";
import { computePlan, cumulativeCurves, EXEC_LABEL, type PlanChannel } from "@/server/plan";
import { drivers, risks, opportunities, leadershipActions } from "@/server/executive";
import { getChannelTargets } from "@/server/data/channelTargets";
import { summarize } from "@/server/analytics";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Section, Delta, Meter, Notice, Tabs, Tip } from "@/components/ui";
import { InsightList } from "@/components/Insights";
import { ExecTrend } from "@/components/charts/ExecTrend";
import { compactNum, inr, num, pct } from "@/lib/format";
import { addDays, addMonths, fmtDate, fmtRange, startOfMonth } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { CH_COLORS } from "@/lib/colors";
import { cn } from "@/lib/cn";

const STATUS_CLS = { ahead: "bg-emerald-50 text-emerald-800 ring-emerald-200", on_track: "bg-sky-50 text-sky-800 ring-sky-200", at_risk: "bg-amber-50 text-amber-800 ring-amber-200", behind: "bg-rose-50 text-rose-800 ring-rose-200", no_target: "bg-zinc-100 text-zinc-600 ring-zinc-200" };

export default async function ExecutiveSummary({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const { range, compare } = ctx.period;
  const ch: PlanChannel = ctx.filters.channel === "all" ? "all" : ctx.filters.channel;
  const ms = startOfMonth(ctx.asOf);
  const sc = await loadScope(ctx, [{ from: addMonths(ms, -1), to: addDays(ms, -1) }]);
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const [act, chTargets, perf] = await Promise.all([buildActions(ctx), getChannelTargets(ms), productPerformance(ctx, sc.pm, whUnits, "all", null)]);
  const plan = computePlan(sc.facts, sc.uc, ctx.asOf, ch, chTargets, ctx.filters.cats, ctx.settings.thresholds);
  const curves = cumulativeCurves(sc.facts, sc.uc, ctx.asOf, ch, plan);
  const m = channelMetrics(sc.facts, sc.uc, range, ch), p = channelMetrics(sc.facts, sc.uc, compare, ch);
  const chanRows = channelBreakdown(sc.facts, sc.uc, range, compare).map((c) => ({ ...c, plan: computePlan(sc.facts, sc.uc, ctx.asOf, c.key, chTargets, ctx.filters.cats, ctx.settings.thresholds) }));
  const cats = ctx.filters.cats.map((c) => {
    const f = sc.facts.filter((x) => x.c === c), u = sc.uc.filter((x) => x.c === c);
    const cm = channelMetrics(f, u, range, ch), cp = channelMetrics(f, u, compare, ch);
    const cplan = computePlan(f, u, ctx.asOf, ch, chTargets, [c], ctx.settings.thresholds);
    const prods = sc.products.filter((x) => x.category === c);
    return { c, revenue: cm.revenue, growth: growth(cm.revenue, cp.revenue), ach: cplan.achievement, inv: prods.reduce((a, x) => a + (x.invOffline ?? 0) + whUnits(x.sku), 0) };
  });
  const catTotal = cats.reduce((a, x) => a + x.revenue, 0);
  const fastWh = perf.rows.filter((r) => r.l30Units / 30 >= 1).reduce((a, r) => a + r.whInv, 0);
  const drv = drivers(ctx, sc.facts, sc.uc, range, compare, ch);
  const rsk = risks(ctx, plan, sc.facts, sc.uc, range, act.actions);
  const opp = opportunities(act.actions, fastWh);
  const lead = leadershipActions(plan, act.actions);
  const hasT = plan.monthTarget != null;
  // when only some channels carry a target, every target metric says which ones
  const basis = hasT && plan.missing.length ? plan.covered.map((k) => ({ stores: "Stores", online: "Online", marketplace: "Marketplace" })[k]).join(" + ") : null;
  const on = basis ? ` · ${basis}` : "";
  const chTabs = [{ k: "all", l: "Overall" }, { k: "stores", l: "Stores" }, { k: "online", l: "Online" }, { k: "marketplace", l: "Marketplace" }];

  return (
    <>
      <PageHeader title="Executive Summary"
        subtitle={<>{ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories"} · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel} · plan as of {fmtDate(ctx.asOf, true)}</span></>}
        right={<span className={cn("rounded-lg px-3 py-1.5 text-[13px] font-semibold ring-1", STATUS_CLS[plan.status])}>{EXEC_LABEL[plan.status]}{plan.projectedAch != null ? ` · ${pct(plan.projectedAch, 0)} projected` : ""}</span>} />
      <Tabs active={ch} tabs={chTabs.map((t) => ({ key: t.k, label: t.l, href: withQs(ctx, "/", { ch: t.k === "all" ? null : t.k }) }))} />
      {plan.targetNote && <Notice tone={hasT ? "info" : "warn"}>{plan.targetNote}.{" "}{ctx.user?.role === "admin" && <Link href="/settings" className="font-medium underline">Configure channel targets</Link>}</Notice>}

      <KpiGrid cols={6}>
        <Kpi label="Revenue" value={inr(m.revenue)} delta={growth(m.revenue, p.revenue)} deltaLabel="vs comparable" />
        <Kpi label="Units" value={num(m.units)} delta={growth(m.units, p.units)} />
        <Kpi label={`MTD target${on}`} value={hasT ? inr(plan.mtdTarget) : "Not configured"} sub={hasT ? `month ${inr(plan.monthTarget)}` : undefined} tip="Phased target to date for channels that have one" />
        <Kpi label={`Achievement${on}`} value={pct(plan.achievement, 1)} sub={hasT ? `gap ${inr(Math.max(plan.gapToDate ?? 0, 0))} to date` : "—"} />
        <Kpi label="Month-end projection" value={inr(plan.projected)} sub={basis ? "all channels · projection" : "projection, not actual"} tip="Stores: MTD achievement × phased month target. Other channels: current daily rate × days in month." />
        <Kpi label={`Projected achievement${on}`} value={pct(plan.projectedAch, 0)} sub={plan.projectedGap != null ? (plan.projectedGap > 0 ? `${inr(plan.projectedGap)} short` : `${inr(-plan.projectedGap)} over`) : "—"} />
      </KpiGrid>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr_1fr]">
        <Section title={`MTD progress${on}`} tip="Time elapsed vs share of the month target achieved">
          {hasT ? (
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-[12px]"><span className="text-zinc-500">Month elapsed</span><span className="tabular font-medium">{pct(plan.timeElapsedPct, 0)} · day {plan.elapsed} of {plan.daysInMonth}</span></div>
                <Meter value={plan.timeElapsedPct} color="#a1a1aa" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[12px]"><span className="text-zinc-500">Target achieved</span><span className="tabular font-medium">{pct(plan.targetAchievedPct, 0)} · {inr(plan.coveredRevenue)} of {inr(plan.monthTarget)}</span></div>
                <div className="relative"><Meter value={plan.targetAchievedPct} color={plan.pace === "behind" ? "#e11d48" : plan.pace === "ahead" ? "#059669" : "#5046e5"} />
                  {plan.expectedPct != null && <span className="absolute -top-1 h-3.5 w-px bg-ink" style={{ left: `${Math.min(plan.expectedPct, 1) * 100}%` }} title="Where target phasing says we should be" />}</div>
              </div>
              <div className="rounded-lg bg-zinc-50 px-3 py-2 text-[12px] text-zinc-700">
                <b className="font-semibold">{plan.pace === "ahead" ? "Ahead of pace" : plan.pace === "on_pace" ? "On pace" : "Behind pace"}</b> — phasing expects {pct(plan.expectedPct, 0)} of the month target by now.
                <span className="block text-[11px] text-zinc-500">{plan.remainingDays} days remaining.</span>
              </div>
            </div>
          ) : <div className="py-6 text-center text-[12.5px] text-zinc-500">Target not configured for this channel.</div>}
        </Section>
        <Section title={`Required run rate${on}`}>
          {hasT ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[11px] text-zinc-500">Remaining target</div><div className="tabular text-[17px] font-semibold">{inr(plan.remaining)}</div></div>
                <div><div className="text-[11px] text-zinc-500">Days remaining</div><div className="tabular text-[17px] font-semibold">{plan.remainingDays}</div></div>
                <div><div className="text-[11px] text-zinc-500">Required / day</div><div className="tabular text-[17px] font-semibold">{inr(plan.requiredRunRate)}</div></div>
                <div><div className="text-[11px] text-zinc-500">Current MTD / day</div><div className="tabular text-[17px] font-semibold">{inr(plan.currentRunRate)}</div></div>
              </div>
              <div className={cn("rounded-lg px-3 py-2 text-[12px]", plan.runRateGap != null && plan.runRateGap > 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800")}>
                {plan.requiredRunRate == null ? "Month complete." : plan.runRateGap != null && plan.runRateGap > 0 ? `Required run rate is ${pct(plan.runRateGap, 0)} higher than the current pace.` : "Current run rate is sufficient."}
              </div>
            </div>
          ) : <div className="py-6 text-center text-[12.5px] text-zinc-500">Needs a target.</div>}
        </Section>
        <Section title="Month-end projection" tip="Projection — not an actual number">
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-[11px] text-zinc-500">MTD revenue</div><div className="tabular text-[17px] font-semibold">{inr(plan.mtdRevenue)}</div></div>
            <div><div className="text-[11px] text-zinc-500">Avg daily revenue</div><div className="tabular text-[17px] font-semibold">{inr(plan.mtdRevenue / plan.elapsed)}</div></div>
            <div><div className="text-[11px] text-zinc-500">Projected revenue</div><div className="tabular text-[17px] font-semibold">{inr(plan.projected)}</div></div>
            <div><div className="text-[11px] text-zinc-500">Projected achievement</div><div className="tabular text-[17px] font-semibold">{pct(plan.projectedAch, 0)}</div></div>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">Projected{plan.projectedGap != null ? ` gap ${inr(Math.max(plan.projectedGap, 0))}` : " — no target"} · status rules: ahead ≥{pct(ctx.settings.thresholds.ahead, 0)}, on track ≥{pct(ctx.settings.thresholds.onTrack, 0)}, at risk ≥{pct(ctx.settings.thresholds.atRisk, 0)}.</p>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.5fr_1fr]">
        <Section title="Month trend" tip="Cumulative, day of month: this month vs previous month (same day) vs target pace">
          <ExecTrend data={curves} basisLabel={basis} prevLabel={new Date(addMonths(ms, -1) + "T00:00:00Z").toLocaleString("en-IN", { month: "short", timeZone: "UTC" })} />
        </Section>
        <Section title="Contribution">
          <div className="text-[11px] font-medium text-zinc-500">Channel</div>
          <div className="mt-1.5 space-y-1.5">{chanRows.map((c) => (
            <div key={c.key} className="grid grid-cols-[92px_1fr_44px] items-center gap-2 text-[12px]"><span>{c.label}</span><Meter value={c.share} color={CH_COLORS[c.key as ChKey]} /><span className="tabular text-right font-medium">{pct(c.share, 0)}</span></div>
          ))}</div>
          <div className="mt-4 text-[11px] font-medium text-zinc-500">Category</div>
          <div className="mt-1.5 space-y-1.5">{cats.map((c) => (
            <div key={c.c} className="grid grid-cols-[92px_1fr_44px] items-center gap-2 text-[12px]"><span>{catLabel(c.c)}</span><Meter value={safeDiv(c.revenue, catTotal)} color={catColor(c.c)} /><span className="tabular text-right font-medium">{pct(safeDiv(c.revenue, catTotal), 0)}</span></div>
          ))}</div>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Section title="Channel performance" pad={false}>
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Channel", "Revenue", "Growth", "Target", "Achievement", "Contribution"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>{chanRows.map((c) => (
              <tr key={c.key} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                <td className="px-4 py-2.5"><Link href={withQs(ctx, c.key === "stores" ? "/stores" : `/${c.key}`)} className="flex items-center gap-2 font-medium hover:underline"><span className="size-2 rounded-full" style={{ background: CH_COLORS[c.key as ChKey] }} />{c.label}</Link></td>
                <td className="tabular px-4 text-right font-semibold">{inr(c.revenue)}</td><td className="px-4 text-right"><Delta v={c.growth} /></td>
                <td className="tabular px-4 text-right">{c.plan.monthTarget != null ? inr(c.plan.monthTarget) : <span className="text-[11px] text-zinc-400">not configured</span>}</td>
                <td className="tabular px-4 text-right">{c.plan.achievement != null ? pct(c.plan.achievement, 0) : "—"}</td>
                <td className="tabular px-4 text-right">{pct(c.share, 0)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
        <Section title="Category performance" pad={false}>
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Category", "Revenue", "Growth", "Target %", "Contribution", "Inventory"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>{cats.map((c) => (
              <tr key={c.c} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                <td className="px-4 py-2.5"><Link href={withQs(ctx, "/category", { cat: c.c })} className="flex items-center gap-2 font-medium hover:underline"><span className="size-2 rounded-full" style={{ background: catColor(c.c) }} />{catLabel(c.c)}</Link></td>
                <td className="tabular px-4 text-right font-semibold">{inr(c.revenue)}</td><td className="px-4 text-right"><Delta v={c.growth} /></td>
                <td className="tabular px-4 text-right">{c.ach != null ? pct(c.ach, 0) : <span className="text-[11px] text-zinc-400">—</span>}</td>
                <td className="tabular px-4 text-right">{pct(safeDiv(c.revenue, catTotal), 0)}</td><td className="tabular px-4 text-right">{compactNum(c.inv)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Section title="What is driving performance?"><InsightList items={drv} qs={ctx.qs} /></Section>
        <Section title="Risks"><InsightList items={rsk} qs={ctx.qs} empty="No material risks." /></Section>
        <Section title="Opportunities" tip="Calculated potential — estimates, not guaranteed revenue"><InsightList items={opp} qs={ctx.qs} empty="No material opportunities." /></Section>
      </div>
      <div className="mt-3">
        <Section title="Leadership actions" right={<Link href={withQs(ctx, "/actions")} className="text-[11.5px] text-zinc-500 hover:text-ink">Action Centre →</Link>}><InsightList items={lead} qs={ctx.qs} numbered empty="Nothing requires leadership intervention." /></Section>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500"><Tip text="Stores = DSR net; Online/Marketplace = Unicommerce non-cancelled items" /> Stores {num(summarize(sc.facts, range).storesSelling)} selling · data to {fmtDate(ctx.asOf, true)}.</p>
    </>
  );
}
