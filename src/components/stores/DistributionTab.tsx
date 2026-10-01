import Link from "next/link";
import { withQs, type Ctx } from "@/server/context";
import { expansionCandidates, cityGaps, underPenetrated, RULE, LIVE_LOOKBACK, type StoreModel } from "@/server/storeInsights";
import { catColor, catLabel } from "@/server/views";
import { Section, Kpi, KpiGrid, DataPrompt, Tip } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { Pointers, LiveLegend, ltLabel, ctLabel, type Pointer } from "./parts";
import { inr, num, pct } from "@/lib/format";
import { cn } from "@/lib/cn";

const TOPN = 25;

export function DistributionTab({ ctx, model }: { ctx: Ctx; model: StoreModel }) {
  const cats = model.cats.map((c) => c.c);
  const dcParam = typeof ctx.sp.dc === "string" ? ctx.sp.dc : null;
  const dc = ctx.filters.cat ?? (dcParam && cats.includes(dcParam) ? dcParam : cats.includes("shoes") ? "shoes" : cats[0]);
  if (!dc) return <DataPrompt title="No categories in scope">Enable categories in the Control Centre.</DataPrompt>;
  if (!model.invDate) return <DataPrompt title="Store report not available">Distribution needs the latest store report (OFFLINE_MASTER_DAILY_REPORT_1) for store stock and store size.</DataPrompt>;

  const inFeed = model.stores.filter((s) => s.inFeed && s.storeUnits30 > 0);
  const bySize = [...inFeed].sort((a, b) => b.storeUnits30 - a.storeUnits30);
  const top10 = bySize.slice(0, 10), topN = bySize.slice(0, TOPN);
  const hrefOf = (b: string) => withQs(ctx, `/stores/${b}`);

  // per-category distribution summary
  const dist = cats.map((c) => {
    const cand = expansionCandidates(model, c);
    const gaps = cityGaps(model, c);
    const under = underPenetrated(model, c);
    const live = inFeed.filter((s) => s.cells[c]?.live).length;
    return {
      c, live, network: inFeed.length, top10: top10.filter((s) => s.cells[c]?.live).length, topN: topN.filter((s) => s.cells[c]?.live).length,
      missTop10: top10.filter((s) => !s.cells[c]?.live), cityGaps: gaps, cand, under,
      stockOuts: model.stores.filter((s) => s.cells[c]?.stockOut).length, dead: model.stores.filter((s) => s.cells[c]?.dead).length,
      potential: cand.slice(0, 10).reduce((a, r) => a + (r.revenue30 ?? 0), 0), underGap: under.slice(0, 10).reduce((a, r) => a + (r.gapRevenue ?? 0), 0),
    };
  });
  const cur = dist.find((d) => d.c === dc)!;

  const weighted: (Pointer & { w: number })[] = [];
  for (const d of dist) if (d.missTop10.length) weighted.push({ w: 1e9 + d.missTop10.length, tone: "negative", href: withQs(ctx, "/stores", { tab: "distribution", dc: d.c }), text: <>{d.missTop10.length} of the top 10 stores don’t have <b>{catLabel(d.c)}</b> live: {d.missTop10.slice(0, 3).map((s) => s.store).join(", ")}{d.missTop10.length > 3 ? ` +${d.missTop10.length - 3}` : ""}.</> });
  for (const d of dist) if (d.potential > 0) weighted.push({ w: d.potential, tone: "positive", href: withQs(ctx, "/stores", { tab: "distribution", dc: d.c }), text: <>Launching <b>{catLabel(d.c)}</b> in the 10 strongest non-live stores ≈ <b>{inr(d.potential)}</b>/month (estimate){d.cand[0] ? <> — start with {d.cand[0].store}</> : null}.</> });
  for (const d of dist) if (d.cityGaps.length) { const g = d.cityGaps[0]; weighted.push({ w: g.potential30 ?? 0, tone: "neutral", href: withQs(ctx, "/stores", { tab: "distribution", dc: d.c }), text: <><b>{catLabel(d.c)}</b> is not live in any store in {d.cityGaps.length} {d.cityGaps.length > 1 ? "cities" : "city"}; largest: {g.city} — try <b>{g.best.store}</b>{g.potential30 ? <> (≈{inr(g.potential30)}/month at peer penetration)</> : null}.</> }); }
  for (const d of dist) if (d.under.length >= 3) weighted.push({ w: d.underGap, tone: "neutral", href: withQs(ctx, "/stores", { tab: "distribution", dc: d.c }), text: <><b>{d.under.length}</b> stores carry {catLabel(d.c)} but sell under half their format peers’ share — fix placement / depth{d.underGap ? <> (top 10 ≈ {inr(d.underGap)}/month)</> : null}.</> });
  for (const d of dist) if (d.dead >= 3) weighted.push({ w: d.dead * 1000, tone: "negative", href: withQs(ctx, "/stores", { tab: "distribution", dc: d.c }), text: <><b>{d.dead}</b> stores hold {catLabel(d.c)} with no sale in 30 days — transfer that stock to launch candidates.</> });
  const pointers: Pointer[] = weighted.sort((a, b) => b.w - a.w);

  const candCols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 210 }, { key: "state", label: "State" }, { key: "lt", label: "Format" }, { key: "ct", label: "City type" },
    { key: "storeUnits30", label: "Store units L30", type: "num", bar: true, tip: "All categories incl. apparel — store size / footfall proxy" }, { key: "area", label: "Carpet area", type: "num" },
    { key: "cityLive", label: "Live in city", type: "num", tip: `Other stores in the city where ${catLabel(dc)} is live (0 = city gap)` },
    { key: "peerPen", label: "Peer penetration", type: "pct", tip: "Median category share of store units among live stores of the same format (≥5 peers; else all live stores)" },
    { key: "units30", label: "Est. units / month", type: "num" }, { key: "revenue", label: "Est. revenue / month", type: "inr", tip: "Store units × peer penetration × category ASP — a calculated estimate, not a forecast" },
    { key: "target", label: "Target set", type: "inr", tip: "Month target already set on this non-live category" },
  ];
  const candRows = cur.cand.map((r) => ({ ...r, lt: ltLabel(r.lt), ct: ctLabel(r.ct), revenue: r.revenue30 }));
  const underRows = cur.under.map((r) => ({ ...r, lt: ltLabel(r.lt), revenue: r.gapRevenue }));
  const stockRows = model.stores.flatMap((s) => { const x = s.cells[dc]; return x && (x.stockOut || x.dead) ? [{ b: s.b, store: s.store, city: s.city, kind: x.stockOut ? "Stock-out" : "Dead stock", inv: x.inv, s30: x.s30, revenue: x.w.r.s, last: x.lastSale }] : []; });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11.5px] text-zinc-500">Category</span>
        {cats.map((c) => (
          <Link key={c} href={withQs(ctx, "/stores", { tab: "distribution", dc: c })} scroll={false}
            className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]", c === dc ? "border-brand-700 bg-brand-900 text-white" : "border-line bg-white text-zinc-600 hover:border-brand-300", ctx.filters.cat && c !== dc && "pointer-events-none opacity-50")}>
            <span className="size-1.5 rounded-full" style={{ background: c === dc ? "#fff" : catColor(c) }} />{catLabel(c)}
          </Link>
        ))}
      </div>
      <KpiGrid cols={6}>
        <Kpi label={`${catLabel(dc)} · live stores`} value={`${cur.live} / ${cur.network}`} sub={`${pct(cur.live / (cur.network || 1), 0)} of stores in the store report`} tip={`Live = stock on the latest store report or a sale in the last ${LIVE_LOOKBACK} days`} />
        <Kpi label="Top 10 stores covered" value={`${cur.top10} / ${Math.min(10, bySize.length)}`} tone={cur.top10 >= Math.min(10, bySize.length) ? "good" : "bad"} sub={`top ${TOPN}: ${cur.topN} / ${topN.length}`} tip="Top stores by total L30 units across all categories" />
        <Kpi label="Cities with no live store" value={num(cur.cityGaps.length)} tone={cur.cityGaps.length ? "warn" : "good"} sub={cur.cityGaps[0] ? `largest: ${cur.cityGaps[0].city}` : "full city coverage"} />
        <Kpi label="Launch potential · top 10" value={inr(cur.potential)} sub="per month · estimate" tip="10 strongest non-live stores × format peer penetration × category ASP" />
        <Kpi label="Under-penetrated stores" value={num(cur.under.length)} sub={cur.underGap ? `≈${inr(cur.underGap)}/month (top 10)` : "vs format peers"} tip={`Live stores whose category share of units is below ${pct(RULE.underPenRatio, 0)} of the format peer median`} />
        <Kpi label="Stock-out · dead stock" value={<><span className="text-rose-600">{cur.stockOuts}</span> · <span className="text-amber-700">{cur.dead}</span></>} sub="stores" tip={`Stock-out: live, 0 units in store. Dead: ≥${RULE.deadMinUnits} units, no sale in 30 days.`} />
      </KpiGrid>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.5fr_1fr]">
        <Section title={`Range coverage · top ${TOPN} stores by size`} tip="Store size = total L30 units across all categories (store report). Cell = category units sold per day (L30)." right={<LiveLegend />}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[12px]">
              <thead><tr className="border-b border-line text-[11px] text-zinc-500">
                <th className="py-1.5 pr-2 text-left font-medium">#</th><th className="px-2 text-left font-medium">Store</th><th className="px-2 text-right font-medium">Units / day</th>
                {cats.map((c) => <th key={c} className={cn("px-1 text-center font-medium", c === dc && "text-brand-700")}>{catLabel(c)}</th>)}
              </tr></thead>
              <tbody>{topN.map((s, i) => (
                <tr key={s.b} className="border-b border-brand-50 last:border-0">
                  <td className="tabular py-1 pr-2 text-[11px] text-zinc-400">{i + 1}</td>
                  <td className="max-w-[200px] px-2"><Link href={hrefOf(s.b)} className="block truncate font-medium hover:underline">{s.store}</Link><span className="text-[10.5px] text-zinc-400">{s.city} · {ltLabel(s.lt)}</span></td>
                  <td className="tabular px-2 text-right text-zinc-500">{num(s.storeUnits30 / 30)}</td>
                  {cats.map((c) => {
                    const x = s.cells[c];
                    return (
                      <td key={c} className="px-1 py-1 text-center">
                        {x?.live ? (x.stockOut
                          ? <span className="inline-block min-w-12 rounded bg-rose-400 px-1.5 py-0.5 text-[10.5px] font-semibold text-white" title="Live but 0 units in store">0 stock</span>
                          : <span className="tabular inline-block min-w-12 rounded bg-brand-500 px-1.5 py-0.5 text-[10.5px] font-semibold text-white" style={{ opacity: 0.45 + Math.min((x.pen ?? 0) / ((model.peerPen(c, s.lt) ?? 0.01) * 2), 1) * 0.55 }} title={`${num(x.inv)} in store · ${pct(x.pen, 1)} of store units`}>{num(x.s30 / 30, 1)}</span>)
                          : <span className="inline-block min-w-12 rounded border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10.5px] text-zinc-400">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
        <Section title="Distribution pointers" tip="Computed from the store report and sales; potentials are estimates at format-peer penetration">
          <Pointers items={pointers.slice(0, 9)} empty="Every category is live in the top stores and every city." />
        </Section>
      </div>

      <div className="mt-3">
        <Section title="Distribution by category" pad={false}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead><tr className="border-b border-line text-[11px] text-zinc-500">
                {[["Category"], ["Live stores"], ["% of stores"], ["Top 10"], [`Top ${TOPN}`], ["Cities w/o"], ["Stock-outs"], ["Dead stock"], ["Under-penetrated"], ["Launch potential", "Top 10 non-live stores, per month (estimate)"], ["Penetration fix", "Top 10 under-penetrated stores brought to the format peer median share, per month (estimate)"]].map(([h, t], i) => (
                  <th key={h} className={cn("px-3 py-2 font-medium", i ? "text-right" : "text-left")}><span className="inline-flex items-center gap-1">{h}{t && <Tip text={t} />}</span></th>
                ))}
              </tr></thead>
              <tbody>{dist.map((d) => (
                <tr key={d.c} className={cn("border-b border-brand-50 last:border-0 hover:bg-brand-50/40", d.c === dc && "bg-brand-50/40")}>
                  <td className="px-3 py-2"><Link href={withQs(ctx, "/stores", { tab: "distribution", dc: d.c })} className="flex items-center gap-1.5 font-medium hover:underline"><span className="size-2 rounded-full" style={{ background: catColor(d.c) }} />{catLabel(d.c)}</Link></td>
                  <td className="tabular px-3 text-right">{d.live}<span className="text-zinc-400"> / {d.network}</span></td>
                  <td className="tabular px-3 text-right">{pct(d.live / (d.network || 1), 0)}</td>
                  <td className={cn("tabular px-3 text-right", d.top10 < Math.min(10, bySize.length) && "font-semibold text-rose-600")}>{d.top10}</td>
                  <td className="tabular px-3 text-right">{d.topN}</td>
                  <td className="tabular px-3 text-right">{d.cityGaps.length}</td>
                  <td className={cn("tabular px-3 text-right", d.stockOuts && "text-rose-600")}>{d.stockOuts}</td>
                  <td className={cn("tabular px-3 text-right", d.dead && "text-amber-700")}>{d.dead}</td>
                  <td className="tabular px-3 text-right">{d.under.length}</td>
                  <td className="tabular px-3 text-right font-medium">{d.potential ? inr(d.potential) : "—"}</td>
                  <td className="tabular px-3 text-right">{d.underGap ? inr(d.underGap) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      </div>

      <div className="mt-3">
        <DataTable title={`Where to launch ${catLabel(dc)} next · ${candRows.length} non-live stores`} rows={candRows} columns={candCols} rowHref="/stores/{b}" defaultSort={{ key: "revenue" }} csvName={`expansion-${dc}`} height={420} searchKeys={["store", "city", "state"]} />
        <p className="mt-1.5 text-[11.5px] text-zinc-500">Ranked by estimated monthly revenue. Prioritise stores in cities with no live store (Live in city = 0) and large stores; confirm space and VM before allocating.</p>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.4fr]">
        <Section title={`Cities with no live ${catLabel(dc)} store · ${cur.cityGaps.length}`} tip="Every store in the city lacks stock and a sale in 60 days. Candidate = largest store in the city.">
          {cur.cityGaps.length ? <ul className="divide-y divide-zinc-100">{cur.cityGaps.slice(0, 12).map((g) => (
            <li key={g.city} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
              <span className="min-w-0"><b className="font-medium">{g.city}</b><span className="text-zinc-400"> · {g.state} · {g.stores} store{g.stores > 1 ? "s" : ""}</span>
                <span className="block text-[11.5px] text-zinc-500">Try <Link href={hrefOf(g.best.b)} className="text-brand-700 hover:underline">{g.best.store}</Link> ({ltLabel(g.best.lt)}, {num(g.best.storeUnits30 / 30)} units/day)</span></span>
              <span className="tabular shrink-0 text-right text-[12px]">{g.potential30 ? <><b>{inr(g.potential30)}</b><span className="block text-[10.5px] text-zinc-400">/ month est.</span></> : "—"}</span>
            </li>
          ))}</ul> : <div className="py-6 text-center text-[12.5px] text-zinc-500">{catLabel(dc)} is live in at least one store in every city.</div>}
        </Section>
        <DataTable title={`Under-penetrated ${catLabel(dc)} stores · ${underRows.length}`} rows={underRows} rowHref="/stores/{b}" defaultSort={{ key: "revenue" }} csvName={`underpen-${dc}`} height={360}
          columns={[{ key: "store", label: "Store", sub: "city", width: 190 }, { key: "lt", label: "Format" }, { key: "pen", label: "Share of units", type: "pct" }, { key: "peer", label: "Peer median", type: "pct" },
            { key: "units30", label: "L30 units", type: "num" }, { key: "inv", label: "In store", type: "num" }, { key: "revenue", label: "Gap / month", type: "inr", tip: "(peer − store share) × store units × ASP — estimate" }]}
          emptyText="Every live store sells at least half its format peers' share." />
      </div>

      <div className="mt-3">
        <DataTable title={`${catLabel(dc)} · stock-out and dead-stock stores · ${stockRows.length}`} rows={stockRows} rowHref="/stores/{b}" defaultSort={{ key: "revenue" }} csvName={`stock-issues-${dc}`} height={320}
          columns={[{ key: "store", label: "Store", sub: "city", width: 200 }, { key: "kind", label: "Issue" }, { key: "inv", label: "In store", type: "num" }, { key: "s30", label: "L30 units", type: "num" }, { key: "revenue", label: "Revenue (period)", type: "inr" }, { key: "last", label: "Last sale", type: "date" }]}
          emptyText="No stock-outs or dead stock for this category." />
        <p className="mt-1.5 text-[11.5px] text-zinc-500">Dead stock (≥{RULE.deadMinUnits} units, no sale in 30 days) is the first source for launching in candidate stores above — transfer before buying more.</p>
      </div>
    </>
  );
}
