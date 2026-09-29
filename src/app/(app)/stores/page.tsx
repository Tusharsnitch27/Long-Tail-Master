import Link from "next/link";
import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { storeRows, groupFacts, summarize, monthOutlook } from "@/server/analytics";
import { getSkuFacts } from "@/server/data/sku";
import { getProductMap } from "@/server/data/products";
import { getStoreInventory, getStoreInventoryCoverage } from "@/server/data/inventory";
import { buildActions, actionStatuses } from "@/server/actions";
import { catLabel } from "@/server/views";
import { PageHeader, Tabs, Kpi, KpiGrid, Section, Delta } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { DataTable, type Col } from "@/components/table/DataTable";
import { StoreFilter } from "@/components/StoreFilter";
import { compactNum, inr, num, pct } from "@/lib/format";
import { addDays, fmtRange, weekday } from "@/lib/dates";
import { growth, safeDiv, targetStatus, STATUS_META, type TargetStatus } from "@/lib/metrics";
import { cn } from "@/lib/cn";

export const metadata = { title: "Store Overview" };

export default async function StoreOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const tab = ctx.sp.tab === "stores" ? "stores" : ctx.sp.tab === "dsr" ? "dsr" : "summary";
  const { range, compare } = ctx.period;
  const tabs = [
    { key: "summary", label: "Summary", href: withQs(ctx, "/stores", { tab: null }) },
    { key: "stores", label: "Stores", href: withQs(ctx, "/stores", { tab: "stores" }) },
    { key: "dsr", label: "DSR", href: withQs(ctx, "/stores", { tab: "dsr" }) },
  ];
  const th = ctx.settings.thresholds;
  const facts = await loadFacts(ctx, [{ from: addDays(ctx.asOf, -60), to: ctx.asOf }]);

  if (tab === "dsr") {
    const rows: Record<string, unknown>[] = [];
    const withData = new Set<string>();
    for (const [k, fs] of groupFacts(facts, (f) => `${f.d}|${f.b}|${f.c}`)) {
      const [d, b, c] = k.split("|");
      if (d < range.from || d > range.to) continue;
      const m = summarize(fs, { from: d, to: d });
      if (m.sales === 0 && !(m.target ?? 0)) continue;
      withData.add(b);
      const st = ctx.byCode.get(b);
      rows.push({ date: d, dow: weekday(d), b, store: st?.short_name ?? `Branch ${b}`, city: st?.city, category: catLabel(c), revenue: m.sales, units: m.qty, bills: m.bills, target: m.target, ach: m.ach, status: targetStatus(m.sales, m.target, th), asp: m.asp });
    }
    rows.sort((x, y) => String(y.date).localeCompare(String(x.date)) || (y.revenue as number) - (x.revenue as number));
    const cols: Col[] = [
      { key: "date", label: "Date", type: "date", sub: "dow" }, { key: "store", label: "Store", sub: "city", width: 200 }, { key: "category", label: "Category" },
      { key: "revenue", label: "Revenue", type: "inr" }, { key: "units", label: "Units", type: "num" }, { key: "bills", label: "Bills", type: "num" },
      { key: "target", label: "Target", type: "inr" }, { key: "ach", label: "Achievement", type: "ach" }, { key: "status", label: "Status", type: "status" }, { key: "asp", label: "ASP", type: "inrFull" },
    ];
    const tot = summarize(facts, range);
    return (
      <>
        <PageHeader title="Store Overview" subtitle={<>Daily store report · {fmtRange(range)} · store × category × day</>}
          right={<StoreFilter options={ctx.stores.filter((s) => withData.has(s.branch_code) || ctx.filters.stores.includes(s.branch_code)).map((s) => ({ value: s.branch_code, label: s.short_name, hint: s.city ?? undefined }))} />} />
        <Tabs active={tab} tabs={tabs} />
        <DataTable rows={rows} columns={cols} rowHref="/stores/{b}" csvName={`dsr-${range.from}-${range.to}`} height={700} searchKeys={["store", "city", "category", "date"]}
          totals={{ date: "Total", revenue: tot.sales, units: tot.qty, bills: tot.bills, target: tot.target, ach: tot.ach, asp: tot.asp }} />
        <p className="mt-2 text-[11.5px] text-zinc-500">Source: LONG_TAIL_DSR_* (net of discount) with store targets. The DSR tables carry no store inventory.</p>
      </>
    );
  }

  const [skus, pm, cov, act, statuses] = await Promise.all([
    getSkuFacts({ range, compare, asOf: ctx.asOf, cats: ctx.filters.cats, ch: "store" }), getProductMap(), getStoreInventoryCoverage(), buildActions(ctx), actionStatuses(),
  ]);
  const inv = await getStoreInventory([...pm.keys()]);
  const cats = new Set(ctx.filters.cats);
  const feed = new Set(cov.map((c) => String(c.b)));
  const stockBy = new Map<string, number>();
  for (const r of inv) if (cats.has(pm.get(r.sku)?.category ?? "")) stockBy.set(r.b, (stockBy.get(r.b) ?? 0) + r.units);
  const activeBy = new Map<string, number>();
  for (const f of skus) { const b = ctx.byName.get(f.ch.toUpperCase())?.branch_code; if (b && f.rq > 0 && cats.has(f.c)) activeBy.set(b, (activeBy.get(b) ?? 0) + 1); }
  const base = storeRows(facts, range, compare, ctx.byCode, th, ctx.filters.cats);
  const rows = base.map((r) => ({
    b: r.branch_code, store: r.store, city: r.city, region: r.region, revenue: r.sales, units: r.qty, growth: r.growth, target: r.target, ach: r.ach, status: r.status,
    perDay: safeDiv(r.sales, r.days), inventory: feed.has(r.branch_code) ? stockBy.get(r.branch_code) ?? 0 : null, activeSkus: activeBy.get(r.branch_code) ?? 0,
  }));
  const m = summarize(facts, range), p = summarize(facts, compare);
  const storeInvAll = [...pm.values()].filter((x) => x.category && cats.has(x.category)).reduce((a, x) => a + (x.invOffline ?? 0), 0);

  if (tab === "stores") {
    const cols: Col[] = [
      { key: "store", label: "Store", sub: "city", width: 210 }, { key: "revenue", label: "Revenue", type: "inr", bar: true }, { key: "growth", label: "Growth", type: "delta" },
      { key: "ach", label: "Target %", type: "ach" }, { key: "perDay", label: "Sales / day", type: "inr" },
      { key: "inventory", label: "Current inventory", type: "num", tip: "Latest store snapshot — stores in the store-inventory feed only" }, { key: "activeSkus", label: "Active products", type: "num" },
      { key: "units", label: "Units", type: "num", hidden: true }, { key: "target", label: "Target", type: "inr", hidden: true }, { key: "region", label: "Region", hidden: true }, { key: "status", label: "Status", type: "status", hidden: true },
    ];
    return (
      <>
        <PageHeader title="Store Overview" subtitle={<>Store ranking · {fmtRange(range)} · {ctx.period.compareLabel}</>} />
        <Tabs active={tab} tabs={tabs} />
        <DataTable rows={rows} columns={cols} rowHref="/stores/{b}" defaultSort={{ key: "revenue" }} csvName={`stores-${range.from}-${range.to}`} searchKeys={["store", "city", "region", "b"]} height={720}
          totals={{ store: "Total", revenue: m.sales, growth: growth(m.sales, p.sales), ach: m.ach }} />
      </>
    );
  }

  // Summary
  const bands = (["ahead", "on_track", "at_risk", "behind", "no_target"] as TargetStatus[]).map((s) => {
    const rs = rows.filter((r) => r.status === s);
    return { s, n: rs.length, rev: rs.reduce((a, r) => a + r.revenue, 0), gap: rs.reduce((a, r) => a + Math.max((r.target ?? 0) - r.revenue, 0), 0) };
  });
  const maxN = Math.max(...bands.map((b) => b.n), 1);
  const withTarget = rows.filter((r) => (r.target ?? 0) > 0);
  const best = [...withTarget].sort((a, b) => (b.ach ?? 0) - (a.ach ?? 0)).slice(0, 5);
  const worst = [...withTarget].sort((a, b) => (b.target! - b.revenue) - (a.target! - a.revenue)).slice(0, 5);
  const opps = act.actions.filter((a) => a.group === "store" && (statuses.get(a.key) ?? "open") === "open").slice(0, 4);
  const mo = monthOutlook(facts, ctx.asOf);
  return (
    <>
      <PageHeader title="Store Overview" subtitle={<>Retail execution · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel}</span></>} />
      <Tabs active={tab} tabs={tabs} />
      <KpiGrid cols={6}>
        <Kpi label="Revenue" value={inr(m.sales)} delta={growth(m.sales, p.sales)} deltaLabel="vs comparable" />
        <Kpi label="Units" value={num(m.qty)} delta={growth(m.qty, p.qty)} />
        <Kpi label="Target" value={inr(m.target)} sub={<><b className="font-semibold text-zinc-800">{pct(m.ach, 1)}</b> achieved</>} />
        <Kpi label="Stores selling" value={num(m.storesSelling)} sub={`of ${num(m.stores)} active`} />
        <Kpi label="Sales / store" value={inr(m.salesPerStore)} sub={`${inr(m.salesPerStoreDay)} per day`} />
        <Kpi label="Store inventory" value={compactNum(storeInvAll)} sub="units · all stores" />
      </KpiGrid>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr]">
        <Section title="Performance distribution" tip={`Achievement bands: ahead ≥${pct(th.ahead, 0)}, on track ≥${pct(th.onTrack, 0)}, at risk ≥${pct(th.atRisk, 0)}`}>
          <div className="space-y-2">{bands.map((b) => (
            <Link key={b.s} href={withQs(ctx, "/stores", { tab: "stores" })} className="-mx-2 grid grid-cols-[96px_1fr_36px_80px_90px] items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-zinc-50">
              <span className={cn("w-fit rounded px-1.5 py-0.5 text-[11px] font-medium ring-1", STATUS_META[b.s].cls)}>{STATUS_META[b.s].label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-zinc-100"><span className="block h-full rounded-full bg-ink" style={{ width: `${(b.n / maxN) * 100}%` }} /></span>
              <span className="tabular text-right font-semibold">{b.n}</span><span className="tabular text-right text-zinc-500">{inr(b.rev)}</span><span className="tabular text-right text-zinc-500">{b.gap ? `gap ${inr(b.gap)}` : ""}</span>
            </Link>
          ))}</div>
          <p className="mt-3 text-[11.5px] text-zinc-500">Month outlook: {pct(mo.projectedAch, 0)} projected · needs {inr(mo.requiredRunRate)}/day vs {inr(mo.currentRunRate)}/day now.</p>
        </Section>
        <Section title="Store opportunities" right={<Link href={withQs(ctx, "/actions", { group: "store" })} className="text-[11.5px] text-zinc-500 hover:text-ink">All →</Link>}>
          <div className="space-y-2">{opps.length ? opps.map((a) => <ActionCard key={a.key} a={a} compact qs={ctx.qs} />) : <div className="py-4 text-center text-[12.5px] text-zinc-500">No open store opportunities.</div>}</div>
        </Section>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Section title="Leading stores" tip="Highest target achievement">
          <ul className="space-y-1">{best.map((r) => (
            <li key={r.b}><Link href={withQs(ctx, `/stores/${r.b}`)} className="-mx-2 grid grid-cols-[1fr_80px_60px_60px] items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-zinc-50"><span className="truncate">{r.store}<span className="ml-1.5 text-[11px] text-zinc-400">{r.city}</span></span><span className="tabular text-right">{inr(r.revenue)}</span><span className="tabular text-right font-semibold text-emerald-600">{pct(r.ach, 0)}</span><Delta v={r.growth} className="text-right text-[11px]" /></Link></li>
          ))}</ul>
        </Section>
        <Section title="Store risks" tip="Largest rupee gaps to target in the period">
          <ul className="space-y-1">{worst.map((r) => (
            <li key={r.b}><Link href={withQs(ctx, `/stores/${r.b}`)} className="-mx-2 grid grid-cols-[1fr_80px_60px_80px] items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-zinc-50"><span className="truncate">{r.store}<span className="ml-1.5 text-[11px] text-zinc-400">{r.city}</span></span><span className="tabular text-right">{inr(r.revenue)}</span><span className="tabular text-right font-semibold text-rose-600">{pct(r.ach, 0)}</span><span className="tabular text-right text-zinc-500">gap {inr(r.target! - r.revenue)}</span></Link></li>
          ))}</ul>
        </Section>
      </div>
    </>
  );
}
