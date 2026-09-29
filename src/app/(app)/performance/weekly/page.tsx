import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { summarize, groupFacts } from "@/server/analytics";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Section, Tabs, StatusBadge } from "@/components/ui";
import { TrendChart } from "@/components/charts/TrendChart";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num, pct } from "@/lib/format";
import { addDays, fmtDate, fmtRange, minDate, startOfWeek, diffDays } from "@/lib/dates";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";

export default async function Weekly({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const curWs = startOfWeek(ctx.asOf);
  const wkParam = typeof ctx.sp.wk === "string" ? startOfWeek(ctx.sp.wk) : ctx.filters.preset === "pw" ? addDays(curWs, -7) : curWs;
  const ws = wkParam > curWs ? curWs : wkParam;
  const we = addDays(ws, 6);
  const upTo = minDate(we, ctx.asOf); // last complete day inside the week
  const n = diffDays(ws, upTo) + 1;
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(curWs, -7 * (11 - i)));
  const facts = await loadFacts(ctx, [{ from: weeks[0], to: addDays(curWs, 6) }, { from: addDays(ws, -28), to: we }]);

  const wtd = { from: ws, to: upTo };
  const prevSame = { from: addDays(ws, -7), to: addDays(upTo, -7) };
  const m = summarize(facts, wtd);
  const p = summarize(facts, prevSame);
  const fullWeek = summarize(facts, { from: ws, to: we });
  // rolling 4 weeks before this week, same weekdays, averaged
  const r4 = [1, 2, 3, 4].map((k) => summarize(facts, { from: addDays(ws, -7 * k), to: addDays(upTo, -7 * k) }));
  const r4Avg = r4.reduce((a, x) => a + x.sales, 0) / 4;
  const remainingDays = diffDays(upTo, we);
  const rrr = fullWeek.target == null || remainingDays <= 0 ? null : Math.max(fullWeek.target - m.sales, 0) / remainingDays;

  const chart = weeks.map((w) => {
    const to = minDate(addDays(w, 6), ctx.asOf);
    const o: Record<string, unknown> = { week: fmtDate(w), target: summarize(facts, { from: w, to }).target };
    const tot = summarize(facts, { from: w, to });
    const prev = summarize(facts, { from: addDays(w, -7), to: addDays(to, -7) });
    for (const c of ctx.filters.cats) o[c] = summarize(facts.filter((f) => f.c === c), { from: w, to }).sales;
    o.wow = growth(tot.sales, prev.sales);
    return o;
  });

  const th = ctx.settings.thresholds;
  const rows: Record<string, unknown>[] = [];
  for (const [key, fs] of groupFacts(facts, (f) => `${f.b}|${f.c}`)) {
    const [b, c] = key.split("|");
    const cur = summarize(fs, wtd);
    const full = summarize(fs, { from: ws, to: we });
    if (cur.stores === 0 && (full.target ?? 0) === 0) continue;
    const pv = summarize(fs, prevSame);
    const st = ctx.byCode.get(b);
    const need = full.target == null || remainingDays <= 0 ? null : Math.max(full.target - cur.sales, 0) / remainingDays;
    rows.push({
      b, store: st?.short_name ?? `Branch ${b}`, city: st?.city, region: st?.region, category: catLabel(c),
      sales: cur.sales, weekTarget: full.target, wtdTarget: cur.target, ach: cur.ach, status: targetStatus(cur.sales, cur.target, th),
      gap: cur.target == null ? null : cur.target - cur.sales, prev: pv.sales, wow: growth(cur.sales, pv.sales),
      qty: cur.qty, bills: cur.bills, perDay: cur.sales / n, rrr: need,
    });
  }
  const cols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 200 },
    { key: "region", label: "Region", hidden: true },
    { key: "category", label: "Category" },
    { key: "sales", label: "WTD sales", type: "inr", bar: true },
    { key: "weekTarget", label: "Week target", type: "inr", tip: "Full Mon–Sun target" },
    { key: "wtdTarget", label: "WTD target", type: "inr", tip: `Target for ${fmtDate(ws)}–${fmtDate(upTo)}` },
    { key: "ach", label: "Ach %", type: "ach", tip: "WTD sales ÷ WTD target" },
    { key: "status", label: "Status", type: "status" },
    { key: "gap", label: "Gap", type: "inr" },
    { key: "prev", label: "Prev week", type: "inr", tip: "Same weekdays of the previous week" },
    { key: "wow", label: "WoW %", type: "delta" },
    { key: "qty", label: "Units", type: "num" },
    { key: "bills", label: "Bills", type: "num", hidden: true },
    { key: "perDay", label: "Sales/day", type: "inr" },
    { key: "rrr", label: "Req. run rate", type: "inr", tip: "Remaining week target ÷ remaining days in week" },
  ];

  return (
    <>
      <PageHeader title="Weekly Performance" subtitle={<>Week of {fmtRange({ from: ws, to: we })} · {n < 7 ? `week to date (${n} of 7 days, through ${fmtDate(upTo)})` : "complete week"} · weeks run Mon–Sun</>} />
      <Tabs active={ws} tabs={weeks.slice(-8).reverse().map((w) => ({ key: w, label: w === curWs ? "This week" : w === addDays(curWs, -7) ? "Last week" : `w/c ${fmtDate(w)}`, href: withQs(ctx, "/performance/weekly", { wk: w }) }))} />
      <KpiGrid>
        <Kpi label={n < 7 ? "WTD revenue" : "Week revenue"} value={inr(m.sales)} delta={growth(m.sales, p.sales)} deltaLabel="vs prev week (same days)" />
        <Kpi label="Weekly target" value={inr(fullWeek.target)} sub={`WTD target ${inr(m.target)}`} status={<StatusBadge status={targetStatus(m.sales, m.target, th)} ach={m.ach} />} />
        <Kpi label="vs 4-week avg" value={inr(r4Avg)} delta={growth(m.sales, r4Avg)} deltaLabel="same weekdays, prior 4 wks" tip="Average revenue of the same weekdays over the previous 4 weeks" />
        <Kpi label="Units" value={num(m.qty)} delta={growth(m.qty, p.qty)} sub={`${m.storesSelling} stores selling`} />
        <Kpi label="Sales / store" value={inr(m.salesPerStore)} sub={`${num(m.unitsPerStore, 1)} units / store`} />
        <Kpi label="Required run rate" value={rrr == null ? "—" : `${inr(rrr)}/day`} sub={remainingDays > 0 ? `${remainingDays} days left · now ${inr(m.sales / n)}/day` : "week complete"} />
      </KpiGrid>
      <div className="mt-4">
        <Section title="Last 12 weeks" tip="Current week shown to date. WoW compares the same weekdays.">
          <TrendChart data={chart} xKey="week" xIsDate={false} height={250}
            series={[...ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), stack: "s" })), { key: "target", label: "Target", color: "#18181b", type: "line" as const, dashed: true },
              { key: "wow", label: "WoW %", color: "#10b981", type: "line" as const, axis: "right" as const }]} />
        </Section>
      </div>
      <div className="mt-4">
        <DataTable title="Store × category — this week" rows={rows} columns={cols} defaultSort={{ key: "sales" }} rowHref="/stores/{b}" csvName={`weekly-${ws}`}
          totals={{ store: "Total", sales: m.sales, weekTarget: fullWeek.target, wtdTarget: m.target, ach: m.ach, gap: m.gap, prev: p.sales, wow: growth(m.sales, p.sales), qty: m.qty, perDay: m.sales / n, rrr }} />
      </div>
      <p className="mt-2 text-[12px] text-zinc-500">Achievement % uses WTD target ({pct(safeDiv(m.target, fullWeek.target), 0)} of the week’s target is phased into the days so far).</p>
    </>
  );
}
