import { pageContext, type SP } from "@/server/context";
import { loadScope } from "@/server/scope";
import { channelMetrics, CH_LABEL, ucChannel, type ChKey } from "@/server/channelData";
import { computePlan, dailyTarget, type Plan } from "@/server/plan";
import { getTargetBook } from "@/server/data/targetBook";
import { summarize } from "@/server/analytics";
import { catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, Section, Notice, DataPrompt, achTone } from "@/components/ui";
import { DailyTargetChart } from "@/components/charts/DailyTargetChart";
import { DataTable, type Col } from "@/components/table/DataTable";
import { inr, num, pct } from "@/lib/format";
import { addDays, eachDay, endOfMonth, fmtRange, minDate, monthsBetween, startOfMonth, weekday } from "@/lib/dates";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";

export const metadata = { title: "Daily Overview" };

export default async function DailyOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const { range, compare } = ctx.period;
  const ch = ctx.filters.channel, mp = ctx.filters.mp;
  const days = eachDay(range.from, minDate(range.to, ctx.today));
  const lwRange = { from: addDays(range.from, -7), to: addDays(range.to, -7) };
  const sc = await loadScope(ctx, [lwRange, { from: startOfMonth(range.from), to: endOfMonth(range.to) }]);
  const months = monthsBetween(range.from, range.to);
  const book = await getTargetBook(months[0], months[months.length - 1]);
  const th = ctx.settings.thresholds;
  const plans = new Map<string, Plan>(months.map((m) => [m, computePlan(sc.facts, sc.uc, minDate(endOfMonth(m), ctx.asOf), ch, book, ctx.filters.cats, th)]));
  const withStores = ch === "all" || ch === "stores";
  const withUc = ch !== "stores";

  const day = (d: string) => {
    const r = { from: d, to: d };
    const m = channelMetrics(sc.facts, sc.uc, r, ch, mp);
    const s = withStores ? summarize(sc.facts, r) : null;
    let orders = 0, mrp = s?.mrp ?? 0;
    for (const x of sc.uc) { const k = ucChannel(x.mp); if (x.d === d && k && (ch === "all" || ch === k) && (!mp || x.mp === mp)) { orders += x.orders; mrp += x.mrp; } }
    const split = Object.fromEntries((["stores", "online", "marketplace"] as ChKey[]).map((k) => [k, ch === "all" ? channelMetrics(sc.facts, sc.uc, r, k).revenue : null]));
    const byCat = Object.fromEntries(ctx.filters.cats.map((c) => [`c_${c}`, channelMetrics(sc.facts.filter((f) => f.c === c), sc.uc.filter((u) => u.c === c), r, ch, mp).revenue]));
    const target = plans.has(startOfMonth(d)) ? dailyTarget(plans.get(startOfMonth(d))!, sc.facts, book, d) : null;
    const lw = channelMetrics(sc.facts, sc.uc, { from: addDays(d, -7), to: addDays(d, -7) }, ch, mp).revenue;
    return {
      date: d, dow: weekday(d), revenue: m.revenue, target, ach: safeDiv(m.revenue, target), gap: target == null ? null : target - m.revenue,
      status: targetStatus(m.revenue, target, th), lw, vsLw: growth(m.revenue, lw), units: m.units, bills: s?.bills ?? null, orders: withUc ? orders : null,
      storesSelling: s?.storesSelling ?? null, asp: m.asp, atv: s && s.bills ? s.sales / s.bills : null, upt: s?.upt ?? null, disc: mrp > 0 ? 1 - m.revenue / mrp : null,
      partial: d >= ctx.today, ...split, ...byCat,
    };
  };
  const rows = days.map(day).reverse();
  const tot = channelMetrics(sc.facts, sc.uc, range, ch, mp), prev = channelMetrics(sc.facts, sc.uc, compare, ch, mp);
  const tTarget = rows.reduce<number | null>((a, r) => (r.target == null ? a : (a ?? 0) + r.target), null);
  const sTot = withStores ? summarize(sc.facts, range) : null;
  const best = [...rows].filter((r) => !r.partial).sort((a, b) => b.revenue - a.revenue)[0];
  const daysHit = rows.filter((r) => r.ach != null && r.ach >= th.onTrack).length, daysWithT = rows.filter((r) => r.target != null).length;
  const missing = [...plans.values()].flatMap((p) => p.missingPairs);

  const cols: Col[] = [
    { key: "date", label: "Date", type: "date", sub: "dow", width: 110 },
    { key: "revenue", label: "Revenue", type: "inr", bar: true },
    { key: "target", label: "Target", type: "inr", tip: "Phased daily target (Control Centre split; store targets for Stores)" },
    { key: "ach", label: "Achievement", type: "ach" },
    { key: "gap", label: "Gap", type: "inr", tip: "Target − revenue (negative = ahead)" },
    { key: "status", label: "Status", type: "status" },
    { key: "vsLw", label: "vs same day LW", type: "delta" },
    { key: "units", label: "Units", type: "num" },
    ...(withStores ? [{ key: "bills", label: "Bills", type: "num", tip: "Stores (DSR categories)" } as Col, { key: "storesSelling", label: "Stores selling", type: "num" } as Col] : []),
    ...(withUc ? [{ key: "orders", label: "Orders", type: "num", tip: "Online / Marketplace orders" } as Col] : []),
    { key: "asp", label: "ASP", type: "inrFull" },
    ...(withStores ? [{ key: "atv", label: "ATV", type: "inrFull", tip: "Stores revenue ÷ bills" } as Col, { key: "upt", label: "UPT", type: "num", tip: "Units per bill (Stores)" } as Col] : []),
    { key: "disc", label: "Discount", type: "pct", tip: "1 − revenue ÷ MRP value" },
    ...(ch === "all" ? (["stores", "online", "marketplace"] as ChKey[]).map((k) => ({ key: k, label: CH_LABEL[k], type: "inr", hidden: false } as Col)) : []),
    ...ctx.filters.cats.map((c) => ({ key: `c_${c}`, label: catLabel(c), type: "inr", hidden: ctx.filters.cats.length > 1 && ch === "all" } as Col)),
    { key: "lw", label: "Same day LW", type: "inr", hidden: true },
  ];
  const chartRows = [...rows].reverse().map((r) => ({ date: r.date, actual: r.revenue, target: r.target, units: r.units, lw: r.lw }));
  return (
    <>
      <PageHeader title="Daily Overview" subtitle={<>Day-by-day performance · {ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories"} · {ch === "all" ? "Overall" : CH_LABEL[ch]} · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel}</span></>} />
      {ctx.period.partial && <Notice tone="warn">Includes today — data is still arriving, so today is partial.</Notice>}
      {missing.length > 0 && <div className="mb-3"><DataPrompt compact title="Some slices have no target" href={ctx.user?.role === "admin" ? "/settings?tab=targets" : undefined} cta="Set targets">{[...new Set(missing)].slice(0, 6).join(", ")}{new Set(missing).size > 6 ? " …" : ""}. Daily target and achievement cover only slices with a target.</DataPrompt></div>}
      <KpiGrid cols={7}>
        <Kpi label="Revenue" value={inr(tot.revenue)} delta={growth(tot.revenue, prev.revenue)} deltaLabel="vs comparable" />
        <Kpi label="Target" value={tTarget != null ? inr(tTarget) : "Not set"} sub={tTarget != null ? `${pct(safeDiv(rows.reduce((a, r) => a + (r.target != null ? r.revenue : 0), 0), tTarget), 0)} achieved` : undefined} tone={tTarget != null ? achTone(safeDiv(rows.reduce((a, r) => a + (r.target != null ? r.revenue : 0), 0), tTarget), th) : undefined} />
        <Kpi label="Days on target" value={daysWithT ? `${daysHit} / ${daysWithT}` : "—"} sub={`≥${pct(th.onTrack, 0)} of the day's target`} />
        <Kpi label="Avg per day" value={inr(tot.revenue / Math.max(days.length, 1))} sub={best ? `best ${weekday(best.date)} ${best.date.slice(8)} · ${inr(best.revenue)}` : undefined} />
        <Kpi label="Units" value={num(tot.units)} delta={growth(tot.units, prev.units)} />
        <Kpi label="ASP" value={inr(tot.asp, { compact: false })} delta={growth(tot.asp, prev.asp)} />
        {withStores ? <Kpi label="Bills · UPT" value={num(sTot?.bills)} sub={sTot?.upt != null ? `${num(sTot.upt, 2)} units / bill · ATV ${inr(sTot.atv, { compact: false })}` : undefined} tip="Bills exist for DSR categories (Perfumes, Shoes)" />
          : <Kpi label="Orders" value={num(tot.orders)} sub={`${inr(safeDiv(tot.revenue, tot.orders), { compact: false })} per order`} />}
      </KpiGrid>
      <div className="mt-3">
        <Section title="Revenue vs target by day" tip="Bars coloured by achievement of the day's target; line = same weekday last week">
          <DailyTargetChart data={chartRows} height={240} />
        </Section>
      </div>
      <div className="mt-3">
        <DataTable title="Daily metrics" rows={rows} columns={cols} csvName={`daily-${range.from}-${range.to}`} height={620}
          totals={{ date: "Total", revenue: tot.revenue, target: tTarget, ach: safeDiv(rows.reduce((a, r) => a + (r.target != null ? r.revenue : 0), 0), tTarget), gap: tTarget == null ? null : tTarget - rows.reduce((a, r) => a + (r.target != null ? r.revenue : 0), 0), vsLw: growth(tot.revenue, rows.reduce((a, r) => a + r.lw, 0)), units: tot.units, bills: sTot?.bills ?? null, orders: tot.orders, asp: tot.asp }} />
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Per-category revenue columns are in the table’s column menu. Stores = DSR for Perfumes / Shoes, store sales lines for other categories; Online / Marketplace = Unicommerce items incl. cancellations.</p>
    </>
  );
}
