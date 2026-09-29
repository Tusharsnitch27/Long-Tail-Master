import { pageContext, type SP } from "@/server/context";
import { summarize, groupFacts, monthOutlook } from "@/server/analytics";
import { monthScope } from "@/server/targetsView";
import { catLabel } from "@/server/views";
import { PageHeader } from "@/components/ui";
import { MonthPicker } from "@/components/MonthPicker";
import { DataTable, type Col } from "@/components/table/DataTable";
import { fmtDate } from "@/lib/dates";
import { safeDiv, targetStatus } from "@/lib/metrics";

export default async function StoreTargets({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const sc = await monthScope(ctx);
  const th = ctx.settings.thresholds;
  const ov = new Set(sc.overrides.map((o) => `${o.branch_code}|${o.category}`));
  const catOv = new Set(sc.overrides.filter((o) => o.branch_code === "*").map((o) => o.category));
  const rows: Record<string, unknown>[] = [];
  for (const [k, fs] of groupFacts(sc.facts, (f) => `${f.b}|${f.c}`)) {
    const [b, c] = k.split("|");
    const full = summarize(fs, { from: sc.ms, to: sc.me });
    const td = sc.hasActuals ? summarize(fs, { from: sc.ms, to: sc.cutoff }) : null;
    if ((full.target ?? 0) <= 0 && (td?.sales ?? 0) === 0) continue;
    const mo = monthOutlook(fs, sc.cutoff);
    const today = summarize(fs, { from: ctx.today, to: ctx.today });
    const snow = fs.reduce((a, f) => a + (f.st ?? 0), 0);
    const st = ctx.byCode.get(b);
    rows.push({
      b, store: st?.short_name ?? `Branch ${b}`, city: st?.city, region: st?.region, am: st?.am, category: catLabel(c),
      monthTarget: full.target, snowTarget: snow, source: ov.has(k) ? "Override" : catOv.has(c) ? "Category scaled" : "Snowflake",
      tdTarget: td?.target ?? null, sales: td?.sales ?? null, ach: td?.ach ?? null, status: td ? targetStatus(td.sales, td.target, th) : "no_target",
      gap: td?.gap ?? null, remaining: full.target == null ? null : Math.max(full.target - (td?.sales ?? 0), 0), rrr: mo.requiredRunRate,
      runRate: td ? safeDiv(td.sales, td.days) : null, projected: mo.projected, projAch: mo.projectedAch,
      todayTarget: sc.ms <= ctx.today && ctx.today <= sc.me ? today.target : null,
    });
  }
  const cols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 200 }, { key: "region", label: "Region", hidden: true }, { key: "am", label: "AM", hidden: true },
    { key: "category", label: "Category" },
    { key: "monthTarget", label: "Month target", type: "inr", group: "Target" },
    { key: "snowTarget", label: "Snowflake base", type: "inr", group: "Target", hidden: true },
    { key: "source", label: "Source", group: "Target", tip: "Snowflake = MTD_TARGET_* table; Override = set in Target Setup" },
    { key: "tdTarget", label: `Target to ${fmtDate(sc.cutoff)}`, type: "inr", group: "To date" },
    { key: "sales", label: "Actual", type: "inr", group: "To date", bar: true },
    { key: "ach", label: "Ach %", type: "ach", group: "To date" },
    { key: "status", label: "Status", type: "status", group: "To date" },
    { key: "gap", label: "Gap", type: "inr", group: "To date" },
    { key: "remaining", label: "Remaining", type: "inr", group: "Rest of month" },
    { key: "rrr", label: "Req/day", type: "inr", group: "Rest of month" },
    { key: "runRate", label: "Current/day", type: "inr", group: "Rest of month" },
    { key: "projected", label: "Projected", type: "inr", group: "Rest of month" },
    { key: "projAch", label: "Proj ach", type: "ach", group: "Rest of month" },
    { key: "todayTarget", label: "Today", type: "inr", tip: "Phased target for today" },
  ];
  return (
    <>
      <PageHeader title="Store Targets" subtitle={<>{sc.label} · store × category month targets and achievement</>} right={<MonthPicker months={sc.months} value={sc.ms.slice(0, 7)} />} />
      <DataTable rows={rows} columns={cols} rowHref="/stores/{b}" defaultSort={{ key: "monthTarget" }} csvName={`store-targets-${sc.ms.slice(0, 7)}`} height={720} searchKeys={["store", "city", "category", "am", "source"]} />
    </>
  );
}
