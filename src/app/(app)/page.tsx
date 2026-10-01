import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadScope, productPerformance } from "@/server/scope";
import { channelMetrics, CH_LABEL, type ChKey } from "@/server/channelData";
import { buildActions } from "@/server/actions";
import { computePlan, dailyTarget, EXEC_LABEL, type PlanChannel } from "@/server/plan";
import { drivers, risks, opportunities } from "@/server/executive";
import { getTargetBook } from "@/server/data/targetBook";
import { summarize } from "@/server/analytics";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Section, Delta, DataPrompt, Pill, achTone, Tip, MixBar } from "@/components/ui";
import { ChartDownload } from "@/components/charts/ChartDownload";
import { InsightList } from "@/components/Insights";
import { DailyTargetChart } from "@/components/charts/DailyTargetChart";
import { SkuTabs, type SkuTab } from "@/components/SkuTabs";
import { compactNum, inr, num, pct } from "@/lib/format";
import { addDays, addMonths, eachDay, endOfMonth, fmtDate, fmtRange, monthsBetween, startOfMonth, inRange, type Range } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { CH_COLORS } from "@/lib/colors";
import { cn } from "@/lib/cn";
import type { Fact } from "@/server/data/facts";
import type { ChannelDay } from "@/server/data/channels";
import { ucChannel } from "@/server/channelData";

const STATUS_TONE = { ahead: "good", on_track: "good", at_risk: "warn", behind: "bad", no_target: "muted" } as const;

/** MRP value of what was sold (for discount %): Stores = DSR MRP sales, Online / Marketplace = item MRP. */
function mrpValue(facts: Fact[], uc: ChannelDay[], r: Range, ch: PlanChannel, mp: string | null) {
  let v = 0;
  if (ch === "all" || ch === "stores") v += summarize(facts, r).mrp;
  for (const x of uc) { const k = ucChannel(x.mp); if (k && inRange(x.d, r) && (ch === "all" || ch === k) && (!mp || x.mp === mp)) v += x.mrp; }
  return v;
}

export default async function ExecutiveSummary({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const { range, compare } = ctx.period;
  const ch: PlanChannel = ctx.filters.channel;
  const mp = ctx.filters.mp;
  const ms = startOfMonth(ctx.asOf), pms = addMonths(ms, -1);
  // daily chart window: last 30 days by default; 7 / 60 / 90 / MTD / the selected period on request
  const DR = [{ k: "7", l: "7D" }, { k: "30", l: "30D" }, { k: "60", l: "60D" }, { k: "90", l: "90D" }, { k: "mtd", l: "MTD" }, { k: "period", l: "Period" }];
  const dr = DR.some((x) => x.k === ctx.sp.dr) ? String(ctx.sp.dr) : "30";
  const last30: Range = dr === "mtd" ? { from: ms, to: ctx.asOf } : dr === "period" ? { from: range.from, to: range.to > ctx.asOf ? ctx.asOf : range.to } : { from: addDays(ctx.asOf, -(Number(dr) - 1)), to: ctx.asOf };
  const sc = await loadScope(ctx, [{ from: pms, to: addDays(ms, -1) }, { from: addDays(last30.from, -7), to: last30.to }]);
  const chartMonths = monthsBetween(last30.from, last30.to);
  const whUnits = (s: string) => sc.wh.bySku.get(s)?.units ?? 0;
  const [act, book, perf] = await Promise.all([buildActions(ctx), getTargetBook(chartMonths[0] < pms ? chartMonths[0] : pms, ms), productPerformance(ctx, sc.pm, whUnits, ch, mp)]);
  const th = ctx.settings.thresholds;
  const plan = computePlan(sc.facts, sc.uc, ctx.asOf, ch, book, ctx.filters.cats, th);
  const monthPlans = new Map(chartMonths.map((mo) => [mo, mo === ms ? null : computePlan(sc.facts, sc.uc, endOfMonth(mo), ch, book, ctx.filters.cats, th)]));
  const m = channelMetrics(sc.facts, sc.uc, range, ch, mp), p = channelMetrics(sc.facts, sc.uc, compare, ch, mp);
  const hasT = plan.monthTarget != null;
  const admin = ctx.user?.role === "admin";

  // daily revenue vs target, last 30 days
  const daily = eachDay(last30.from, last30.to).map((d) => {
    const x = channelMetrics(sc.facts, sc.uc, { from: d, to: d }, ch, mp);
    const lw = channelMetrics(sc.facts, sc.uc, { from: addDays(d, -7), to: addDays(d, -7) }, ch, mp).revenue;
    return { date: d, actual: x.revenue, units: x.units, lw, target: dailyTarget(d >= ms ? plan : monthPlans.get(startOfMonth(d)) ?? plan, sc.facts, book, d) };
  });

  // category comparison
  const cats = ctx.filters.cats.map((c) => {
    const f = sc.facts.filter((x) => x.c === c), u = sc.uc.filter((x) => x.c === c);
    const cm = channelMetrics(f, u, range, ch, mp), cp = channelMetrics(f, u, compare, ch, mp);
    const cplan = computePlan(f, u, ctx.asOf, ch, book, [c], th);
    const mrp = mrpValue(f, u, range, ch, mp);
    const split = (["stores", "online", "marketplace"] as ChKey[]).map((k) => ({ k, rev: channelMetrics(f, u, range, k).revenue }));
    const prods = sc.products.filter((x) => x.category === c);
    const store = prods.reduce((a, x) => a + (x.invOffline ?? 0), 0);
    const wh = prods.reduce((a, x) => a + whUnits(x.sku), 0);
    const north = prods.reduce((a, x) => a + (sc.wh.bySku.get(x.sku)?.byZone.North ?? 0), 0);
    const l30 = perf.rows.filter((r) => r.category === c).reduce((a, r) => a + r.l30Units, 0);
    return { c, rev: cm.revenue, units: cm.units, growth: growth(cm.revenue, cp.revenue), asp: cm.asp, disc: mrp > 0 ? 1 - cm.revenue / mrp : null, plan: cplan, split, store, wh, north, l30, doi: l30 > 0 ? (store + wh) / (l30 / 30) : null };
  });
  const catTot = cats.reduce((a, x) => a + x.rev, 0);

  // SKU lists
  const byCat = (rows: typeof perf.rows) => ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), rows: rows.filter((r) => r.category === c) }));
  const toRow = (r: (typeof perf.rows)[number], note?: string | null, tone?: "good" | "bad" | "warn" | null) => ({ sku: r.sku, name: r.name, image: r.image, revenue: r.revenue, units: r.units, growth: r.growth, note, tone });
  const topTabs: SkuTab[] = byCat(perf.rows.filter((r) => r.units > 0)).map((t) => ({ ...t, rows: t.rows.slice(0, 10).map((r) => toRow(r, `${num((r.storeInv ?? 0) + r.whInv)} in stock (${num(r.storeInv ?? 0)} store · ${num(r.whInv)} WH)${r.doi != null ? ` · ${num(r.doi)}d cover` : ""}`, r.doi != null && r.doi < 14 ? "bad" : null)) }));
  const bottomTabs: SkuTab[] = byCat(perf.rows.filter((r) => (r.storeInv ?? 0) + r.whInv >= 30 && (r.p?.daysSinceLive ?? 999) >= 45))
    .map((t) => ({ ...t, rows: [...t.rows].sort((a, b) => a.l30Units / ((a.storeInv ?? 0) + a.whInv) - b.l30Units / ((b.storeInv ?? 0) + b.whInv)).slice(0, 10).map((r) => toRow(r, `${num((r.storeInv ?? 0) + r.whInv)} in stock (${num(r.storeInv ?? 0)} store · ${num(r.whInv)} WH) · ${num(r.l30Units)} sold L30`, "warn")) }));
  const riskRows = perf.rows.filter((r) => r.l30Units >= 15 && ((r.doi != null && r.doi < 21) || (r.p7 > 0 && r.l7 / r.p7 < 0.6)));
  const riskTabs: SkuTab[] = byCat(riskRows).map((t) => ({ ...t, rows: t.rows.slice(0, 10).map((r) => toRow(r, `${r.doi != null && r.doi < 21 ? `only ${num(r.doi)} days of cover` : `L7 ${pct(r.l7 / r.p7 - 1, 0)} vs prior week`} · ${num(r.storeInv ?? 0)} store · ${num(r.whInv)} WH`, "bad")) }));

  const drv = drivers(ctx, sc.facts, sc.uc, range, compare, ch).slice(0, 3);
  const rsk = risks(ctx, plan, sc.facts, sc.uc, range, act.actions).slice(0, 3);
  const opp = opportunities(act.actions, perf.rows.filter((r) => r.l30Units / 30 >= 1).reduce((a, r) => a + r.whInv, 0)).slice(0, 3);
  const chLabel = ch === "all" ? "Overall" : CH_LABEL[ch] + (mp ? ` · ${mp[0] + mp.slice(1).toLowerCase()}` : "");
  const tgtHref = admin ? "/settings?tab=targets" : undefined;

  return (
    <>
      <PageHeader title="Executive Summary"
        subtitle={<>{ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories"} · {chLabel} · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel} · month plan as of {fmtDate(ctx.asOf, true)}</span></>}
        right={<span className={cn("flex items-center gap-2 rounded-xl px-3 py-1.5 text-[13px] font-semibold ring-1", { good: "bg-emerald-50 text-emerald-800 ring-emerald-200", warn: "bg-amber-50 text-amber-800 ring-amber-200", bad: "bg-rose-50 text-rose-700 ring-rose-200", muted: "bg-zinc-100 text-zinc-600 ring-zinc-200" }[STATUS_TONE[plan.status]])}>
          <span className="size-2 rounded-full bg-current" />{EXEC_LABEL[plan.status]}{plan.projectedAch != null ? ` · ${pct(plan.projectedAch, 0)} projected` : ""}</span>} />
      {plan.missingPairs.length > 0 && (
        <div className="mb-3"><DataPrompt compact title={hasT ? `Targets missing for ${plan.missingPairs.length} channel × category slice${plan.missingPairs.length > 1 ? "s" : ""}` : "No target set for this selection"} href={tgtHref} cta="Set targets">
          {plan.missingPairs.slice(0, 6).join(", ")}{plan.missingPairs.length > 6 ? ` +${plan.missingPairs.length - 6} more` : ""}. {hasT ? "Target, gap and achievement cover only the slices that have a target." : ""}{!admin && " Ask an admin to add them in the Control Centre."}
        </DataPrompt></div>
      )}
      {plan.mismatches.length > 0 && (
        <div className="mb-3"><DataPrompt compact title="Store targets don’t add up to the plan" href={tgtHref} cta="Review">
          {plan.mismatches.map((x) => `${catLabel(x.c)}: plan ${inr(x.catTarget)} vs Σ store targets ${inr(x.storeSum)}`).join(" · ")}. The plan is used; align store targets in the Control Centre (Store targets tab).
        </DataPrompt></div>
      )}

      <KpiGrid cols={8}>
        <Kpi label="Revenue" value={inr(m.revenue)} delta={growth(m.revenue, p.revenue)} deltaLabel="vs comparable" />
        <Kpi label="Target · MTD" value={hasT ? inr(plan.mtdTarget) : "Not set"} sub={hasT ? `month ${inr(plan.monthTarget)}` : "configure in Control Centre"} tip="Phased target to date for slices with a target" />
        <Kpi label="Gap to target · MTD" value={hasT ? inr(Math.abs(plan.gapToDate ?? 0)) : "—"} sub={hasT ? ((plan.gapToDate ?? 0) > 0 ? "behind" : "ahead") : undefined} tone={hasT ? ((plan.gapToDate ?? 0) > 0 ? "bad" : "good") : undefined} />
        <Kpi label="Achievement · MTD" value={pct(plan.achievement, 1)} tone={hasT ? achTone(plan.achievement, th) : undefined} sub={hasT ? `${pct(plan.expectedPct, 0)} of month phased` : undefined} />
        <Kpi label="Month-end projection" value={inr(plan.projected)} sub="projection · not actual" tip="Target slices: MTD achievement × month target. Others: current daily rate × days in month." />
        <Kpi label="Projected achievement" value={pct(plan.projectedAch, 0)} tone={hasT ? achTone(plan.projectedAch, th) : undefined} sub={plan.projectedGap != null ? (plan.projectedGap > 0 ? `${inr(plan.projectedGap)} short` : `${inr(-plan.projectedGap)} over`) : undefined} />
        <Kpi label="Required run rate" value={hasT ? inr(plan.requiredRunRate) : "—"} sub={<>{plan.remainingDays} days remaining{hasT && plan.runRateGap != null ? <> · <span className={plan.runRateGap > 0 ? "text-rose-600" : "text-emerald-700"}>{plan.runRateGap > 0 ? "+" : ""}{pct(plan.runRateGap, 0)} vs now</span></> : null}</>} tip={`Current: ${inr(plan.currentRunRate)}/day`} />
        <Kpi label="ASP" value={inr(m.asp, { compact: false })} delta={growth(m.asp, p.asp)} />
      </KpiGrid>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <Section title={`Daily revenue vs target · ${dr === "mtd" ? "month to date" : dr === "period" ? fmtRange(last30) : `last ${dr} days`}`} tip="Bars coloured by achievement of that day's phased target"
          right={<div className="flex gap-0.5 rounded-lg border border-line p-0.5">{DR.map((x) => <Link key={x.k} scroll={false} href={withQs(ctx, "/", { dr: x.k === "30" ? null : x.k })} className={cn("rounded-md px-2 py-0.5 text-[11.5px]", dr === x.k ? "bg-brand-900 font-medium text-white" : "text-zinc-600 hover:bg-brand-50")}>{x.l}</Link>)}</div>}>
          <DailyTargetChart name={`daily-revenue-vs-target-${dr}`} data={daily} height={250} />
        </Section>
        <Section title="Channel contribution by category" tip="Share of each category's revenue in the selected period — hover a bar for the split" right={<ChartDownload name="channel-contribution-by-category" data={cats.map((c) => ({ category: catLabel(c.c), ...Object.fromEntries(c.split.map((x) => [x.k, x.rev])) }))} columns={[{ key: "category", label: "Category" }, { key: "stores", label: "Stores" }, { key: "online", label: "Online" }, { key: "marketplace", label: "Marketplace" }]} />}>
          <div className="space-y-2.5">
            {cats.map((c) => (
              <div key={c.c}>
                <div className="mb-1 flex items-baseline justify-between text-[12px]"><Link href={withQs(ctx, "/category", { cat: c.c })} className="flex items-center gap-1.5 font-medium hover:underline"><span className="size-2 rounded-full" style={{ background: catColor(c.c) }} />{catLabel(c.c)}</Link><span className="tabular text-zinc-500">{inr(c.split.reduce((a, x) => a + x.rev, 0))}</span></div>
                <MixBar barClass="h-5 rounded-md" labelMin={0.12} title={`${catLabel(c.c)} · channel split`} parts={c.split.map((x) => ({ label: CH_LABEL[x.k], value: x.rev, color: CH_COLORS[x.k] }))} />
              </div>
            ))}
            <div className="flex gap-3 pt-1 text-[11px] text-zinc-500">{(["stores", "online", "marketplace"] as ChKey[]).map((k) => <span key={k} className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: CH_COLORS[k] }} />{CH_LABEL[k]}</span>)}</div>
          </div>
        </Section>
      </div>

      <div className="mt-3">
        <Section title="Category comparison" pad={false} tip="Revenue, units, ASP and discount for the selected period; target, achievement, gap and projection are month-to-date">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead><tr className="border-b border-line text-[11px] text-zinc-500">
                {["Category", "Revenue", "Growth", "Units", "ASP", "Discount", "Share", "Target · MTD", "Achievement", "Gap · MTD", "Projection", "Proj. achievement"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}
              </tr></thead>
              <tbody>{cats.map((c) => {
                const t = c.plan.monthTarget != null;
                return (
                  <tr key={c.c} className="border-b border-brand-50 last:border-0 hover:bg-brand-50/40">
                    <td className="px-4 py-2.5"><Link href={withQs(ctx, "/category", { cat: c.c })} className="flex items-center gap-2 font-medium hover:underline"><span className="size-2 rounded-full" style={{ background: catColor(c.c) }} />{catLabel(c.c)}</Link></td>
                    <td className="tabular px-4 text-right font-semibold">{inr(c.rev)}</td><td className="px-4 text-right"><Delta v={c.growth} /></td>
                    <td className="tabular px-4 text-right">{num(c.units)}</td><td className="tabular px-4 text-right">{inr(c.asp, { compact: false })}</td>
                    <td className="tabular px-4 text-right">{pct(c.disc, 1)}</td><td className="tabular px-4 text-right">{pct(safeDiv(c.rev, catTot), 0)}</td>
                    {t ? (<>
                      <td className="tabular px-4 text-right">{inr(c.plan.mtdTarget)}</td>
                      <td className="px-4 text-right"><Pill tone={achTone(c.plan.achievement, th)}>{pct(c.plan.achievement, 0)}</Pill></td>
                      <td className={cn("tabular px-4 text-right", (c.plan.gapToDate ?? 0) > 0 ? "text-rose-600" : "text-emerald-700")}>{(c.plan.gapToDate ?? 0) > 0 ? inr(c.plan.gapToDate) : `+${inr(-(c.plan.gapToDate ?? 0))}`}</td>
                      <td className="tabular px-4 text-right">{inr(c.plan.projected)}</td>
                      <td className="px-4 text-right"><Pill tone={achTone(c.plan.projectedAch, th)}>{pct(c.plan.projectedAch, 0)}</Pill></td>
                    </>) : (<>
                      <td colSpan={3} className="px-4 text-right">{admin ? <Link href="/settings?tab=targets" className="text-[11.5px] font-medium text-brand-700 hover:underline">Set target →</Link> : <span className="text-[11.5px] text-zinc-400">Target not set</span>}</td>
                      <td className="tabular px-4 text-right">{inr(c.plan.projected)}</td><td className="px-4 text-right text-zinc-400">—</td>
                    </>)}
                  </tr>
                );
              })}</tbody>
              {cats.length > 1 && (() => {
                const units = cats.reduce((a, c) => a + c.units, 0);
                const withT = cats.filter((c) => c.plan.monthTarget != null);
                const t = withT.reduce((a, c) => a + (c.plan.mtdTarget ?? 0), 0), cov = withT.reduce((a, c) => a + c.plan.coveredRevenue, 0);
                const proj = cats.reduce((a, c) => a + c.plan.projected, 0), mt = withT.reduce((a, c) => a + (c.plan.monthTarget ?? 0), 0);
                const projCov = withT.reduce((a, c) => a + (c.plan.projectedAch ?? 0) * (c.plan.monthTarget ?? 0), 0);
                return (
                  <tfoot><tr className="border-t border-line bg-brand-50/50 font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    <td className="tabular px-4 text-right">{inr(catTot)}</td><td className="px-4 text-right"><Delta v={growth(m.revenue, p.revenue)} /></td>
                    <td className="tabular px-4 text-right">{num(units)}</td><td className="tabular px-4 text-right">{inr(safeDiv(catTot, units), { compact: false })}</td>
                    <td className="px-4 text-right text-zinc-400">—</td><td className="tabular px-4 text-right">100%</td>
                    <td className="tabular px-4 text-right">{t ? inr(t) : "—"}</td>
                    <td className="px-4 text-right">{t ? <Pill tone={achTone(cov / t, th)}>{pct(cov / t, 0)}</Pill> : "—"}</td>
                    <td className={cn("tabular px-4 text-right", t - cov > 0 ? "text-rose-600" : "text-emerald-700")}>{t ? (t - cov > 0 ? inr(t - cov) : `+${inr(cov - t)}`) : "—"}</td>
                    <td className="tabular px-4 text-right">{inr(proj)}</td>
                    <td className="px-4 text-right">{mt ? <Pill tone={achTone(projCov / mt, th)}>{pct(projCov / mt, 0)}</Pill> : "—"}</td>
                  </tr></tfoot>
                );
              })()}
            </table>
          </div>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Section title="What is driving performance"><InsightList items={drv} qs={ctx.qs} /></Section>
        <Section title="Key risks"><InsightList items={rsk} qs={ctx.qs} empty="No material risks." /></Section>
        <Section title="Opportunities" tip="Calculated potential — estimates, not guaranteed revenue"><InsightList items={opp} qs={ctx.qs} empty="No material opportunities." /></Section>
      </div>

      <div className="mt-3">
        <Section title="Inventory and days of cover by category" pad={false} tip="Store = latest store report (live); Warehouse = live (North: SAPL-NORTH-TAURU, South: SAPL-WH1 + SAPL-WH2). Days of cover = total ÷ L30 daily units, all channels.">
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Category", "Store", "Warehouse", "North · South", "Total", "L30 units", "Days of cover"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>{cats.map((c) => (
              <tr key={c.c} className="border-b border-brand-50 last:border-0">
                <td className="px-4 py-2"><span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: catColor(c.c) }} />{catLabel(c.c)}</span></td>
                <td className="tabular px-4 text-right">{compactNum(c.store)}</td><td className="tabular px-4 text-right">{compactNum(c.wh)}</td>
                <td className="tabular px-4 text-right text-zinc-500">{compactNum(c.north)} · {compactNum(c.wh - c.north)}</td>
                <td className="tabular px-4 text-right font-semibold">{compactNum(c.store + c.wh)}</td><td className="tabular px-4 text-right">{num(c.l30)}</td>
                <td className="px-4 text-right">{c.doi != null ? <Pill tone={c.doi < 21 ? "bad" : c.doi > 180 ? "warn" : "good"}>{num(c.doi)} days</Pill> : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Section title={`Top 10 SKUs · ${chLabel}`} tip="By revenue in the selected period"><SkuTabs tabs={topTabs} qs={ctx.qs} /></Section>
        <Section title="Bottom SKUs" tip="Stocked (≥30 units) products live ≥45 days with the lowest 30-day sell-through"><SkuTabs tabs={bottomTabs} qs={ctx.qs} empty="No slow products with meaningful stock." /></Section>
        <Section title="At-risk SKUs" tip="Selling ≥15 units in 30 days and either under 21 days of cover or down >40% week on week"><SkuTabs tabs={riskTabs} qs={ctx.qs} empty="No at-risk products." /></Section>
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-500"><Tip text="Stores = DSR (gross sales) for Perfumes / Shoes, store sales lines for other categories; Online / Marketplace = Unicommerce items incl. cancellations" /> Data to {fmtDate(ctx.asOf, true)}. Targets from the Control Centre plan; all figures are gross sales (before returns).</p>
    </>
  );
}
