import { pageContext, loadFacts, type SP } from "@/server/context";
import { summarize, monthOutlook, statusCounts } from "@/server/analytics";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Section, StatusBadge } from "@/components/ui";
import { TrendChart } from "@/components/charts/TrendChart";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num, pct } from "@/lib/format";
import { addDays, addMonths, eachDay, endOfMonth, fmtDate, minDate, startOfMonth } from "@/lib/dates";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";

const MONTH = (d: string) => new Date(d + "T00:00:00Z").toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export default async function Mtd({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const a = ctx.asOf;
  const ms = startOfMonth(a), me = endOfMonth(a);
  const pm = addMonths(ms, -1);
  const day = Number(a.slice(8, 10));
  const sixBack = addMonths(ms, -5);
  const facts = await loadFacts(ctx, [{ from: sixBack, to: me }]);
  const mtd = { from: ms, to: a };
  const pmSame = { from: pm, to: minDate(addDays(pm, day - 1), endOfMonth(pm)) };
  const pmFull = { from: pm, to: endOfMonth(pm) };
  const m = summarize(facts, mtd);
  const ps = summarize(facts, pmSame);
  const pf = summarize(facts, pmFull);
  const mo = monthOutlook(facts, a);
  const th = ctx.settings.thresholds;
  const counts = statusCounts(facts, mtd, th);

  // cumulative by day-of-month
  let cs = 0, ct = 0, cp = 0;
  const pmDays = eachDay(pm, endOfMonth(pm));
  const cur = new Map<string, { s: number; t: number }>();
  for (const f of facts) {
    if (f.d < ms || f.d > me) continue;
    const e = cur.get(f.d) ?? { s: 0, t: 0 }; e.s += f.d <= a ? f.s : 0; e.t += f.t ?? 0; cur.set(f.d, e);
  }
  const prevByDay = new Map<string, number>();
  for (const f of facts) if (f.d >= pm && f.d <= endOfMonth(pm)) prevByDay.set(f.d, (prevByDay.get(f.d) ?? 0) + f.s);
  const cumulative = eachDay(ms, me).map((d, i) => {
    const e = cur.get(d) ?? { s: 0, t: 0 };
    ct += e.t; if (d <= a) cs += e.s;
    if (pmDays[i]) cp += prevByDay.get(pmDays[i]) ?? 0;
    return { day: String(i + 1), actual: d <= a ? cs : null, target: ct, prev: pmDays[i] ? cp : null, projected: d > a && mo.mtdTarget ? (ct * mo.mtdSales) / mo.mtdTarget : null };
  });

  const contrib = ctx.filters.cats.map((c) => {
    const fs = facts.filter((f) => f.c === c);
    const cm = summarize(fs, mtd), cp2 = summarize(fs, pmSame), co = monthOutlook(fs, a);
    return { c, label: catLabel(c), sales: cm.sales, share: safeDiv(cm.sales, m.sales), target: cm.target, ach: cm.ach, status: targetStatus(cm.sales, cm.target, th),
      prev: cp2.sales, growth: growth(cm.sales, cp2.sales), qty: cm.qty, stores: cm.storesSelling, monthTarget: co.monthTarget, projected: co.projected, projectedAch: co.projectedAch, rrr: co.requiredRunRate };
  });

  const months = Array.from({ length: 6 }, (_, i) => addMonths(ms, -i));
  const hist = months.map((mm) => {
    const isCur = mm === ms;
    const r = { from: mm, to: isCur ? a : endOfMonth(mm) };
    const s = summarize(facts, r);
    const full = summarize(facts, { from: mm, to: endOfMonth(mm) });
    return { month: MONTH(mm), period: isCur ? `Partial · 1–${day}` : "Complete", sales: s.sales, target: s.target, monthTarget: full.target, ach: s.ach,
      qty: s.qty, bills: s.bills, stores: s.storesSelling, spsd: s.salesPerStoreDay, asp: s.asp };
  });
  const histCols: Col[] = [
    { key: "month", label: "Month" }, { key: "period", label: "Period" },
    { key: "sales", label: "Revenue", type: "inr", bar: true }, { key: "target", label: "Target (period)", type: "inr" }, { key: "monthTarget", label: "Full-month target", type: "inr" },
    { key: "ach", label: "Ach %", type: "ach" }, { key: "qty", label: "Units", type: "num" }, { key: "bills", label: "Bills", type: "num" },
    { key: "stores", label: "Stores selling", type: "num" }, { key: "spsd", label: "Sales/store/day", type: "inr" }, { key: "asp", label: "ASP", type: "inrFull" },
  ];

  return (
    <>
      <PageHeader title="MTD Performance" subtitle={<>{MONTH(ms)} · 1–{day} ({day} of {Number(me.slice(8))} days) · data through {fmtDate(a, true)}</>} />
      <KpiGrid>
        <Kpi label="MTD revenue" value={inr(m.sales)} delta={growth(m.sales, ps.sales)} deltaLabel={`vs ${MONTH(pm)} 1–${day}`} />
        <Kpi label="MTD target" value={inr(m.target)} status={<StatusBadge status={targetStatus(m.sales, m.target, th)} ach={m.ach} />} />
        <Kpi label="Month target" value={inr(mo.monthTarget)} sub={`${inr(Math.max((mo.monthTarget ?? 0) - m.sales, 0))} remaining`} />
        <Kpi label="Projected month-end" value={inr(mo.projected)} sub={`${pct(mo.projectedAch, 0)} of target`} tip="MTD achievement × full-month phased target" />
        <Kpi label="Required run rate" value={mo.requiredRunRate == null ? "—" : `${inr(mo.requiredRunRate)}/day`} sub={`current ${inr(mo.currentRunRate)}/day · ${mo.remainingDays}d left`} />
        <Kpi label="Stores on/above target" value={`${counts.ahead + counts.on_track} / ${m.stores}`} sub={`${counts.at_risk} at risk · ${counts.behind} behind`} />
      </KpiGrid>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Kpi label={`${MONTH(pm)} same days (1–${day})`} value={inr(ps.sales)} sub={<>Partial-period comparison · achievement {pct(ps.ach, 0)}</>} />
        <Kpi label={`${MONTH(pm)} complete month`} value={inr(pf.sales)} sub={<>Complete period · {pct(pf.ach, 0)} of {inr(pf.target)} · MTD is {pct(safeDiv(m.sales, pf.sales), 0)} of it</>} />
        <Kpi label="MTD units" value={num(m.qty)} delta={growth(m.qty, ps.qty)} sub={`${num(m.bills)} bills · ASP ${inr(m.asp, { compact: false })}`} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Section title="Cumulative revenue vs target" tip="Dashed purple = projection if the MTD achievement rate holds. Grey = previous month (same day-of-month).">
          <TrendChart data={cumulative} xKey="day" xIsDate={false} height={270} series={[
            { key: "actual", label: "MTD actual", color: "#5b4fd6", type: "line" },
            { key: "projected", label: "Projection", color: "#5b4fd6", type: "line", dashed: true },
            { key: "target", label: "Target", color: "#18181b", type: "line", dashed: true },
            { key: "prev", label: MONTH(pm), color: "#a1a1aa", type: "line" },
          ]} />
        </Section>
        <Section title="Category contribution" pad={false}>
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead><tr className="border-b border-zinc-200 text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2 text-left">Category</th><th className="px-2 text-right">MTD</th><th className="px-2 text-right">Share</th><th className="px-2 text-right">Ach</th><th className="px-2 text-right">vs PM</th><th className="px-4 text-right">Projected</th>
            </tr></thead>
            <tbody>
              {contrib.map((c) => (
                <tr key={c.c} className="border-b border-zinc-100">
                  <td className="px-4 py-2"><span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: catColor(c.c) }} />{c.label}<div className="mt-0.5"><StatusBadge status={c.status} ach={c.ach} /></div></td>
                  <td className="tabular px-2 text-right font-medium">{inr(c.sales)}</td>
                  <td className="tabular px-2 text-right">{pct(c.share, 0)}</td>
                  <td className="tabular px-2 text-right">{pct(c.ach, 0)}</td>
                  <td className={`tabular px-2 text-right ${c.growth != null && c.growth < 0 ? "text-rose-700" : "text-emerald-700"}`}>{c.growth == null ? "—" : `${(c.growth * 100).toFixed(1)}%`}</td>
                  <td className="tabular px-4 text-right">{inr(c.projected)}<div className="text-[11px] text-zinc-500">{pct(c.projectedAch, 0)} · need {inr(c.rrr)}/d</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
      <div className="mt-4">
        <DataTable title="Monthly history" rows={hist} columns={histCols} csvName="monthly-history" height={320} />
      </div>
    </>
  );
}
