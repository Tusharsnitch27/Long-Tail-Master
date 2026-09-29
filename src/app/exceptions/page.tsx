import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { storeSignals, exceptionRanges } from "@/server/exceptions";
import { PageHeader, Tabs, Notice } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { fmtDate } from "@/lib/dates";
import { pct } from "@/lib/format";

const TABS = [
  { key: "priority", label: "Priority list", flag: null }, // ranked by MTD gap × number of flags
  { key: "zero-y", label: "Zero sale yesterday", flag: "Zero sale yesterday" },
  { key: "below-d", label: "Below daily target", flag: "Below daily target" },
  { key: "zero-w", label: "Zero sale this week", flag: "Zero sale this week" },
  { key: "below-w", label: "Below weekly target", flag: "Below weekly target" },
  { key: "wow", label: "Major WoW decline", flag: "Major WoW decline" },
  { key: "pen", label: "Low category productivity", flag: "Low category productivity" },
];

export default async function StoreExceptions({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const facts = await loadFacts(ctx, exceptionRanges(ctx.asOf));
  const sig = storeSignals(ctx, facts);
  const tab = TABS.find((t) => t.key === ctx.sp.tab) ?? TABS[0];
  const rows = tab.flag ? sig.filter((s) => s.flags.includes(tab.flag!)) : sig.filter((s) => s.flagCount > 0);
  const ex = ctx.settings.exceptions;
  const cols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 200 }, { key: "category", label: "Category" }, { key: "am", label: "AM" },
    { key: "mGap", label: "MTD gap", type: "inr", tip: "MTD target − MTD sales" },
    { key: "flagText", label: "Why it’s flagged", width: 260 },
    { key: "ySales", label: "Sales", type: "inr", group: `Yesterday (${fmtDate(ctx.asOf)})` }, { key: "yAch", label: "Ach", type: "ach", group: `Yesterday (${fmtDate(ctx.asOf)})` },
    { key: "wSales", label: "WTD", type: "inr", group: "Week to date" }, { key: "wAch", label: "Ach", type: "ach", group: "Week to date" }, { key: "wow", label: "WoW", type: "delta", group: "Week to date" },
    { key: "mSales", label: "MTD", type: "inr", group: "Month to date" }, { key: "mAch", label: "Ach", type: "ach", group: "Month to date" },
    { key: "relProductivity", label: "vs network", type: "pct", tip: "Store's MTD sales/day ÷ network average per store/day for the category", group: "Month to date" },
    { key: "daysSince", label: "Days since sale", type: "num" },
  ];
  const counts = Object.fromEntries(TABS.map((t) => [t.key, t.flag ? sig.filter((s) => s.flags.includes(t.flag!)).length : sig.filter((s) => s.flagCount > 0).length]));
  return (
    <>
      <PageHeader title="Stores to Act On" subtitle={<>Where should we intervene today? · as of {fmtDate(ctx.asOf, true)} · store × category</>} />
      <Tabs active={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key], href: withQs(ctx, "/exceptions", { tab: t.key === "priority" ? null : t.key }) }))} />
      <Notice>
        Rules (Admin → Settings): below target = achievement under {pct(ctx.settings.thresholds.atRisk, 0)}; major decline = WTD vs same days last week ≤ {pct(ex.wowDecline, 0)};
        low productivity = sales/day under {pct(ex.lowPenetration, 0)} of the network average; high run rate = required ÷ current ≥ {ex.highRunRateMultiple}×.
      </Notice>
      <DataTable rows={rows} columns={cols} rowHref="/stores/{b}" defaultSort={{ key: tab.key === "priority" ? "score" : tab.key === "wow" ? "wow" : "mGap", desc: tab.key !== "wow" }}
        csvName={`exceptions-${tab.key}`} height={680} searchKeys={["store", "city", "am", "category", "flagText"]} emptyText="Nothing flagged — good news." />
    </>
  );
}
