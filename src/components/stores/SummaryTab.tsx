import Link from "next/link";
import { withQs, type Ctx } from "@/server/context";
import type { Fact } from "@/server/data/facts";
import { computePlan, dailyTarget, EXEC_LABEL } from "@/server/plan";
import { getTargetBook } from "@/server/data/targetBook";
import { getSkuFacts } from "@/server/data/sku";
import { getProductMap } from "@/server/data/products";
import { buildActions, actionStatuses } from "@/server/actions";
import { catColor, catLabel } from "@/server/views";
import { catByKey } from "@/lib/categories";
import type { StoreModel } from "@/server/storeInsights";
import { Kpi, KpiGrid, Section, DataPrompt, Pill, achTone, Delta } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { DailyTargetChart } from "@/components/charts/DailyTargetChart";
import { SkuTabs, type SkuTab } from "@/components/SkuTabs";
import { StoreRank, Pointers, TodoPill, coverTone, days, ltLabel, type Pointer } from "./parts";
import { compactNum, inr, num, pct } from "@/lib/format";
import { addDays, addMonths, eachDay, endOfMonth, startOfMonth } from "@/lib/dates";
import { growth, safeDiv, STATUS_META, type TargetStatus } from "@/lib/metrics";
import { cn } from "@/lib/cn";

export async function SummaryTab({ ctx, facts, model }: { ctx: Ctx; facts: Fact[]; model: StoreModel }) {
  const th = ctx.settings.thresholds;
  const { range, compare } = ctx.period;
  const ms = startOfMonth(ctx.asOf), pms = addMonths(ms, -1);
  const [book, skus, pm, act, statuses] = await Promise.all([
    getTargetBook(pms, ms), getSkuFacts({ range, compare, asOf: ctx.asOf, cats: ctx.filters.cats, ch: "store" }), getProductMap(), buildActions(ctx), actionStatuses(),
  ]);
  const plan = computePlan(facts, [], ctx.asOf, "stores", book, ctx.filters.cats, th);
  const prevPlan = computePlan(facts, [], endOfMonth(pms), "stores", book, ctx.filters.cats, th);
  const hasT = plan.monthTarget != null;
  const admin = ctx.user?.role === "admin";
  const S = model.stores;
  const live = S.filter((s) => s.liveCats.length);

  // network totals (all stores in scope)
  const tot = S.reduce((a, s) => ({ sales: a.sales + s.sales, prev: a.prev + s.prev, qty: a.qty + s.qty, mrp: a.mrp + s.mrp, bills: a.bills + (s.bills ?? 0), bS: a.bS + s.billSales, bQ: a.bQ + s.billQty,
    inv: a.inv + s.inv, s30: a.s30 + s.s30, su: a.su + (s.liveCats.length ? s.storeUnits30 : 0) }), { sales: 0, prev: 0, qty: 0, mrp: 0, bills: 0, bS: 0, bQ: 0, inv: 0, s30: 0, su: 0 });
  const prevQty = facts.reduce((a, f) => (f.d >= compare.from && f.d <= compare.to ? a + f.q : a), 0);
  const billStores = S.filter((s) => s.billLive).length;
  const stockOutCells = S.reduce((a, s) => a + s.stockOuts.length, 0), stockOutStores = S.filter((s) => s.stockOuts.length).length;
  const withT = live.filter((s) => (s.target ?? 0) > 0);
  const ahead = withT.filter((s) => (s.ach ?? 0) >= th.onTrack).length, behind = withT.filter((s) => (s.ach ?? 0) < th.atRisk).length;

  // daily revenue vs target, last 30 days (grouped once)
  const byDay = new Map<string, { s: number; q: number }>();
  for (const f of facts) { const x = byDay.get(f.d) ?? { s: 0, q: 0 }; x.s += f.s; x.q += f.q; byDay.set(f.d, x); }
  const daily = eachDay(addDays(ctx.asOf, -29), ctx.asOf).map((d) => ({
    date: d, actual: byDay.get(d)?.s ?? 0, units: byDay.get(d)?.q ?? 0, lw: byDay.get(addDays(d, -7))?.s ?? null,
    target: dailyTarget(d >= ms ? plan : prevPlan, facts, book, d),
  }));

  // bands among live stores
  const bands = (["ahead", "on_track", "at_risk", "behind", "no_target"] as TargetStatus[]).map((s) => {
    const rs = live.filter((r) => r.tstatus === s);
    return { s, n: rs.length, rev: rs.reduce((a, r) => a + r.sales, 0), gap: rs.reduce((a, r) => a + Math.max(r.gap ?? 0, 0), 0) };
  });
  const maxN = Math.max(...bands.map((b) => b.n), 1);
  const ranked = [...withT].sort((a, b) => (b.ach ?? 0) - (a.ach ?? 0));
  const top = ranked.slice(0, 10), bottom = [...ranked].reverse().slice(0, 10);
  const hrefOf = (b: string) => withQs(ctx, `/stores/${b}`);
  const nonLive = S.filter((s) => s.nonLiveTarget > 0);
  const billCats = ctx.filters.cats.filter((c) => catByKey(c)?.source === "dsr").map(catLabel).join(" + ") || "no bill data";
  const storeT = withT.reduce((a, s) => a + (s.target ?? 0), 0), storeS = withT.reduce((a, s) => a + (s.ach ?? 0) * (s.target ?? 0), 0);
  const storeAch = safeDiv(storeS, storeT);
  const nonLiveT = nonLive.reduce((a, s) => a + s.nonLiveTarget, 0);

  // top SKUs in stores (respect store filter)
  const storeNames = ctx.filters.stores.length ? new Set(ctx.filters.stores.map((b) => ctx.byCode.get(b)?.store_name.toUpperCase()).filter(Boolean)) : null;
  const skuAgg = new Map<string, { c: string; s: number; q: number; p: number; st: Set<string> }>();
  for (const f of skus) {
    if (storeNames && !storeNames.has(f.ch.toUpperCase())) continue;
    const x = skuAgg.get(f.sku) ?? { c: f.c, s: 0, q: 0, p: 0, st: new Set<string>() };
    x.s += f.rs; x.q += f.rq; x.p += f.ps; if (f.rq > 0) x.st.add(f.ch);
    skuAgg.set(f.sku, x);
  }
  const skuRows = [...skuAgg].filter(([, x]) => x.q > 0).sort((a, b) => b[1].s - a[1].s);
  const topTabs: SkuTab[] = ctx.filters.cats.map((c) => ({
    key: c, label: catLabel(c), color: catColor(c),
    rows: skuRows.filter(([, x]) => x.c === c).slice(0, 10).map(([sku, x]) => {
      const p = pm.get(sku);
      return { sku, name: p?.name ?? sku, image: p?.image ?? null, revenue: x.s, units: x.q, growth: growth(x.s, x.p), note: `${x.st.size} stores · ${num(p?.invOffline ?? null)} in stores` };
    }),
  })).filter((t) => t.rows.length);

  // to-dos across the network
  const todos = S.flatMap((s) => s.todos.filter((t) => t.kind !== "ok").slice(0, 2).map((t) => ({ s, t }))).sort((a, b) => b.t.weight - a.t.weight).slice(0, 8);
  const opps = act.actions.filter((a) => a.group === "store" && (statuses.get(a.key) ?? "open") === "open").slice(0, 4);

  // pointers
  const bySize = [...S].filter((s) => s.inFeed).sort((a, b) => b.storeUnits30 - a.storeUnits30).slice(0, 10);
  const pointers: Pointer[] = [];
  if (hasT && plan.projectedAch != null) pointers.push({ tone: plan.projectedAch >= th.onTrack ? "positive" : "negative", text: <>Stores are projected to close the month at <b>{pct(plan.projectedAch, 0)}</b> of target ({inr(plan.projected)}); {plan.requiredRunRate != null ? <>needs <b>{inr(plan.requiredRunRate)}/day</b> vs {inr(plan.currentRunRate)}/day now.</> : "month complete."}</> });
  if (withT.length) pointers.push({ tone: behind > ahead ? "negative" : "positive", text: <><b>{ahead}</b> of {withT.length} live stores with a target are on track or ahead; <b>{behind}</b> are below {pct(th.atRisk, 0)} — together {inr(bands.find((b) => b.s === "behind")?.gap ?? 0)} short.</>, href: withQs(ctx, "/stores", { tab: "stores" }) });
  for (const c of model.cats) {
    const miss = bySize.filter((s) => !s.cells[c.c]?.live);
    if (miss.length) pointers.push({ tone: "negative", text: <>{miss.length} of the top 10 stores (by total store units) don’t have <b>{catLabel(c.c)}</b> live: {miss.slice(0, 3).map((s) => s.store).join(", ")}{miss.length > 3 ? ` +${miss.length - 3}` : ""}.</>, href: withQs(ctx, "/stores", { tab: "distribution", dc: c.c }) });
  }
  if (stockOutStores) pointers.push({ tone: "negative", text: <><b>{stockOutStores}</b> stores have a live category at zero stock ({stockOutCells} store × category stock-outs) — restock before pushing sales.</>, href: withQs(ctx, "/stores", { tab: "dsr" }) });
  if (nonLiveT > 0) pointers.push({ tone: "neutral", text: <>{inr(nonLiveT)} of month target sits on {nonLive.length} stores where that category isn’t live — excluded from achievement; reallocate or launch.</> });
  const lts = ["HS", "MALL"].map((k) => { const ss = live.filter((s) => s.lt === k); return { k, n: ss.length, pd: safeDiv(ss.reduce((a, s) => a + s.sales, 0), ss.length * model.days) }; });
  if (lts.every((x) => x.n && x.pd)) { const [h, m] = lts; const hi = h.pd! >= m.pd! ? h : m, lo = hi === h ? m : h; pointers.push({ tone: "neutral", text: <>{ltLabel(hi.k)} stores sell <b>{inr(hi.pd)}</b>/store/day vs {inr(lo.pd)} in {ltLabel(lo.k).toLowerCase()} stores ({pct(hi.pd! / lo.pd! - 1, 0)} higher).</>, href: withQs(ctx, "/stores", { tab: "formats" }) }); }

  return (
    <>
      {plan.missingPairs.length > 0 && (
        <div className="mb-3"><DataPrompt compact title={hasT ? `Stores target missing for ${plan.missingPairs.length} categor${plan.missingPairs.length > 1 ? "ies" : "y"}` : "No Stores target set for this selection"} href={admin ? "/settings?tab=targets" : undefined} cta="Set targets">
          {plan.missingPairs.join(", ")}. Achievement and projection cover only categories with a target.
        </DataPrompt></div>
      )}
      <KpiGrid cols={8}>
        <Kpi label="Revenue" value={inr(tot.sales)} delta={growth(tot.sales, tot.prev)} deltaLabel="vs comparable" />
        <Kpi label="Achievement · MTD" value={hasT ? pct(plan.achievement, 1) : "—"} tone={hasT ? achTone(plan.achievement, th) : undefined} sub={hasT ? `${inr(plan.coveredRevenue)} of ${inr(plan.mtdTarget)}` : "target not set"} tip="Stores MTD revenue ÷ phased MTD target (Control Centre / store targets)" />
        <Kpi label="Month-end projection" value={inr(plan.projected)} sub="projection · not actual" tip="Target categories: MTD achievement × month target. Others: current daily rate × days in month." />
        <Kpi label="Projected achievement" value={pct(plan.projectedAch, 0)} tone={hasT ? achTone(plan.projectedAch, th) : undefined} sub={plan.projectedGap != null ? (plan.projectedGap > 0 ? `${inr(plan.projectedGap)} short` : `${inr(-plan.projectedGap)} over`) : undefined} />
        <Kpi label="Required run rate" value={hasT ? inr(plan.requiredRunRate) : "—"} sub={<>{plan.remainingDays} days left{hasT && plan.runRateGap != null ? <> · <span className={plan.runRateGap > 0 ? "text-rose-600" : "text-emerald-700"}>{plan.runRateGap > 0 ? "+" : ""}{pct(plan.runRateGap, 0)} vs now</span></> : null}</>} tip={`Current: ${inr(plan.currentRunRate)}/day`} />
        <Kpi label="Live stores" value={num(live.length)} sub={withT.length ? <><span className="text-emerald-700">{pct(ahead / withT.length, 0)} on track</span> · <span className="text-rose-600">{pct(behind / withT.length, 0)} behind</span></> : `of ${S.length} with data`} tip={`A category is live in a store when it has stock on the latest store report or sold in the last 60 days`} />
        <Kpi label="Sales / store / day" value={inr(safeDiv(tot.sales, live.length * model.days))} sub={`${num(safeDiv(tot.qty, live.length * model.days), 2)} units / store / day`} delta={growth(safeDiv(tot.sales, live.length), safeDiv(tot.prev, live.length))} tip="Revenue ÷ (live stores × days in period)" />
        <Kpi label="ASP" value={inr(safeDiv(tot.sales, tot.qty), { compact: false })} delta={growth(safeDiv(tot.sales, tot.qty), safeDiv(tot.prev, prevQty))} sub={`discount ${pct(tot.mrp > 0 ? 1 - tot.sales / tot.mrp : null, 1)}`} tip="Revenue ÷ units; discount = 1 − revenue ÷ MRP value" />
      </KpiGrid>
      {plan.mismatches.length > 0 && (
        <div className="mt-3"><DataPrompt compact title="Store targets don’t add up to the plan" href={admin ? "/settings?tab=targets" : undefined} cta="Review">
          {plan.mismatches.map((x) => `${catLabel(x.c)}: plan ${inr(x.catTarget)} vs Σ store targets ${inr(x.storeSum)}`).join(" · ")}. Plan metrics use the plan; store rankings use store targets.
        </DataPrompt></div>
      )}
      <div className="mt-2.5"><KpiGrid cols={7}>
        <Kpi label="Store-target achievement" value={pct(storeAch, 1)} tone={storeT ? achTone(storeAch, th) : undefined} sub={storeT ? `${inr(storeS)} of ${inr(storeT)} · live cells` : "no store targets"} tip="Period revenue ÷ store-level targets on live store × category cells. Differs from the plan when category targets exceed Σ store targets or targets sit on non-live categories." />
        <Kpi label={`ATV · ${billCats}`} value={inr(safeDiv(tot.bS, tot.bills), { compact: false })} sub={`${num(tot.bills)} bills`} tip="Average bill value on bills carrying Perfumes or Shoes (only these DSR categories report bills; a bill with both counts in each)" />
        <Kpi label={`UPT · ${billCats}`} value={num(safeDiv(tot.bQ, tot.bills), 2)} sub="units per bill" />
        <Kpi label="Bills / store / day" value={num(safeDiv(tot.bills, billStores * model.days), 1)} sub={`${billStores} stores · ${billCats}`} />
        <Kpi label="Long-tail penetration" value={pct(safeDiv(tot.s30, tot.su), 1)} sub="of store units · L30" tip="In-scope category L30 units ÷ total L30 units of the same (live) stores across ALL categories, from the store report. Proxy for bill penetration." />
        <Kpi label="Store inventory" value={compactNum(tot.inv)} sub={<>cover <b className="font-semibold text-zinc-800">{days(tot.s30 > 0 ? tot.inv / (tot.s30 / 30) : null)}</b> at L30 rate</>} tip={`Latest store report${model.invDate ? ` (${model.invDate})` : ""} — ${model.feedStores} stores in the feed`} />
        <Kpi label="Stock-outs" value={num(stockOutCells)} tone={stockOutCells ? "bad" : "good"} sub={`${stockOutStores} stores · live category at 0 stock`} href={withQs(ctx, "/stores", { tab: "dsr" })} />
      </KpiGrid></div>
      <div className="mt-3"><DataPrompt compact title="True bill penetration needs total store bills">
        Long-tail penetration above uses units from the store report (category units ÷ all store units). To measure the share of store bills that include a long-tail item, total store bills per day need to be uploaded.
      </DataPrompt></div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Daily Stores revenue vs target · last 30 days" tip="Bars coloured by achievement of that day's phased target"
          right={<span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium ring-1", STATUS_META[plan.status].cls)}>{EXEC_LABEL[plan.status]}</span>}>
          <DailyTargetChart name="stores-daily-revenue-vs-target" data={daily} height={240} />
        </Section>
        <Section title="Key pointers" tip="Computed from this period's store data — click through for the list">
          <Pointers items={pointers.slice(0, 7)} />
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr]">
        <Section title="Achievement distribution · live stores" tip={`Achievement for the selected period on live store × category cells. Ahead ≥${pct(th.ahead, 0)}, on track ≥${pct(th.onTrack, 0)}, at risk ≥${pct(th.atRisk, 0)}`}>
          <div className="space-y-1.5">{bands.map((b) => (
            <div key={b.s} className="grid grid-cols-[96px_1fr_36px_80px_96px] items-center gap-2 text-[12px]">
              <span className={cn("w-fit rounded px-1.5 py-0.5 text-[11px] font-medium ring-1", STATUS_META[b.s].cls)}>{STATUS_META[b.s].label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-brand-50"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(b.n / maxN) * 100}%` }} /></span>
              <span className="tabular text-right font-semibold">{b.n}</span><span className="tabular text-right text-zinc-500">{inr(b.rev)}</span><span className="tabular text-right text-zinc-500">{b.gap ? `gap ${inr(b.gap)}` : ""}</span>
            </div>
          ))}</div>
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 text-[11px] font-medium text-zinc-500">Category scorecard · live stores</div>
            <table className="w-full whitespace-nowrap text-[12px]">
              <thead><tr className="text-[10.5px] text-zinc-400">{["Category", "Live", "Sales / store / day", "Ach.", "Proj.", "Cover", "Stock-outs"].map((h, i) => <th key={h} className={cn("py-1 font-medium", i ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
              <tbody>{model.cats.map((c) => (
                <tr key={c.c} className="border-t border-brand-50">
                  <td className="py-1.5"><span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: catColor(c.c) }} />{catLabel(c.c)}</span></td>
                  <td className="tabular text-right">{c.liveStores}<span className="text-zinc-400">/{c.liveStores + c.notLive}</span></td>
                  <td className="tabular text-right">{inr(c.perLiveStoreDay)}</td>
                  <td className="text-right">{c.ach == null ? <span className="text-zinc-400">—</span> : <Pill tone={achTone(c.ach, th)}>{pct(c.ach, 0)}</Pill>}</td>
                  <td className="tabular text-right">{pct(c.projAch, 0)}</td>
                  <td className="text-right">{c.cover == null ? "—" : <Pill tone={coverTone(c.cover)}>{days(c.cover)}</Pill>}</td>
                  <td className={cn("tabular text-right", c.stockOuts ? "text-rose-600" : "text-zinc-400")}>{c.stockOuts}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
        <Section title="Store to-dos" tip="Highest-priority computed actions across stores (stock-outs, pace, low cover, declines, dead stock)" right={<Link href={withQs(ctx, "/stores", { tab: "dsr" })} className="text-[11.5px] text-zinc-500 hover:text-ink">DSR →</Link>}>
          {todos.length ? <ul className="divide-y divide-zinc-100">{todos.map(({ s, t }, i) => (
            <li key={i}><Link href={hrefOf(s.b)} className="-mx-2 flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-brand-50/50">
              <TodoPill t={t} />
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug"><b className="font-medium">{s.store}</b><span className="text-zinc-400"> · {s.city}</span><span className="block text-zinc-600">{t.text}</span></span>
            </Link></li>
          ))}</ul> : <div className="py-6 text-center text-[12.5px] text-zinc-500">No store needs attention.</div>}
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Section title="Top 10 stores by achievement" tip="Live store × category cells with a target in the selected period">
          <StoreRank rows={top} hrefOf={hrefOf} metric="ach" th={th} empty="No live store has a target in this period." />
        </Section>
        <Section title="Lowest 10 stores by achievement" tip="Where the rupee gap and required run rate matter most. Targets on non-live categories are excluded.">
          <StoreRank rows={bottom} hrefOf={hrefOf} metric="ach" th={th} empty="No live store has a target in this period." />
        </Section>
      </div>

      {nonLive.length > 0 && (
        <div className="mt-3"><Section title={`Targets on categories that aren’t live · ${nonLive.length} stores`} tip="No stock on the latest store report and no sale in 60 days — these targets are excluded from store achievement">
          <div className="flex flex-wrap gap-1.5">{nonLive.sort((a, b) => b.nonLiveTarget - a.nonLiveTarget).slice(0, 24).map((s) => (
            <Link key={s.b} href={hrefOf(s.b)} className="rounded-md bg-brand-50 px-2 py-1 text-[11.5px] text-brand-900 ring-1 ring-brand-100 hover:ring-brand-300">
              {s.store} · {s.nonLiveTargetCats.map(catLabel).join(", ")} · <b>{inr(s.nonLiveTarget)}</b>
            </Link>
          ))}</div>
          <p className="mt-2 text-[11.5px] text-zinc-500">Total {inr(nonLiveT)}. Reallocate these targets to live stores in the Control Centre, or launch the category (see Distribution &amp; expansion).</p>
        </Section></div>
      )}

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Section title="Top SKUs in stores" tip="By Stores revenue in the selected period; note = stores that sold it · units in stores now">
          <SkuTabs tabs={topTabs} qs={ctx.qs} />
        </Section>
        <Section title="Store opportunities" right={<Link href={withQs(ctx, "/actions", { group: "store" })} className="text-[11.5px] text-zinc-500 hover:text-ink">All →</Link>}>
          <div className="space-y-2">{opps.length ? opps.map((a) => <ActionCard key={a.key} a={a} compact qs={ctx.qs} />) : <div className="py-4 text-center text-[12.5px] text-zinc-500">No open store opportunities.</div>}</div>
        </Section>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Stores = DSR (gross sales) for Perfumes / Shoes, store sales lines for other categories. Store stock and store units from the latest store report{model.invDate ? ` (${model.invDate})` : ""}. Growth <Delta v={growth(tot.sales, tot.prev)} className="text-[11px]" /> {ctx.period.compareLabel}.</p>
    </>
  );
}
