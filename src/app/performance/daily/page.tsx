import { pageContext, loadFacts, type SP } from "@/server/context";
import { summarize, dailySeries } from "@/server/analytics";
import { categoryComparison, trendByCategory, catColor, catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Section, Notice } from "@/components/ui";
import { CompareTable } from "@/components/ui/CompareTable";
import { TrendChart } from "@/components/charts/TrendChart";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num } from "@/lib/format";
import { addDays, fmtRange, weekday, rangeDays } from "@/lib/dates";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";

export default async function Daily({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  // Daily view always shows at least 14 days of history for the trend.
  const r = ctx.period.range;
  const trendRange = rangeDays(r) >= 14 ? r : { from: addDays(r.to, -13), to: r.to };
  const facts = await loadFacts(ctx, [trendRange, { from: addDays(trendRange.from, -7), to: trendRange.to }]);
  const m = summarize(facts, r);
  const p = summarize(facts, ctx.period.compare);
  const cmp = categoryComparison(ctx, facts);
  const trend = trendByCategory(facts, trendRange, ctx.filters.cats);
  const cats = ctx.filters.cats;
  const th = ctx.settings.thresholds;

  // One row per date × category (+ all-category rows)
  const rows: Record<string, unknown>[] = [];
  const lastWeek = new Map(dailySeries(facts, { from: addDays(trendRange.from, -7), to: addDays(trendRange.to, -7) }).map((d) => [d.date, d]));
  for (const c of [...cats, ...(cats.length > 1 ? ["all"] : [])]) {
    const fs = c === "all" ? facts : facts.filter((f) => f.c === c);
    const lw = c === "all" ? lastWeek : new Map(dailySeries(fs, { from: addDays(trendRange.from, -7), to: addDays(trendRange.to, -7) }).map((d) => [d.date, d]));
    for (const d of dailySeries(fs, trendRange).reverse()) {
      const sm = summarize(fs, { from: d.date, to: d.date });
      const prevWk = lw.get(addDays(d.date, -7));
      rows.push({
        date: d.date, dow: weekday(d.date), category: c === "all" ? "All categories" : catLabel(c),
        sales: d.sales, qty: d.qty, bills: sm.bills, target: d.target, ach: d.ach, gap: d.target == null ? null : d.target - d.sales,
        status: targetStatus(d.sales, d.target, th), stores: sm.storesSelling, active: sm.stores,
        spStore: safeDiv(d.sales, sm.stores), upStore: safeDiv(d.qty, sm.stores), asp: sm.asp, wow: growth(d.sales, prevWk?.sales),
      });
    }
  }
  const cols: Col[] = [
    { key: "date", label: "Date", type: "date", sub: "dow" },
    { key: "category", label: "Category" },
    { key: "sales", label: "Revenue", type: "inr", bar: true },
    { key: "target", label: "Target", type: "inr" },
    { key: "ach", label: "Ach %", type: "ach" },
    { key: "gap", label: "Gap", type: "inr", tip: "Target − revenue (negative = above target)" },
    { key: "status", label: "Status", type: "status" },
    { key: "wow", label: "vs same day LW", type: "delta" },
    { key: "qty", label: "Units", type: "num" },
    { key: "bills", label: "Bills", type: "num" },
    { key: "stores", label: "Stores selling", type: "num" },
    { key: "active", label: "Active stores", type: "num", hidden: true, tip: "Stores with a target or a sale that day" },
    { key: "spStore", label: "Sales/store", type: "inr", tip: "Revenue ÷ active stores" },
    { key: "upStore", label: "Units/store", type: "dec" },
    { key: "asp", label: "ASP", type: "inrFull" },
  ];

  return (
    <>
      <PageHeader title="Daily Performance" subtitle={<>{fmtRange(r)} · {ctx.period.compareLabel}</>} />
      {ctx.period.partial && <Notice tone="warn">Today is partial — data is still arriving.</Notice>}
      <KpiGrid>
        <Kpi label="Revenue" value={inr(m.sales)} delta={growth(m.sales, p.sales)} deltaLabel={ctx.period.compareLabel} />
        <Kpi label="Target" value={inr(m.target)} sub={m.ach == null ? "No target" : `${(m.ach * 100).toFixed(1)}% achieved`} />
        <Kpi label="Gap" value={m.gap == null ? "—" : inr(m.gap)} />
        <Kpi label="Units" value={num(m.qty)} delta={growth(m.qty, p.qty)} />
        <Kpi label="Avg sales / store / day" value={inr(m.salesPerStoreDay)} delta={growth(m.salesPerStoreDay, p.salesPerStoreDay)} />
        <Kpi label="Avg units / store / day" value={num(m.unitsPerStoreDay, 2)} delta={growth(m.unitsPerStoreDay, p.unitsPerStoreDay)} />
      </KpiGrid>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Section title={`Daily revenue vs target · ${fmtRange(trendRange)}`}>
          <TrendChart data={trend} height={260}
            series={[...cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), stack: "s" })), { key: "target", label: "Target", color: "#18181b", type: "line" as const, dashed: true },
              { key: "ach", label: "Achievement", color: "#10b981", type: "line" as const, axis: "right" as const }]} />
        </Section>
        <Section title="Perfumes vs Shoes" pad={false}>
          <div className="px-4 py-2"><CompareTable cols={cmp.cols} rows={cmp.rows.slice(0, 11)} colors={cmp.data.map((d) => (d.key === "total" ? "#18181b" : catColor(d.key)))} /></div>
        </Section>
      </div>
      <div className="mt-4">
        <DataTable title="Day-by-day" rows={rows} columns={cols} csvName={`daily-${trendRange.from}-${trendRange.to}`}
          rowHref="/stores?p=custom&from={date}&to={date}" height={560} />
      </div>
    </>
  );
}
