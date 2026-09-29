import { pageContext, type SP } from "@/server/context";
import { groupFacts, summarize } from "@/server/analytics";
import { monthScope } from "@/server/targetsView";
import { catLabel } from "@/server/views";
import { PageHeader } from "@/components/ui";
import { MonthPicker } from "@/components/MonthPicker";
import { DataTable, type Col } from "@/components/table/DataTable";
import { addDays, fmtDate, maxDate, minDate, startOfWeek } from "@/lib/dates";
import { targetStatus } from "@/lib/metrics";

export default async function WeeklyTargets({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const sc = await monthScope(ctx);
  const th = ctx.settings.thresholds;
  // Weeks (Mon–Sun) clipped to the month so totals reconcile to the month target.
  const weeks: { from: string; to: string; label: string }[] = [];
  for (let w = startOfWeek(sc.ms); w <= sc.me; w = addDays(w, 7)) {
    const from = maxDate(w, sc.ms), to = minDate(addDays(w, 6), sc.me);
    weeks.push({ from, to, label: `${fmtDate(from)}–${fmtDate(to)}` });
  }
  const summaryRows = weeks.flatMap((w) => ctx.filters.cats.map((c) => {
    const fs = sc.facts.filter((f) => f.c === c);
    const full = summarize(fs, w);
    const upTo = minDate(w.to, sc.cutoff);
    const td = upTo >= w.from ? summarize(fs, { from: w.from, to: upTo }) : null;
    return { week: w.label, category: catLabel(c), target: full.target, tdTarget: td?.target ?? null, sales: td?.sales ?? null, ach: td?.ach ?? null,
      status: td ? targetStatus(td.sales, td.target, th) : "no_target", gap: td?.gap ?? null, qty: td?.qty ?? null,
      state: upTo >= w.to ? "Complete" : upTo >= w.from ? `To ${fmtDate(upTo)}` : "Upcoming" };
  }));
  const storeRows: Record<string, unknown>[] = [];
  for (const [b, fs] of groupFacts(sc.facts, (f) => f.b)) {
    const st = ctx.byCode.get(b);
    const r: Record<string, unknown> = { b, store: st?.short_name ?? `Branch ${b}`, city: st?.city };
    let any = false;
    weeks.forEach((w, i) => {
      const upTo = minDate(w.to, sc.cutoff);
      const m = upTo >= w.from ? summarize(fs, { from: w.from, to: upTo }) : null;
      const full = summarize(fs, w);
      r[`w${i}_t`] = full.target; r[`w${i}_a`] = m?.ach ?? null;
      if ((full.target ?? 0) > 0) any = true;
    });
    const mm = summarize(fs, { from: sc.ms, to: sc.cutoff });
    r.mtd = mm.ach;
    if (any) storeRows.push(r);
  }
  const sCols: Col[] = [
    { key: "week", label: "Week" }, { key: "state", label: "Period" }, { key: "category", label: "Category" }, { key: "target", label: "Week target", type: "inr" },
    { key: "tdTarget", label: "Target to date", type: "inr" }, { key: "sales", label: "Actual", type: "inr", bar: true }, { key: "ach", label: "Ach %", type: "ach" },
    { key: "status", label: "Status", type: "status" }, { key: "gap", label: "Gap", type: "inr" }, { key: "qty", label: "Units", type: "num" },
  ];
  const stCols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 200 },
    ...weeks.flatMap((w, i) => [{ key: `w${i}_t`, label: "Target", type: "inr" as const, group: w.label }, { key: `w${i}_a`, label: "Ach", type: "ach" as const, group: w.label }]),
    { key: "mtd", label: "MTD ach", type: "ach" },
  ];
  return (
    <>
      <PageHeader title="Weekly Targets" subtitle={<>{sc.label} · Mon–Sun weeks, clipped to the month · ach uses target to date for the running week</>} right={<MonthPicker months={sc.months} value={sc.ms.slice(0, 7)} />} />
      <DataTable rows={summaryRows} columns={sCols} csvName={`weekly-targets-${sc.ms.slice(0, 7)}`} height={380} />
      <div className="mt-4"><DataTable title="Store × week" rows={storeRows} columns={stCols} rowHref="/stores/{b}" defaultSort={{ key: "mtd", desc: false }} csvName={`store-week-targets-${sc.ms.slice(0, 7)}`} height={600} /></div>
    </>
  );
}
