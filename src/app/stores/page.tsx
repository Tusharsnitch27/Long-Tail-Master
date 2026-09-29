import { pageContext, loadFacts, type SP } from "@/server/context";
import { summarize, storeRows, groupFacts, monthOutlook } from "@/server/analytics";
import { catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num } from "@/lib/format";
import { fmtRange } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";

export default async function Stores({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const facts = await loadFacts(ctx, [{ from: ctx.today, to: ctx.today }]);
  const { range, compare } = ctx.period;
  const cats = ctx.filters.cats;
  const base = storeRows(facts, range, compare, ctx.byCode, ctx.settings.thresholds, cats);
  const byStore = groupFacts(facts, (f) => f.b);
  const rows = base.map((r) => {
    const fs = byStore.get(r.branch_code) ?? [];
    const mo = monthOutlook(fs, ctx.asOf);
    const today = summarize(fs, { from: ctx.today, to: ctx.today });
    const o: Record<string, unknown> = {
      rank: r.rank, b: r.branch_code, store: r.store, city: r.city, state: r.state, region: r.region, om: r.om, am: r.am,
      sales: r.sales, qty: r.qty, bills: r.bills, target: r.target, ach: r.ach, status: r.status, gap: r.gap,
      perDay: safeDiv(r.sales, r.days), unitsPerDay: safeDiv(r.qty, r.days), asp: r.asp,
      todayTarget: today.target, mtdTarget: mo.mtdTarget, mtdAch: safeDiv(mo.mtdSales, mo.mtdTarget), rrr: mo.requiredRunRate,
      prev: r.prevSales, growth: r.growth,
    };
    for (const c of cats) { o[`${c}_s`] = r.byCat[c]?.sales ?? 0; o[`${c}_a`] = r.byCat[c]?.ach ?? null; o[`${c}_q`] = r.byCat[c]?.qty ?? 0; }
    return o;
  });
  const m = summarize(facts, range), p = summarize(facts, compare);
  const cols: Col[] = [
    { key: "rank", label: "#", type: "num", width: 40 },
    { key: "store", label: "Store", sub: "city", width: 210 },
    { key: "region", label: "Region" },
    { key: "state", label: "State", hidden: true },
    { key: "om", label: "Type", tip: "Operating model: COCO / COFO / FOCO" },
    { key: "am", label: "AM", hidden: true },
    ...cats.flatMap((c) => [
      { key: `${c}_s`, label: "Sales", type: "inr" as const, group: catLabel(c), bar: true },
      { key: `${c}_q`, label: "Units", type: "num" as const, group: catLabel(c), hidden: cats.length > 1 },
      { key: `${c}_a`, label: "Ach", type: "ach" as const, group: catLabel(c) },
    ]),
    { key: "sales", label: "Total sales", type: "inr", group: "Long-tail total" },
    { key: "qty", label: "Units", type: "num", group: "Long-tail total" },
    { key: "target", label: "Target", type: "inr", group: "Long-tail total" },
    { key: "ach", label: "Ach %", type: "ach", group: "Long-tail total" },
    { key: "status", label: "Status", type: "status", group: "Long-tail total" },
    { key: "gap", label: "Gap", type: "inr", group: "Long-tail total", hidden: true },
    { key: "perDay", label: "Sales/day", type: "inr", group: "Productivity" },
    { key: "unitsPerDay", label: "Units/day", type: "dec", group: "Productivity" },
    { key: "asp", label: "ASP", type: "inrFull", group: "Productivity", hidden: true },
    { key: "todayTarget", label: "Today’s target", type: "inr", group: "Month", tip: "Phased target for today (IST)" },
    { key: "mtdTarget", label: "MTD target", type: "inr", group: "Month" },
    { key: "mtdAch", label: "MTD ach", type: "ach", group: "Month" },
    { key: "rrr", label: "Req/day", type: "inr", group: "Month", tip: "Remaining month target ÷ remaining days" },
    { key: "prev", label: "Prev period", type: "inr", group: "Growth" },
    { key: "growth", label: "Growth", type: "delta", group: "Growth" },
  ];
  const totals: Record<string, unknown> = { rank: "", store: "Total", sales: m.sales, qty: m.qty, target: m.target, ach: m.ach, gap: m.gap, prev: p.sales, growth: growth(m.sales, p.sales) };
  for (const c of cats) { const cm = summarize(facts.filter((f) => f.c === c), range); totals[`${c}_s`] = cm.sales; totals[`${c}_a`] = cm.ach; totals[`${c}_q`] = cm.qty; }

  return (
    <>
      <PageHeader title="Store Performance" subtitle={<>{fmtRange(range)} · {ctx.period.compareLabel} · click a store for detail</>} />
      <KpiGrid>
        <Kpi label="Stores" value={num(rows.length)} sub={`${m.storesSelling} selling`} />
        <Kpi label="Revenue" value={inr(m.sales)} delta={growth(m.sales, p.sales)} />
        <Kpi label="Achievement" value={m.ach == null ? "—" : `${(m.ach * 100).toFixed(1)}%`} sub={`of ${inr(m.target)}`} />
        <Kpi label="Avg sales / store" value={inr(m.salesPerStore)} />
        <Kpi label="Avg sales / store / day" value={inr(m.salesPerStoreDay)} />
        <Kpi label="Avg units / store / day" value={num(m.unitsPerStoreDay, 2)} />
      </KpiGrid>
      <div className="mt-4">
        <DataTable rows={rows} columns={cols} rowHref="/stores/{b}" defaultSort={{ key: "sales" }} csvName={`stores-${range.from}-${range.to}`}
          searchKeys={["store", "city", "state", "region", "am", "b"]} totals={totals} height={680} />
      </div>
    </>
  );
}
