import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { dailySeries, groupFacts, summarize } from "@/server/analytics";
import { monthScope } from "@/server/targetsView";
import { PageHeader, Section } from "@/components/ui";
import { MonthPicker } from "@/components/MonthPicker";
import { DataTable, type Col } from "@/components/table/DataTable";
import { eachDay, weekday } from "@/lib/dates";
import { inr, pct } from "@/lib/format";
import { safeDiv, targetStatus } from "@/lib/metrics";
import { cn } from "@/lib/cn";

export default async function DailyTargets({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const sc = await monthScope(ctx);
  const th = ctx.settings.thresholds;
  const days = eachDay(sc.ms, sc.me);
  const byDate = new Map(dailySeries(sc.facts, { from: sc.ms, to: sc.me }).map((d) => [d.date, d]));
  const perStore = groupFacts(sc.facts, (f) => f.b);

  // store-day hit counts
  const hit = new Map<string, { hit: number; miss: number }>();
  const grid: { b: string; store: string; cells: { d: string; ach: number | null; s: number; t: number | null }[]; ach: number | null }[] = [];
  for (const [b, fs] of perStore) {
    const byD = groupFacts(fs, (f) => f.d);
    const cells = days.map((d) => {
      const x = byD.get(d) ?? [];
      const s = x.reduce((a, f) => a + f.s, 0), tt = x.reduce((a, f) => a + (f.t ?? 0), 0);
      if (d <= sc.cutoff && tt > 0) { const h = hit.get(d) ?? { hit: 0, miss: 0 }; if (s >= tt) h.hit++; else h.miss++; hit.set(d, h); }
      return { d, s, t: tt || null, ach: d <= sc.cutoff ? safeDiv(s, tt || null) : null };
    });
    const m = summarize(fs, { from: sc.ms, to: sc.cutoff });
    if ((m.target ?? 0) <= 0 && m.sales === 0) continue;
    grid.push({ b, store: ctx.byCode.get(b)?.short_name ?? `Branch ${b}`, cells, ach: m.ach });
  }
  grid.sort((a, b) => (a.ach ?? -1) - (b.ach ?? -1));

  const rows = days.map((d) => {
    const x = byDate.get(d)!;
    const h = hit.get(d);
    const past = d <= sc.cutoff;
    return { date: d, dow: weekday(d), target: x.target, sales: past ? x.sales : null, ach: past ? x.ach : null, status: past ? targetStatus(x.sales, x.target, th) : "no_target",
      gap: past && x.target != null ? x.target - x.sales : null, hit: h?.hit ?? null, miss: h?.miss ?? null, hitRate: h ? safeDiv(h.hit, h.hit + h.miss) : null, qty: past ? x.qty : null };
  });
  const cols: Col[] = [
    { key: "date", label: "Date", type: "date", sub: "dow" }, { key: "target", label: "Target", type: "inr", bar: true }, { key: "sales", label: "Actual", type: "inr" },
    { key: "ach", label: "Ach %", type: "ach" }, { key: "status", label: "Status", type: "status" }, { key: "gap", label: "Gap", type: "inr" }, { key: "qty", label: "Units", type: "num" },
    { key: "hit", label: "Stores hit", type: "num", tip: "Stores whose sales ≥ that day’s target" }, { key: "miss", label: "Stores missed", type: "num" }, { key: "hitRate", label: "Hit rate", type: "pct" },
  ];
  const cellCls = (a: number | null, t: number | null) =>
    a == null ? (t ? "bg-zinc-50 text-zinc-300" : "bg-white text-zinc-200") : a >= th.ahead ? "bg-emerald-500 text-white" : a >= th.onTrack ? "bg-emerald-200" : a >= th.atRisk ? "bg-amber-200" : a > 0 ? "bg-rose-200" : "bg-rose-400 text-white";

  return (
    <>
      <PageHeader title="Daily Targets" subtitle={<>{sc.label} · phased daily targets (weekends carry more) vs actual</>} right={<MonthPicker months={sc.months} value={sc.ms.slice(0, 7)} />} />
      <DataTable rows={rows} columns={cols} csvName={`daily-targets-${sc.ms.slice(0, 7)}`} height={420} />
      <div className="mt-4">
        <Section title="Store × day achievement" tip="Each cell = store's long-tail sales ÷ that day's target. Sorted weakest first. Hover a cell for values." pad={false}>
          <div className="max-h-[640px] overflow-auto scroll-thin">
            <table className="border-separate border-spacing-0 text-[11px]">
              <thead className="sticky top-0 z-10 bg-white">
                <tr>
                  <th className="sticky left-0 z-20 min-w-[190px] bg-white px-3 py-1.5 text-left">Store</th>
                  <th className="px-1 text-right">MTD</th>
                  {days.map((d) => <th key={d} className={cn("w-8 px-0.5 text-center font-medium", ["Sat", "Sun"].includes(weekday(d)) ? "text-brand-600" : "text-zinc-500")}>{Number(d.slice(8))}<div className="text-[9px]">{weekday(d)[0]}</div></th>)}
                </tr>
              </thead>
              <tbody>
                {grid.map((r) => (
                  <tr key={r.b}>
                    <td className="sticky left-0 z-[1] truncate border-b border-zinc-100 bg-white px-3 py-0.5"><Link className="hover:underline" href={withQs(ctx, `/stores/${r.b}`)}>{r.store}</Link></td>
                    <td className="tabular border-b border-zinc-100 px-1 text-right font-medium">{pct(r.ach, 0)}</td>
                    {r.cells.map((c) => (
                      <td key={c.d} title={`${c.d}: ${inr(c.s)} of ${inr(c.t)}`} className={cn("tabular h-6 border border-white text-center", cellCls(c.ach, c.t))}>
                        {c.ach == null ? "" : c.ach >= 10 ? "∞" : Math.round(c.ach * 100)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-600">
            <span><span className="mr-1 inline-block size-2.5 bg-emerald-500" />≥{pct(th.ahead, 0)}</span><span><span className="mr-1 inline-block size-2.5 bg-emerald-200" />≥{pct(th.onTrack, 0)}</span>
            <span><span className="mr-1 inline-block size-2.5 bg-amber-200" />≥{pct(th.atRisk, 0)}</span><span><span className="mr-1 inline-block size-2.5 bg-rose-200" />below</span><span><span className="mr-1 inline-block size-2.5 bg-rose-400" />zero sale</span>
          </div>
        </Section>
      </div>
    </>
  );
}
