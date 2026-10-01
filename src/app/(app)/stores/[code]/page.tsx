import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { buildStoreModel, modelRanges, LIVE_LOOKBACK } from "@/server/storeInsights";
import { trendByCategory, catColor, catLabel } from "@/server/views";
import { getSkuFacts } from "@/server/data/sku";
import { getProductMap } from "@/server/data/products";
import { getStoreInventory, catKey } from "@/server/data/inventory";
import { buildActions, actionStatuses } from "@/server/actions";
import { PageHeader, Kpi, KpiGrid, Section, Delta, Pill, achTone, DataPrompt, ProductCell, StatusBadge } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { DailyTargetChart } from "@/components/charts/DailyTargetChart";
import { DataTable, type Col } from "@/components/table/DataTable";
import { TodoPill, coverTone, days, ltLabel, ctLabel } from "@/components/stores/parts";
import { inr, num, pct } from "@/lib/format";
import { addDays, diffDays, eachDay, fmtDate, fmtRange } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { cn } from "@/lib/cn";

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export default async function StoreDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  const base = await pageContext(searchParams);
  // peers need the whole network: build the model without a store filter, then pick this store
  const ctx = { ...base, filters: { ...base.filters, stores: [] } };
  const { range, compare } = ctx.period;
  const trendRange = { from: addDays(ctx.asOf, -29), to: ctx.asOf };
  const [facts, skus, pm, act, statuses] = await Promise.all([
    loadFacts(ctx, [...modelRanges(ctx), { from: addDays(trendRange.from, -7), to: ctx.asOf }]),
    getSkuFacts({ range, compare, asOf: ctx.asOf, cats: ctx.filters.cats, ch: "store" }), getProductMap(), buildActions(base), actionStatuses(),
  ]);
  const model = await buildStoreModel(ctx, facts);
  const s = model.byCode.get(code);
  const store = base.byCode.get(code);
  if (!s && !store) notFound();
  const th = ctx.settings.thresholds;
  const name = s?.store ?? store!.short_name;
  const storeName = (store?.store_name ?? name).toUpperCase();
  const cats = ctx.filters.cats;

  // store facts, daily chart (target on live categories only, matching achievement)
  const mine = facts.filter((f) => f.b === code);
  const liveSet = new Set(s?.liveCats ?? []);
  const byDay = new Map<string, { s: number; q: number; t: number; ht: boolean }>();
  for (const f of mine) { const x = byDay.get(f.d) ?? { s: 0, q: 0, t: 0, ht: false }; x.s += f.s; x.q += f.q; if (f.t != null && liveSet.has(f.c)) { x.t += f.t; x.ht = true; } byDay.set(f.d, x); }
  const daily = eachDay(trendRange.from, trendRange.to).map((d) => ({ date: d, actual: byDay.get(d)?.s ?? 0, units: byDay.get(d)?.q ?? 0, lw: byDay.get(addDays(d, -7))?.s ?? null, target: byDay.get(d)?.ht ? byDay.get(d)!.t : null }));
  const trend = trendByCategory(mine, trendRange, cats);

  // peers: same location type, live in the category
  const peers = model.stores.filter((p) => p.b !== code && p.lt === s?.lt && p.liveCats.length);
  const peerMed = (f: (p: (typeof peers)[number]) => number | null) => median(peers.map(f).filter((v): v is number => v != null && Number.isFinite(v)));
  const peerPerDay = peerMed((p) => p.perDay), peerPen = peerMed((p) => p.pen), peerAtv = peerMed((p) => p.atv), peerUpt = peerMed((p) => p.upt);

  const catRows = cats.map((c) => {
    const x = s?.cells[c];
    const pp = model.stores.filter((p) => p.b !== code && p.lt === s?.lt && p.cells[c]?.live);
    const peerUnits = median(pp.map((p) => (p.cells[c]!.w.r.q) / model.days));
    const st = !x || !x.live ? "Not live" : x.stockOut ? "Stock-out" : x.dead ? "Dead stock" : x.lowCover ? "Low cover" : "Live";
    const tone = st === "Not live" ? "muted" : st === "Stock-out" ? "bad" : st === "Live" ? "good" : "warn";
    const mt = x?.w.mon.ht ? x.w.mon.t : null, mtdT = x?.w.mtd.ht ? x.w.mtd.t : null;
    const proj = mt && mtdT ? (x!.w.mtd.s / mtdT) * mt : null;
    return {
      c, x, st, tone: tone as "muted" | "bad" | "good" | "warn", sales: x?.w.r.s ?? 0, prev: x?.w.c.s ?? 0, qty: x?.w.r.q ?? 0, share: safeDiv(x?.w.r.s ?? 0, s?.sales ?? 0),
      target: x?.w.r.ht ? x.w.r.t : null, ach: x?.w.r.ht ? safeDiv(x.w.r.s, x.w.r.t) : null, projAch: safeDiv(proj, mt), monthTarget: mt,
      unitsDay: (x?.w.r.q ?? 0) / model.days, peerUnits, pen: x?.pen ?? null, peerPen: model.peerPen(c, s?.lt ?? null), inv: x?.inv ?? 0, s30: x?.s30 ?? 0, cover: x?.cover ?? null, last: x?.lastSale ?? null,
    };
  });

  // products: sales at this store ∪ stock at this store
  const inv = (await getStoreInventory([...pm.keys()])).filter((r) => r.b === code && cats.includes(catKey(r.cat) ?? ""));
  const stock = new Map<string, { units: number; s30: number }>();
  for (const r of inv) { const v = stock.get(r.sku) ?? { units: 0, s30: 0 }; v.units += r.units; v.s30 += r.s30; stock.set(r.sku, v); }
  const catSet = new Set(cats);
  const sales = skus.filter((f) => f.ch.toUpperCase() === storeName && catSet.has(f.c));
  const seen = new Set<string>();
  const prodRows = [...sales.map((f) => { seen.add(f.sku); return { sku: f.sku, c: f.c, rs: f.rs, rq: f.rq, ps: f.ps, l7: f.l7q, l30: f.l30q, last: f.last }; }),
    ...[...stock.keys()].filter((k) => !seen.has(k)).map((k) => ({ sku: k, c: pm.get(k)?.category ?? catKey(inv.find((r) => r.sku === k)?.cat ?? "") ?? "", rs: 0, rq: 0, ps: 0, l7: 0, l30: 0, last: null as string | null }))]
    .map((f) => {
      const p = pm.get(f.sku), st = stock.get(f.sku);
      const l30 = Math.max(f.l30, st?.s30 ?? 0);
      return { sku: f.sku, name: p?.name ?? f.sku, image: p?.image ?? null, category: catLabel(f.c), c: f.c, revenue: f.rs, units: f.rq, growth: growth(f.rs, f.ps), l7: f.l7, l30,
        stock: s?.inFeed ? st?.units ?? 0 : null, cover: s?.inFeed && l30 > 0 ? (st?.units ?? 0) / (l30 / 30) : null, last: f.last, daysSince: f.last ? diffDays(f.last, ctx.asOf) : null };
    });
  const top = prodRows.filter((r) => r.units > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const lowStock = prodRows.filter((r) => r.l30 >= 3 && r.stock != null && (r.stock === 0 || (r.cover != null && r.cover < 14))).sort((a, b) => b.l30 - a.l30).slice(0, 8);
  const idle = prodRows.filter((r) => (r.stock ?? 0) >= 3 && r.l30 === 0).sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0)).slice(0, 8);

  // network best sellers (live categories) that this store neither stocks nor sold in 30 days
  const net = new Map<string, { c: string; s: number; q: number; st: Set<string> }>();
  for (const f of skus) { if (!liveSet.has(f.c) || f.l30q <= 0) continue; const x = net.get(f.sku) ?? { c: f.c, s: 0, q: 0, st: new Set<string>() }; x.s += f.l30s; x.q += f.l30q; x.st.add(f.ch); net.set(f.sku, x); }
  const here = new Set(prodRows.filter((r) => (r.stock ?? 0) > 0 || r.l30 > 0).map((r) => r.sku));
  const missing = [...net].filter(([k, x]) => !here.has(k) && x.st.size >= 5).sort((a, b) => b[1].s - a[1].s).slice(0, 8)
    .map(([k, x]) => ({ sku: k, c: x.c, s: x.s, q: x.q, stores: x.st.size, p: pm.get(k) }));

  const opps = act.actions.filter((a) => a.store?.code === code);
  const cols: Col[] = [
    { key: "name", label: "Product", image: "image", sub: "sku", width: 250 }, { key: "category", label: "Category" },
    { key: "revenue", label: "Revenue", type: "inr", bar: true }, { key: "units", label: "Units", type: "num" }, { key: "growth", label: "Growth", type: "delta" },
    { key: "l7", label: "L7 units", type: "num" }, { key: "l30", label: "L30 units", type: "num" },
    { key: "stock", label: "Store stock", type: "num", tip: "Latest store report" }, { key: "cover", label: "Store cover (days)", type: "num", tip: "Store stock ÷ L30 daily units" },
    { key: "last", label: "Last sale", type: "date" }, { key: "daysSince", label: "Days since sale", type: "num", hidden: true },
  ];
  const meta = [s?.city ?? store?.city, s?.state ?? store?.state, ltLabel(s?.lt ?? null), ctLabel(s?.ct ?? null), store?.store_status, store?.operating_model].filter((v) => v && v !== "—").join(" · ");
  const hrefP = (sku: string) => withQs(base, `/products/${encodeURIComponent(sku)}`);
  const ProdList = ({ rows, note, empty }: { rows: typeof top; note: (r: (typeof top)[number]) => React.ReactNode; empty: string }) => rows.length ? (
    <ul className="space-y-1.5">{rows.map((r) => (
      <li key={r.sku} className="flex items-center justify-between gap-3"><ProductCell name={r.name} sku={r.sku} image={r.image} href={hrefP(r.sku)} /><span className="tabular shrink-0 text-right text-[12px]">{note(r)}</span></li>
    ))}</ul>
  ) : <div className="py-6 text-center text-[12.5px] text-zinc-500">{empty}</div>;

  return (
    <>
      <Link href={withQs(base, "/stores")} className="mb-2 inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-ink"><ChevronLeft className="size-3.5" />Stores</Link>
      <PageHeader title={name} subtitle={<>{meta}{store?.am ? ` · AM ${store.am}` : ""}{s?.area ? ` · ${num(s.area)} sq ft` : ""} · {fmtRange(range)}</>}
        right={s ? <StatusBadge status={s.tstatus} ach={s.ach} /> : undefined} />
      {!s ? (
        <DataPrompt title="No long-tail activity in this store">No stock on the latest store report and no sale in the last {LIVE_LOOKBACK} days for the selected categories.</DataPrompt>
      ) : (<>
        <KpiGrid cols={8}>
          <Kpi label="Revenue" value={inr(s.sales)} delta={s.growth} deltaLabel={ctx.period.compareLabel} />
          <Kpi label="Achievement" value={pct(s.ach, 0)} tone={s.target ? achTone(s.ach, th) : undefined} sub={s.target ? `of ${inr(s.target)} · live categories` : "no target"} tip={s.nonLiveTarget ? `${inr(s.nonLiveTarget)} of target on non-live categories is excluded` : undefined} />
          <Kpi label="Month-end projection" value={inr(s.projected)} sub={s.projAch != null ? `${pct(s.projAch, 0)} of month target` : "projection · not actual"} tone={s.monthTarget ? achTone(s.projAch, th) : undefined} />
          <Kpi label="Need / day" value={s.reqPerDay == null ? "—" : s.reqPerDay <= 0 ? "Met" : inr(s.reqPerDay)} sub={`now ${inr(s.curPerDay)}/day · ${model.remainingDays} days left`} tone={s.reqPerDay != null && s.reqPerDay > s.curPerDay * 1.1 ? "bad" : undefined} />
          <Kpi label="Sales / day" value={inr(s.perDay)} sub={<>peer median {inr(peerPerDay)}</>} tip={`Median of other ${ltLabel(s.lt).toLowerCase()} stores with a live long-tail category`} />
          <Kpi label="ATV · UPT" value={s.atv == null ? "—" : inr(s.atv, { compact: false })} sub={<>UPT {num(s.upt, 2)} · peers {inr(peerAtv, { compact: false })} / {num(peerUpt, 2)}</>} tip="Perfumes + Shoes bills only" />
          <Kpi label="LT penetration" value={pct(s.pen, 1)} sub={<>peer median {pct(peerPen, 1)}</>} tone={s.pen != null && peerPen != null ? (s.pen >= peerPen ? "good" : s.pen < peerPen * 0.6 ? "bad" : "warn") : undefined} tip="In-scope category L30 units ÷ store's total L30 units across all categories (store report) — proxy for bill penetration" />
          <Kpi label="Store stock" value={s.inFeed ? num(s.inv) : "—"} sub={s.inFeed ? <>cover {days(s.cover)} · {s.liveCats.length}/{cats.length} categories live</> : "not in the store report"} />
        </KpiGrid>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
          <Section title="Daily revenue vs target · last 30 days" tip="Target = store targets on live categories">
            <DailyTargetChart data={daily} height={220} />
          </Section>
          <Section title={`What to do · ${s.todos.filter((t) => t.kind !== "ok").length}`} tip="Computed from this store's sales, target pace, store stock and format peers">
            <ul className="divide-y divide-zinc-100">{s.todos.slice(0, 8).map((t, i) => (
              <li key={i} className="flex items-start gap-2.5 py-2 text-[12.5px] leading-snug"><TodoPill t={t} /><span className="text-zinc-700">{t.text}</span></li>
            ))}</ul>
          </Section>
        </div>

        <div className="mt-3">
          <Section title="Category mix vs peers · inventory" pad={false} tip={`Live = stock on the latest store report or a sale in the last ${LIVE_LOOKBACK} days. Peers = other ${ltLabel(s.lt).toLowerCase()} stores where the category is live.`}>
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full whitespace-nowrap text-[12.5px]">
                <thead><tr className="border-b border-line text-[11px] text-zinc-500">
                  {["Category", "Status", "Revenue", "Share", "Growth", "Target", "Ach.", "Proj. month", "Units / day", "Peer units / day", "Penetration", "Peer pen.", "Store stock", "L30 units", "Cover", "Last sale"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium", i > 1 ? "text-right" : "text-left")}>{h}</th>)}
                </tr></thead>
                <tbody>{catRows.map((r) => (
                  <tr key={r.c} className={cn("border-b border-brand-50 last:border-0", r.st === "Not live" && "text-zinc-400")}>
                    <td className="px-3 py-2"><span className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full" style={{ background: catColor(r.c) }} />{catLabel(r.c)}</span></td>
                    <td className="px-3"><Pill tone={r.tone}>{r.st}</Pill></td>
                    <td className="tabular px-3 text-right font-semibold">{inr(r.sales)}</td>
                    <td className="tabular px-3 text-right">{pct(r.share, 0)}</td>
                    <td className="px-3 text-right"><Delta v={growth(r.sales, r.prev)} /></td>
                    <td className="tabular px-3 text-right">{inr(r.target)}{r.st === "Not live" && r.monthTarget ? <span className="block text-[10.5px] text-amber-700">not live · reallocate</span> : null}</td>
                    <td className="px-3 text-right">{r.ach == null || r.st === "Not live" ? "—" : <Pill tone={achTone(r.ach, th)}>{pct(r.ach, 0)}</Pill>}</td>
                    <td className="tabular px-3 text-right">{r.st === "Not live" ? "—" : pct(r.projAch, 0)}</td>
                    <td className="tabular px-3 text-right">{num(r.unitsDay, 2)}</td>
                    <td className="tabular px-3 text-right text-zinc-500">{num(r.peerUnits, 2)}</td>
                    <td className={cn("tabular px-3 text-right", r.pen != null && r.peerPen != null && r.pen < r.peerPen * 0.5 && "text-rose-600")}>{pct(r.pen, 1)}</td>
                    <td className="tabular px-3 text-right text-zinc-500">{pct(r.peerPen, 1)}</td>
                    <td className="tabular px-3 text-right">{s.inFeed ? num(r.inv) : "—"}</td>
                    <td className="tabular px-3 text-right">{s.inFeed ? num(r.s30) : "—"}</td>
                    <td className="px-3 text-right">{r.cover == null ? "—" : <Pill tone={coverTone(r.cover)}>{days(r.cover)}</Pill>}</td>
                    <td className="tabular px-3 text-right text-zinc-500">{r.last ? fmtDate(r.last) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Section>
        </div>

        <div className="mt-3">
          <Section title="Daily sales by category · last 30 days">
            <TrendChart data={trend} height={200} series={[...cats.map((c) => ({ key: c, label: catLabel(c), color: catColor(c), stack: "s" })), { key: "target", label: "Target (all)", color: "#1b1712", type: "line" as const, dashed: true }]} />
          </Section>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <Section title="Top sellers" tip="By revenue in the selected period">
            <ProdList rows={top} empty="No sales in this period." note={(r) => <><b className="font-semibold">{inr(r.revenue)}</b><span className="block text-[11px] text-zinc-500">{num(r.units)} units · stock {r.stock ?? "—"}</span></>} />
          </Section>
          <Section title="Selling, low stock" tip="≥3 units sold in 30 days with 0 stock or under 14 days of store cover — replenish">
            <ProdList rows={lowStock} empty="No top seller is short in this store." note={(r) => <><Pill tone={r.stock === 0 ? "bad" : "warn"}>{r.stock === 0 ? "0 stock" : days(r.cover)}</Pill><span className="block text-[11px] text-zinc-500">{num(r.l30)} sold L30</span></>} />
          </Section>
          <Section title="Stocked, not selling" tip="≥3 units in store and no sale in 30 days — move or re-merchandise">
            <ProdList rows={idle} empty="Every stocked product sold in the last 30 days." note={(r) => <><b className="font-semibold">{num(r.stock)}</b><span className="block text-[11px] text-zinc-500">{r.last ? `last sale ${fmtDate(r.last)}` : "no sale in 90 days"}</span></>} />
          </Section>
          <Section title="Network best sellers missing here" tip="Top Stores sellers (L30) in this store's live categories, sold in ≥5 stores, that this store neither stocks nor sold in 30 days">
            {missing.length ? <ul className="space-y-1.5">{missing.map((m) => (
              <li key={m.sku} className="flex items-center justify-between gap-3"><ProductCell name={m.p?.name ?? m.sku} sku={m.sku} image={m.p?.image ?? null} href={hrefP(m.sku)} /><span className="tabular shrink-0 text-right text-[12px]"><b className="font-semibold">{inr(m.s)}</b><span className="block text-[11px] text-zinc-500">{m.stores} stores · L30</span></span></li>
            ))}</ul> : <div className="py-6 text-center text-[12.5px] text-zinc-500">This store carries the network’s best sellers.</div>}
          </Section>
        </div>

        <div className="mt-3">
          <Section title={`Action opportunities${opps.length ? ` · ${opps.length}` : ""}`} tip="Open actions from the Action Centre for this store">
            {opps.length ? <div className="grid gap-2 xl:grid-cols-2">{opps.slice(0, 10).map((a) => <ActionCard key={a.key} a={a} qs={base.qs} status={statuses.get(a.key) ?? "open"} />)}</div>
              : <div className="py-4 text-center text-[12.5px] text-zinc-500">{s.inFeed ? "No open Action Centre items for this store." : "Store stock isn’t available for this store, so allocation opportunities can’t be computed."}</div>}
          </Section>
        </div>
        <div className="mt-3">
          <DataTable title="Products at this store · sold or stocked" rows={prodRows} columns={cols} defaultSort={{ key: "revenue" }} rowHref="/products/{sku}" csvName={`store-${code}-products`} height={520} dense={false}
            totals={{ name: "Total", revenue: prodRows.reduce((a, r) => a + r.revenue, 0), units: prodRows.reduce((a, r) => a + r.units, 0), l30: prodRows.reduce((a, r) => a + r.l30, 0), stock: s.inFeed ? prodRows.reduce((a, r) => a + (r.stock ?? 0), 0) : null }} />
          <p className="mt-1.5 text-[11.5px] text-zinc-500">Product revenue from store sales lines (gross); store KPIs from the DSR (gross sales). Store stock from the store report{model.invDate ? ` (${fmtDate(model.invDate, true)})` : ""}.</p>
        </div>
      </>)}
    </>
  );
}
