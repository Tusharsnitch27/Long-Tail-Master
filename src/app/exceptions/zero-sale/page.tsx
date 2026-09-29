import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { groupFacts, summarize } from "@/server/analytics";
import { catLabel } from "@/server/views";
import { PageHeader, Tabs, Kpi, KpiGrid } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { addDays, diffDays, fmtDate, startOfWeek } from "@/lib/dates";

export default async function ZeroSale({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const a = ctx.asOf;
  const windows = [
    { key: "today", label: "Today (so far)", r: { from: ctx.today, to: ctx.today } },
    { key: "y", label: `Yesterday`, r: { from: a, to: a } },
    { key: "wtd", label: "This week", r: { from: startOfWeek(a), to: a } },
    { key: "l7", label: "Last 7 days", r: { from: addDays(a, -6), to: a } },
  ];
  const w = windows.find((x) => x.key === ctx.sp.tab) ?? windows[1];
  const facts = await loadFacts(ctx, [{ from: addDays(a, -60), to: ctx.today }]);
  const rows: Record<string, unknown>[] = [];
  const counts: Record<string, number> = {};
  for (const [k, fs] of groupFacts(facts, (f) => `${f.b}|${f.c}`)) {
    const [b, c] = k.split("|");
    const hasTargetRecently = summarize(fs, { from: addDays(a, -13), to: a }).target ?? 0;
    const everSold = fs.some((f) => f.s > 0);
    if (hasTargetRecently <= 0 && !everSold) continue;
    for (const x of windows) {
      const m = summarize(fs, x.r);
      if (m.sales <= 0 && ((m.target ?? 0) > 0 || everSold)) counts[x.key] = (counts[x.key] ?? 0) + 1;
    }
    const m = summarize(fs, w.r);
    if (m.sales > 0 || ((m.target ?? 0) <= 0 && !everSold)) continue;
    const last = fs.filter((f) => f.s > 0).reduce<string | null>((x, f) => (!x || f.d > x ? f.d : x), null);
    const st = ctx.byCode.get(b);
    const l30 = summarize(fs, { from: addDays(a, -29), to: a });
    rows.push({ b, store: st?.short_name ?? `Branch ${b}`, city: st?.city, region: st?.region, am: st?.am, category: catLabel(c), target: m.target, last, daysSince: last ? diffDays(last, a) : null, l30: l30.sales, l30q: l30.qty });
  }
  const cols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 210 }, { key: "category", label: "Category" }, { key: "region", label: "Region" }, { key: "am", label: "AM" },
    { key: "target", label: "Missed target", type: "inr", tip: "Target for the window that had zero sales" },
    { key: "last", label: "Last sale", type: "date" }, { key: "daysSince", label: "Days since sale", type: "num", bar: true, tip: "60-day lookback; blank = no sale in 60 days" },
    { key: "l30", label: "L30 sales", type: "inr" }, { key: "l30q", label: "L30 units", type: "num" },
  ];
  return (
    <>
      <PageHeader title="Zero-Sale Stores" subtitle={<>Store × category with no sale in the window, but a target or a sales history · as of {fmtDate(a, true)}</>} />
      <KpiGrid cols={4}>{windows.map((x) => <Kpi key={x.key} label={x.label} value={String(counts[x.key] ?? 0)} sub="store × category with zero sale" />)}</KpiGrid>
      <div className="mt-4"><Tabs active={w.key} tabs={windows.map((x) => ({ key: x.key, label: x.label, count: counts[x.key] ?? 0, href: withQs(ctx, "/exceptions/zero-sale", { tab: x.key === "y" ? null : x.key }) }))} /></div>
      <DataTable rows={rows} columns={cols} rowHref="/stores/{b}" defaultSort={{ key: "target" }} csvName={`zero-sale-${w.key}`} height={640} emptyText="Every store with a target sold something in this window." />
    </>
  );
}
