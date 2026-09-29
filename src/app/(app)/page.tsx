import Link from "next/link";
import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { summarize, monthOutlook, storeRows, statusCounts } from "@/server/analytics";
import { categoryComparison, trendByCategory, pulse, catColor, catLabel } from "@/server/views";
import { loadSkus } from "@/server/skus";
import { PageHeader, Kpi, KpiGrid, Section, Delta, StatusBadge, Notice } from "@/components/ui";
import { CompareTable } from "@/components/ui/CompareTable";
import { TrendChart } from "@/components/charts/TrendChart";
import { BarList } from "@/components/charts/BarList";
import { inr, num, pct } from "@/lib/format";
import { addDays, fmtRange } from "@/lib/dates";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";

export default async function Overview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const trendRange = { from: addDays(ctx.asOf, -29), to: ctx.asOf };
  const [facts, sku] = await Promise.all([loadFacts(ctx, [trendRange, { from: addDays(ctx.asOf, -8), to: ctx.asOf }]), loadSkus(ctx)]);
  const { range, compare } = ctx.period;
  const m = summarize(facts, range);
  const p = summarize(facts, compare);
  const mo = monthOutlook(facts, ctx.asOf);
  const cmp = categoryComparison(ctx, facts);
  const trend = trendByCategory(facts, trendRange, ctx.filters.cats);
  const pul = pulse(ctx, facts);
  const counts = statusCounts(facts, range, ctx.settings.thresholds);
  const stores = storeRows(facts, range, compare, ctx.byCode, ctx.settings.thresholds, ctx.filters.cats).filter((s) => (s.target ?? 0) > 0);
  const byAch = [...stores].filter((s) => s.ach != null).sort((a, b) => (b.ach ?? 0) - (a.ach ?? 0));
  const status = targetStatus(m.sales, m.target, ctx.settings.thresholds);
  const selling = sku.skus.filter((s) => s.qty > 0);
  const liveNoSale = [...sku.products.values()].filter((pr) => pr.category && ctx.filters.cats.includes(pr.category) && pr.inBible && pr.lifecycle === "LIVE" && (pr.invOffline ?? 0) > 0)
    .filter((pr) => !selling.some((s) => s.sku === pr.sku)).length;

  return (
    <>
      <PageHeader title="Executive Overview"
        subtitle={<>{ctx.filters.cats.map(catLabel).join(" & ")} · {fmtRange(range)} · <span className="text-zinc-400">{ctx.period.compareLabel} ({fmtRange(compare)})</span></>} />
      {ctx.period.partial && <Notice tone="warn">Includes today — data is still arriving through the day, so today’s numbers are partial.</Notice>}

      <KpiGrid cols={6}>
        <Kpi label="Revenue" value={inr(m.sales)} delta={growth(m.sales, p.sales)} deltaLabel={`vs ${inr(p.sales)}`} tip="Net sales from the DSR (after discounts)" />
        <Kpi label="Target" value={inr(m.target)} status={<StatusBadge status={status} ach={m.ach} />} tip="Sum of phased daily store targets for the selected dates" />
        <Kpi label="Gap to target" value={m.gap == null ? "—" : m.gap > 0 ? inr(m.gap) : `+${inr(-m.gap)}`} sub={m.gap != null && m.gap <= 0 ? "above target" : "to go"} />
        <Kpi label="Units sold" value={num(m.qty)} delta={growth(m.qty, p.qty)} sub={`${num(m.bills)} bills`} />
        <Kpi label="ASP" value={inr(m.asp, { compact: false })} delta={growth(m.asp, p.asp)} sub={`UPT ${num(m.upt, 2)}`} tip="Revenue ÷ units. UPT = units per bill" />
        <Kpi label="Stores selling" value={`${m.storesSelling} / ${m.stores}`} sub={`${inr(m.salesPerStoreDay)} per store/day`} tip="Stores with at least one sale ÷ stores with a target or sale" />
      </KpiGrid>

      <div className="mt-3">
        <KpiGrid cols={6}>
          <Kpi label="MTD revenue" value={inr(mo.mtdSales)} sub={`${pct(safeDiv(mo.mtdSales, mo.mtdTarget))} of MTD target`} />
          <Kpi label="Month target" value={inr(mo.monthTarget)} sub={`${mo.remainingDays} days left`} />
          <Kpi label="Projected month-end" value={inr(mo.projected)} sub={`${pct(mo.projectedAch, 0)} of month target`} tip="MTD achievement % × full-month phased target (weekends are weighted as planned)" />
          <Kpi label="Required run rate" value={mo.requiredRunRate == null ? "—" : `${inr(mo.requiredRunRate)}/day`} sub={`current ${inr(mo.currentRunRate)}/day`} tip="Remaining month target ÷ remaining days" />
          <Kpi label="Stores at/above target" value={`${counts.ahead + counts.on_track}`} sub={`${counts.at_risk} at risk · ${counts.behind} behind`} tip={`Ahead ≥${pct(ctx.settings.thresholds.ahead, 0)}, On track ≥${pct(ctx.settings.thresholds.onTrack, 0)}, At risk ≥${pct(ctx.settings.thresholds.atRisk, 0)}`} />
          <Kpi label="Selling SKUs" value={`${selling.length}`} sub={`${liveNoSale} live SKUs with store stock, no sale`} tip="SKUs with ≥1 unit sold in stores in the selected dates. Zero-sale count uses Bible inventory (perfumes)." />
        </KpiGrid>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Section title="Daily revenue — last 30 days" tip="Stacked by category; dashed line = phased daily target">
          <TrendChart data={trend} height={270}
            series={[...ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), stack: "s" })), { key: "target", label: "Target", color: "#18181b", type: "line" as const, dashed: true }]} />
        </Section>
        <Section title="Category comparison" pad={false}>
          <div className="px-4 py-2"><CompareTable cols={cmp.cols} rows={cmp.rows} colors={cmp.data.map((d) => (d.key === "total" ? "#18181b" : catColor(d.key)))} /></div>
        </Section>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {pul.map((x) => (
          <div key={x.label} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <div className="text-[11.5px] font-medium uppercase tracking-wide text-zinc-500">{x.label}</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="tabular text-[18px] font-semibold">{inr(x.sales)}</span>
              <Delta v={x.growth} />
            </div>
            <div className="mt-0.5 text-[12px] text-zinc-500">{x.prevLabel} ({inr(x.prevSales)}) · {pct(x.ach, 0)} of target</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Section title="Top stores by achievement" right={<Link className="text-[12px] text-brand-600 hover:underline" href={withQs(ctx, "/stores")}>All stores →</Link>}>
          <BarList color="#10b981" format="inr" items={byAch.slice(0, 8).map((s) => ({ label: s.store, value: s.sales, sub: pct(s.ach, 0), href: withQs(ctx, `/stores/${s.branch_code}`) }))} />
        </Section>
        <Section title="Lowest achievement" right={<Link className="text-[12px] text-brand-600 hover:underline" href={withQs(ctx, "/exceptions/targets")}>Target misses →</Link>}>
          <BarList color="#f43f5e" items={byAch.slice(-8).reverse().map((s) => ({ label: s.store, value: s.sales, sub: pct(s.ach, 0), href: withQs(ctx, `/stores/${s.branch_code}`) }))} />
        </Section>
        <Section title="Top SKUs" right={<Link className="text-[12px] text-brand-600 hover:underline" href={withQs(ctx, "/products/skus")}>All SKUs →</Link>}>
          <BarList items={selling.slice(0, 8).map((s) => ({ label: s.name ?? s.sku, value: s.sales, sub: `${s.qty}u`, href: withQs(ctx, `/products/skus/${encodeURIComponent(s.sku)}`) }))} />
        </Section>
        <Section title="Bottom selling SKUs" tip="Lowest revenue among SKUs that sold at least once in the period">
          <BarList color="#a1a1aa" items={selling.slice(-8).reverse().map((s) => ({ label: s.name ?? s.sku, value: s.sales, sub: `${s.qty}u · ${s.stores} stores`, href: withQs(ctx, `/products/skus/${encodeURIComponent(s.sku)}`) }))} />
        </Section>
      </div>
    </>
  );
}
