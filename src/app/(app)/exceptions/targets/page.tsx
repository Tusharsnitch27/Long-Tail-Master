import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { storeSignals, exceptionRanges } from "@/server/exceptions";
import { PageHeader, Tabs } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { fmtDate } from "@/lib/dates";

const TABS = [
  { key: "abs", label: "Biggest ₹ gap", sort: "mGap" },
  { key: "pct", label: "Biggest % gap", sort: "mGapPct" },
  { key: "rrr", label: "High required run rate", sort: "rrrMultiple" },
];

export default async function TargetMisses({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const facts = await loadFacts(ctx, exceptionRanges(ctx.asOf));
  const tab = TABS.find((t) => t.key === ctx.sp.tab) ?? TABS[0];
  const all = storeSignals(ctx, facts).filter((s) => (s.mTarget ?? 0) > 0);
  const rows = tab.key === "rrr" ? all.filter((s) => (s.rrrMultiple ?? 0) >= ctx.settings.exceptions.highRunRateMultiple) : all.filter((s) => (s.mGap ?? 0) > 0);
  const cols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 200 }, { key: "category", label: "Category" }, { key: "region", label: "Region" }, { key: "am", label: "AM" },
    { key: "mTarget", label: "MTD target", type: "inr" }, { key: "mSales", label: "MTD actual", type: "inr" }, { key: "mAch", label: "Ach", type: "ach" },
    { key: "mGap", label: "Gap ₹", type: "inr", bar: tab.key === "abs" }, { key: "mGapPct", label: "Gap %", type: "pct" },
    { key: "runRate", label: "Current/day", type: "inr" }, { key: "rrr", label: "Required/day", type: "inr" },
    { key: "rrrMultiple", label: "Req ÷ current", type: "dec", tip: "How many times the current daily run rate the store needs for the rest of the month" },
  ];
  return (
    <>
      <PageHeader title="Target Misses" subtitle={<>Month to date through {fmtDate(ctx.asOf, true)} · store × category</>} />
      <Tabs active={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: withQs(ctx, "/exceptions/targets", { tab: t.key === "abs" ? null : t.key }) }))} />
      <DataTable rows={rows} columns={cols} rowHref="/stores/{b}" defaultSort={{ key: tab.sort }} csvName={`target-misses-${tab.key}`} height={700} emptyText="No stores behind target." />
    </>
  );
}
