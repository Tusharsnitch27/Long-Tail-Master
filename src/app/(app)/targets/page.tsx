import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { summarize, monthOutlook, statusCounts, dailySeries } from "@/server/analytics";
import { monthScope } from "@/server/targetsView";
import { catColor, catLabel } from "@/server/views";
import { can } from "@/server/auth";
import { PageHeader, Kpi, KpiGrid, Section, StatusBadge, Notice } from "@/components/ui";
import { MonthPicker } from "@/components/MonthPicker";
import { TrendChart } from "@/components/charts/TrendChart";
import { inr, num, pct } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { safeDiv, targetStatus, STATUS_META } from "@/lib/metrics";

export default async function TargetOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const sc = await monthScope(ctx);
  const th = ctx.settings.thresholds;
  const toDate = { from: sc.ms, to: sc.cutoff };
  const m = sc.hasActuals ? summarize(sc.facts, toDate) : null;
  const full = summarize(sc.facts, { from: sc.ms, to: sc.me });
  const mo = monthOutlook(sc.facts, sc.cutoff);
  const counts = sc.hasActuals ? statusCounts(sc.facts, toDate, th) : null;
  const series = dailySeries(sc.facts, { from: sc.ms, to: sc.me }).map((d) => ({ ...d, sales: d.date <= sc.cutoff ? d.sales : null }));
  const storeOv = new Set(sc.overrides.filter((o) => o.branch_code !== "*").map((o) => `${o.branch_code}|${o.category}`)).size;
  const catOv = sc.overrides.filter((o) => o.branch_code === "*");

  return (
    <>
      <PageHeader title="Target Overview" subtitle={<>{sc.label} · {sc.hasActuals ? `actuals through ${fmtDate(sc.cutoff, true)}` : "future month — targets only"}</>}
        right={<div className="flex items-center gap-2"><MonthPicker months={sc.months} value={sc.ms.slice(0, 7)} />
          {can(ctx.user, "admin") && <Link href={`/targets/setup?m=${sc.ms.slice(0, 7)}`} className="rounded-md bg-zinc-900 px-3 py-1.5 text-[12.5px] font-medium text-white">Edit targets</Link>}</div>} />
      <Notice>Base targets come from Snowflake <b>MTD_TARGET_PERFUMES / MTD_TARGET_SHOES</b> (phased daily per store). {storeOv + catOv.length > 0 ? <>This month has <b>{storeOv}</b> store-level and <b>{catOv.length}</b> category-level overrides from Target Setup applied on top.</> : "No overrides are applied for this month."}</Notice>
      <KpiGrid>
        <Kpi label="Month target" value={inr(full.target)} sub={`${full.storesWithTarget} stores with a target`} />
        <Kpi label="Target to date" value={inr(m?.target ?? null)} sub={pct(safeDiv(m?.target, full.target), 0) + " of month phased so far"} />
        <Kpi label="Achieved" value={inr(m?.sales ?? null)} status={m ? <StatusBadge status={targetStatus(m.sales, m.target, th)} ach={m.ach} /> : undefined} />
        <Kpi label="Gap to date" value={m?.gap == null ? "—" : m.gap > 0 ? inr(m.gap) : `+${inr(-m.gap)}`} />
        <Kpi label="Projected" value={inr(mo.projected)} sub={`${pct(mo.projectedAch, 0)} of month target`} />
        <Kpi label="Required run rate" value={mo.requiredRunRate == null ? "—" : `${inr(mo.requiredRunRate)}/day`} sub={`${mo.remainingDays} days left · now ${inr(mo.currentRunRate)}/day`} />
      </KpiGrid>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Section title="Daily target vs actual">
          <TrendChart data={series} height={260} series={[{ key: "sales", label: "Actual", color: "#5b4fd6" }, { key: "target", label: "Target", color: "#18181b", type: "line", dashed: true }, { key: "ach", label: "Ach %", color: "#10b981", type: "line", axis: "right" }]} />
        </Section>
        <Section title="Store status (month to date)" tip={`Ahead ≥${pct(th.ahead, 0)} · On track ≥${pct(th.onTrack, 0)} · At risk ≥${pct(th.atRisk, 0)} · Behind below. Thresholds are set in Admin → Settings.`}>
          {counts ? (
            <ul className="space-y-2">
              {(Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((k) => {
                const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
                return (
                  <li key={k} className="flex items-center gap-3 text-[13px]">
                    <span className="w-28"><StatusBadge status={k} /></span>
                    <span className="h-2 flex-1 overflow-hidden rounded bg-zinc-100"><span className="block h-full bg-zinc-800" style={{ width: `${(counts[k] / total) * 100}%` }} /></span>
                    <span className="tabular w-16 text-right">{counts[k]} <span className="text-zinc-400">({pct(counts[k] / total, 0)})</span></span>
                  </li>
                );
              })}
            </ul>
          ) : <div className="text-[13px] text-zinc-500">No actuals yet for this month.</div>}
          <Link href={withQs(ctx, "/targets/stores")} className="mt-3 inline-block text-[12px] text-brand-600 hover:underline">Store targets →</Link>
        </Section>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {ctx.filters.cats.map((c) => {
          const fs = sc.facts.filter((f) => f.c === c);
          const cm = sc.hasActuals ? summarize(fs, toDate) : null, cf = summarize(fs, { from: sc.ms, to: sc.me }), co = monthOutlook(fs, sc.cutoff);
          const ov = catOv.find((o) => o.category === c);
          return (
            <Section key={c} title={<span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: catColor(c) }} />{catLabel(c)}</span>}>
              <dl className="grid grid-cols-3 gap-3 text-[12.5px]">
                <div><dt className="text-zinc-500">Month target</dt><dd className="tabular text-[15px] font-semibold">{inr(cf.target)}</dd>{ov && <div className="text-[11px] text-amber-700">Category override {inr(ov.target)}</div>}</div>
                <div><dt className="text-zinc-500">Achieved to date</dt><dd className="tabular text-[15px] font-semibold">{inr(cm?.sales ?? null)}</dd><div className="text-[11px] text-zinc-500">{pct(cm?.ach ?? null, 0)} of {inr(cm?.target ?? null)}</div></div>
                <div><dt className="text-zinc-500">Projected</dt><dd className="tabular text-[15px] font-semibold">{inr(co.projected)}</dd><div className="text-[11px] text-zinc-500">need {inr(co.requiredRunRate)}/day</div></div>
                <div><dt className="text-zinc-500">Units</dt><dd className="tabular font-semibold">{num(cm?.qty ?? null)}</dd></div>
                <div><dt className="text-zinc-500">Stores with target</dt><dd className="tabular font-semibold">{cf.storesWithTarget}</dd></div>
                <div><dt className="text-zinc-500">Avg target / store / day</dt><dd className="tabular font-semibold">{inr(safeDiv(cf.target, cf.storesWithTarget * cf.days))}</dd></div>
              </dl>
            </Section>
          );
        })}
      </div>
    </>
  );
}
