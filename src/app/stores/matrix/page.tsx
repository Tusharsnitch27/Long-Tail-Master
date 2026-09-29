import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { storeRows, summarize } from "@/server/analytics";
import { catLabel } from "@/server/views";
import { PageHeader, Tabs, Notice } from "@/components/ui";
import { DataTable, type Col, type ColType } from "@/components/table/DataTable";
import { fmtRange } from "@/lib/dates";
import { safeDiv, growth } from "@/lib/metrics";

const METRICS: { key: string; label: string; type: ColType; tip: string }[] = [
  { key: "sales", label: "Revenue", type: "inr", tip: "Net sales in the selected dates" },
  { key: "qty", label: "Units", type: "num", tip: "Units sold" },
  { key: "ach", label: "Achievement %", type: "ach", tip: "Revenue ÷ target" },
  { key: "growth", label: "Growth", type: "delta", tip: "vs comparison period" },
  { key: "spsd", label: "Sales / day", type: "inr", tip: "Revenue ÷ days in period" },
  { key: "share", label: "Category mix", type: "pct", tip: "Category share of the store’s long-tail revenue. Compare with the network mix in the total row to spot gaps." },
];

export default async function Matrix({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const metric = METRICS.find((m) => m.key === ctx.sp.metric) ?? METRICS[0];
  const facts = await loadFacts(ctx);
  const { range, compare } = ctx.period;
  const cats = ctx.filters.cats;
  const base = storeRows(facts, range, compare, ctx.byCode, ctx.settings.thresholds, cats);
  const val = (c: { sales: number; qty: number; ach: number | null; growth: number | null }, total: number) =>
    metric.key === "sales" ? c.sales : metric.key === "qty" ? c.qty : metric.key === "ach" ? c.ach : metric.key === "growth" ? c.growth : metric.key === "share" ? safeDiv(c.sales, total) : safeDiv(c.sales, base[0]?.days ?? 1);
  const rows = base.map((r) => {
    const o: Record<string, unknown> = { b: r.branch_code, store: r.store, city: r.city, region: r.region, om: r.om };
    for (const c of cats) o[c] = val(r.byCat[c], r.sales);
    o.total = val({ sales: r.sales, qty: r.qty, ach: r.ach, growth: r.growth }, r.sales);
    // gap flag: category missing entirely while the store sells the other
    o.missing = cats.filter((c) => (r.byCat[c]?.sales ?? 0) <= 0 && r.sales > 0).map(catLabel).join(", ") || null;
    return o;
  });
  const totals: Record<string, unknown> = { store: "Network" };
  const all = summarize(facts, range), allP = summarize(facts, compare);
  for (const c of cats) {
    const cm = summarize(facts.filter((f) => f.c === c), range), cp = summarize(facts.filter((f) => f.c === c), compare);
    totals[c] = val({ sales: cm.sales, qty: cm.qty, ach: cm.ach, growth: growth(cm.sales, cp.sales) }, all.sales);
  }
  totals.total = val({ sales: all.sales, qty: all.qty, ach: all.ach, growth: growth(all.sales, allP.sales) }, all.sales);
  const heat = metric.key === "sales" || metric.key === "qty" || metric.key === "spsd";
  const cols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 220 },
    { key: "region", label: "Region" },
    { key: "om", label: "Type", hidden: true },
    ...cats.map((c) => ({ key: c, label: catLabel(c), type: metric.type, bar: heat, tip: metric.tip })),
    ...(metric.key === "share" ? [] : [{ key: "total", label: "Total", type: metric.type, bar: heat }]),
    { key: "missing", label: "No sales in", tip: "Categories with zero sales in this store for the period" },
  ];
  const missingCount = rows.filter((r) => r.missing).length;
  return (
    <>
      <PageHeader title="Store × Category" subtitle={<>{fmtRange(range)} · find category gaps by store</>} />
      <Tabs active={metric.key} tabs={METRICS.map((m) => ({ key: m.key, label: m.label, href: withQs(ctx, "/stores/matrix", { metric: m.key === "sales" ? null : m.key }) }))} />
      {missingCount > 0 && <Notice>{missingCount} store{missingCount > 1 ? "s" : ""} sold nothing in at least one category in this period — sort by “No sales in”.</Notice>}
      <DataTable rows={rows} columns={cols} totals={totals} rowHref="/stores/{b}" defaultSort={{ key: cats[0] }} csvName={`store-category-${metric.key}`} height={700} />
    </>
  );
}
