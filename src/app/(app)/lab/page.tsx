import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { can } from "@/server/auth";
import { buildLab, GOAL } from "@/server/lab";
import { catColor, catLabel } from "@/server/views";
import { CH_LABEL } from "@/server/channelData";
import { PageHeader, Empty, Kpi, KpiGrid, Pill, Meter, Delta, ProductCell, type Tone } from "@/components/ui";
import { LabCard, MiniTable, ExperimentalPill } from "@/components/wip/ui";
import { CH_COLORS } from "@/lib/colors";
import { inr, num, pct } from "@/lib/format";
import { fmtDate, fmtRange } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "Admin Lab" };

const VIEWS = [
  ["health", "Category health"], ["path", "Path to ₹100 Cr"], ["pareto", "Concentration"], ["price", "Price bands & ASP"], ["launch", "New launches"],
  ["size", "Size-curve gaps"], ["heat", "Store penetration"], ["dead", "Dead-stock ageing"], ["mix", "Channel-mix shift"], ["returns", "Return leakage"],
  ["mp", "Marketplace gaps"], ["cannibal", "Cannibalisation"], ["turns", "Turns & GMROI"],
] as const;

const scoreTone = (s: number | null): Tone => (s == null ? "muted" : s >= 70 ? "good" : s >= 45 ? "warn" : "bad");
const Cat = ({ c }: { c: string }) => <span className="flex items-center gap-1.5 font-medium"><span className="size-2 rounded-full" style={{ background: catColor(c) }} />{catLabel(c)}</span>;
const Sku = ({ r, sub }: { r: { sku: string; name: string | null; image: string | null }; sub?: React.ReactNode }) => <ProductCell name={r.name} sku={r.sku} image={r.image} size={44} href={`/products/${encodeURIComponent(r.sku)}`} sub={sub} />;

export default async function AdminLab({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  if (!can(ctx.user, "admin")) return <><PageHeader title="Admin Lab" /><Empty title="Admins only">The Lab is an experimental canvas for admins. Ask an admin if you need access.</Empty></>;
  const L = await buildLab(ctx);
  const { range } = ctx.period;
  const chLabel = ctx.filters.channel === "all" ? "Overall" : CH_LABEL[ctx.filters.channel];
  const hasTargets = L.path.some((p) => p.plan != null);
  const launchCounts = { hit: L.launches.filter((l) => l.verdict === "Hit").length, par: L.launches.filter((l) => l.verdict === "On par").length, slow: L.launches.filter((l) => l.verdict === "Slow").length };
  const deadTot = L.ageing.reduce((a, x) => a + x.b[2].value + x.b[3].value, 0);
  const stockTot = L.ageing.reduce((a, x) => a + x.b.reduce((s, y) => s + y.value, 0), 0);

  return (
    <>
      <PageHeader title="Admin Lab" right={<ExperimentalPill label="Rough canvas" />}
        subtitle={<>{ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories"} · {chLabel} · {fmtRange(range)} <span className="text-zinc-400">· {ctx.period.compareLabel}</span></>} />

      <div className="mb-4 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 px-4 py-3 text-[12.5px] text-brand-900">
        <div className="font-semibold">Rough canvas — experimental views; promote what&apos;s useful</div>
        <div className="mt-0.5 text-[12px] text-brand-800/80">A sandbox for admins to look at the business from new angles: new metrics, new actions, new suggestions, new views. Numbers come from the same sources as the rest of the tool, but thresholds and scores are first drafts. If a view earns its place, it gets promoted into the main pages (and into the Action Centre as a rule). Free-gift products (&lt; ₹10 / unit) are excluded from every ranking.</div>
        <div className="mt-2 flex flex-wrap gap-1">{VIEWS.map(([k, l], i) => <a key={k} href={`#${k}`} className="rounded-full border border-brand-200 bg-white px-2 py-0.5 text-[11px] text-brand-800 hover:border-brand-400">{i + 1}. {l}</a>)}</div>
      </div>

      <div className="grid gap-3">
        {/* 1 · health */}
        <LabCard id="health" title="1 · Category health scorecard" why="One number per category that blends growth, plan achievement, stock cover, returns and SKU concentration — where to spend the category owner's week."
          action="Review the lowest-scoring category every Monday; its weakest pillar tells you whether it is a demand, plan, stock or range problem.">
          <MiniTable head={["Category", "Score", "Revenue", "Growth", "MTD achievement", "DOI (L30)", "Return % (lifetime)", "Top-10 SKU share", "Weakest pillar"]}
            rows={L.health.map((h) => {
              const weak = h.parts.filter((p) => p.s != null).sort((a, b) => a.s! - b.s!)[0];
              return [<Cat key="c" c={h.c} />, <Pill key="s" tone={scoreTone(h.score)}>{h.score ?? "—"}/100</Pill>, inr(h.revenue), <Delta key="g" v={h.growth} />,
                h.hasTarget ? pct(h.ach, 0) : <span key="a" className="text-zinc-400">no target</span>, h.doi == null ? "—" : `${num(h.doi)} d`, pct(h.returnPct, 1), pct(h.top10, 0),
                weak ? <span key="w" className="text-[11px] text-zinc-600">{weak.k} ({Math.round(weak.s! * 100)})</span> : "—"];
            })} />
          <p className="mt-2 text-[11px] text-zinc-500">Each pillar is scored 0–100 and averaged over the pillars with data: growth −20%→+20%, achievement 60%→100%, cover 30–90 days ideal (0 below 14 or above 180), returns 25%→5%, top-10 share 90%→50%.</p>
        </LabCard>

        {/* 2 · path */}
        <LabCard id="path" title={`2 · Path to ₹100 Cr · ${L.fy.label} run-rate tracker`} why="The mission is a ₹100 Cr business. Annualising the last 30 days shows how far today's engine is from it, and which category has to carry the gap."
          action="Set FY month targets in the Control Centre for every category, then use the required multiple to size the levers (new stores, range depth, marketplace expansion)."
          right={<span className="text-[11px] text-zinc-500">All channels · last 30 days annualised</span>}>
          <KpiGrid cols={4}>
            <Kpi label="Annualised run-rate" value={inr(L.pathTot.runRate)} sub={`${pct(L.pathTot.runRate / GOAL, 0)} of ₹100 Cr`} tone={L.pathTot.runRate >= GOAL ? "good" : "info"} />
            <Kpi label="Required multiple" value={`${num(GOAL / Math.max(1, L.pathTot.runRate), 1)}×`} sub="today's run-rate → ₹100 Cr" />
            <Kpi label={`${L.fy.label} landing (at run-rate)`} value={inr(L.pathTot.landing)} sub={`${inr(L.pathTot.ytd)} FYTD + ${L.fyDaysLeft} days`} />
            <Kpi label={`${L.fy.label} plan`} value={hasTargets ? inr(L.pathTot.plan) : "Not set"} sub={hasTargets ? `landing ${pct(L.pathTot.landing / L.pathTot.plan, 0)} of plan` : "month targets in Control Centre"} tone={hasTargets ? (L.pathTot.landing >= L.pathTot.plan ? "good" : "bad") : "muted"} />
          </KpiGrid>
          <div className="mt-3 space-y-1.5">
            {L.path.map((p) => (
              <div key={p.c} className="grid grid-cols-[120px_1fr_90px] items-center gap-2 text-[12px] md:grid-cols-[140px_1fr_110px_110px_130px]">
                <Cat c={p.c} />
                <Meter value={p.runRate / Math.max(...L.path.map((x) => x.runRate), 1)} color={catColor(p.c)} />
                <span className="tabular text-right font-medium">{inr(p.runRate)}</span>
                <span className="tabular hidden text-right text-zinc-500 md:block">plan {p.plan == null ? "—" : inr(p.plan)}{p.plan != null && p.planMonths < 12 ? <span className="text-[10px]"> ({p.planMonths}m)</span> : null}</span>
                <span className={cn("tabular hidden text-right md:block", p.gap == null ? "text-zinc-400" : p.gap > 0 ? "text-rose-600" : "text-emerald-700")}>{p.gap == null ? "—" : p.gap > 0 ? `${inr(p.gap)} short` : `${inr(-p.gap)} ahead`}</span>
              </div>
            ))}
          </div>
        </LabCard>

        <div className="grid gap-3 xl:grid-cols-2">
          {/* 3 · pareto */}
          <LabCard id="pareto" title="3 · Pareto & long tail" why="How many SKUs really drive each category, and how much stock is parked in the tail that drives little."
            action="Deepen size / colour for the 80% core; cap buys and plan exits for tail SKUs holding a big share of stock.">
            <MiniTable head={["Category", "Active SKUs", "SKUs → 80%", "Top-10 share", "Bottom half share", "Stock outside core"]}
              rows={L.pareto.map((p) => [<Cat key="c" c={p.c} />, `${num(p.active)} / ${num(p.catalogue)}`, <span key="n"><b>{num(p.n80)}</b> <span className="text-zinc-400">({pct(p.active ? p.n80 / p.active : null, 0)})</span></span>, pct(p.top10, 0), pct(p.tailShare, 1),
                <span key="t" className={cn((p.tailStockShare ?? 0) > 0.6 && "font-medium text-amber-700")}>{pct(p.tailStockShare, 0)}</span>])} />
          </LabCard>

          {/* 4 · price */}
          <LabCard id="price" title="4 · Price-band mix & ASP drift" why="Where revenue sits on the price ladder, and whether ASP is moving because of mix or discounting."
            action="If ASP falls while the band mix is stable, discounting is the driver — review promo depth. If mix is shifting down, check range availability in upper bands.">
            <div className="space-y-2">
              {L.bands.map((b) => (
                <div key={b.c}>
                  <div className="mb-0.5 flex items-center justify-between text-[11.5px]"><Cat c={b.c} /><span className="tabular text-zinc-500">ASP {inr(b.asp, { compact: false })} <Delta v={b.drift} /> · realisation {pct(b.realisation, 0)} of MRP</span></div>
                  <div className="flex h-4 overflow-hidden rounded bg-zinc-100">
                    {b.by.map((x, i) => x.share > 0 && <span key={x.key} title={`${x.label}: ${pct(x.share, 0)}`} className="flex items-center justify-center text-[9.5px] font-semibold text-white" style={{ width: `${x.share * 100}%`, background: ["#e2c9a6", "#d3b089", "#c08f60", "#a8703f", "#1b1712"][i] }}>{x.share >= 0.1 ? pct(x.share, 0) : ""}</span>)}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2.5 pt-1 text-[10.5px] text-zinc-500">{L.bands[0]?.by.map((x, i) => <span key={x.key} className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: ["#e2c9a6", "#d3b089", "#c08f60", "#a8703f", "#1b1712"][i] }} />{x.label} MRP</span>)}</div>
            </div>
          </LabCard>
        </div>

        {/* 5 · launches */}
        <LabCard id="launch" title="5 · New-launch tracker · live ≤ 60 days" why="The first 30 days decide whether a design becomes a core seller. Comparing launch velocity with the category's established sellers separates hits from misses early."
          action="Re-order hits before they stock out (check warehouse cover); for slow launches, fix visibility (VM, online placement) within two weeks or stop further buys."
          right={<span className="flex gap-1"><Pill tone="good">{launchCounts.hit} hits</Pill><Pill tone="info">{launchCounts.par} on par</Pill><Pill tone="warn">{launchCounts.slow} slow</Pill></span>}>
          <MiniTable head={["Product", "Category", "Days live", "Units (L30)", "Units / day", "Category benchmark", "Index", "Inwarded", "Sell-through", "Stock", "Verdict"]}
            rows={L.launches.slice(0, 15).map((l) => [<Sku key="p" r={l} sub={l.l1} />, catLabel(l.c), l.days, num(l.units), num(l.vel, 2), l.bench == null ? "—" : num(l.bench, 2), l.idx == null ? "—" : `${num(l.idx, 1)}×`, l.inward == null ? "—" : num(l.inward), pct(l.sellThrough, 0), num(l.stock),
              <Pill key="v" tone={l.verdict === "Hit" ? "good" : l.verdict === "Slow" ? "warn" : l.verdict === "On par" ? "info" : "muted"}>{l.verdict}</Pill>])} />
          {L.launches.length > 15 && <p className="mt-1.5 text-[11px] text-zinc-500">Top 15 of {L.launches.length} launches by index. Benchmark = 75th-percentile L30 units/day of the category&apos;s SKUs live &gt; 90 days and selling (an established good seller). Hit ≥ 1.5×, on par ≥ 0.7×.</p>}
        </LabCard>

        <div className="grid gap-3 xl:grid-cols-2">
          {/* 6 · size */}
          <LabCard id="size" title="6 · Size-curve gaps on sellers" why="A seller with broken sizes loses sales quietly — customers who need the missing size walk away and it looks like weak demand."
            action="Raise a size-level replenishment for these SKUs; if the vendor can't, move store stock of the missing sizes to the stores that sell fastest.">
            <MiniTable head={["Product", "L30 units", "Missing in warehouse", "In stock (size:units)", "Broken"]}
              rows={L.sizeGaps.slice(0, 12).map((s) => [<Sku key="p" r={s} sub={catLabel(s.c)} />, num(s.l30Units), <span key="z" className="font-medium text-rose-600">{s.zero.join(", ")}</span>, <span key="i" className="text-[11px] text-zinc-500">{s.inStock.slice(0, 8).join("  ")}</span>, pct(s.broken, 0)])} />
            {!L.sizeGaps.length && <p className="text-[11px] text-zinc-500">No multi-size sellers with empty warehouse sizes.</p>}
          </LabCard>

          {/* 8 · dead stock */}
          <LabCard id="dead" title="8 · Dead-stock ageing" why="Stock with no sale in 60+ days ties up cash and space that new launches need."
            action={<>Liquidate 90+ day stock via marketplace / outlet or bundle; transfer 61–90 day stock to stores where the type sells. ≈ <b>{inr(deadTot)}</b> at MRP ({pct(stockTot ? deadTot / stockTot : null, 0)} of stock) is 60+ days without a sale.</>}>
            <MiniTable head={["Category", ...L.buckets.map((b) => `${b} days`), "60+ share"]}
              rows={L.ageing.map((a) => { const t = a.b.reduce((s, x) => s + x.value, 0); return [<Cat key="c" c={a.c} />, ...a.b.map((x, i) => <span key={i} className={cn(i >= 2 && x.value > 0 && "text-amber-700")}>{inr(x.value)}<span className="ml-1 text-[10px] text-zinc-400">{num(x.skus)}</span></span>), pct(t ? (a.b[2].value + a.b[3].value) / t : null, 0)]; })} />
            <div className="mt-2 text-[11px] font-medium text-zinc-600">Largest 60+ day positions</div>
            <MiniTable head={["Product", "Stock", "Value (MRP)", "Last sale"]} rows={L.deadList.slice(0, 6).map((d) => [<Sku key="p" r={d} sub={catLabel(d.c)} />, `${num(d.storeInv)} st · ${num(d.wh)} wh`, inr(d.value), d.last ? fmtDate(d.last, true) : "none in 90d"])} />
          </LabCard>
        </div>

        {/* 7 · heatmap */}
        <LabCard id="heat" title="7 · Store × category penetration" why="Each long-tail category's share of a store's total units (apparel included). Big stores where a category under-indexes are the cheapest growth — the footfall is already there."
          action={<>Take the amber cells (below half the median share) into <Link href={withQs(ctx, "/vm")} className="font-medium underline">VM Revamp</Link> as candidates, or fix range depth / display.</>}
          right={<span className="text-[11px] text-zinc-500">Store report {L.heat.date ? fmtDate(L.heat.date, true) : ""} · L30 units · top 30 stores by size</span>}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[11.5px]">
              <thead><tr className="text-[10.5px] text-zinc-500"><th className="py-1 pr-2 text-left font-medium">Store</th><th className="px-1 text-right font-medium">Units L30</th>{ctx.filters.cats.map((c) => <th key={c} className="px-1 text-center font-medium">{catLabel(c)}<div className="font-normal text-zinc-400">med {pct(L.heat.medShare[c], 1)}</div></th>)}</tr></thead>
              <tbody>
                {L.heat.rows.map((r) => (
                  <tr key={r.b} className="border-t border-line/60">
                    <td className="py-0.5 pr-2"><Link href={`/stores/${r.b}`} className="hover:underline">{r.store}</Link><span className="ml-1 text-[10px] text-zinc-400">{r.city}</span></td>
                    <td className="tabular px-1 text-right text-zinc-500">{num(r.units)}</td>
                    {ctx.filters.cats.map((c) => {
                      const x = r.cells[c];
                      const idx = x.idx ?? 0;
                      const bg = !x.live ? "#fef3c7" : idx < 0.5 ? "#fde68a" : `rgba(168,112,63,${Math.min(0.85, 0.1 + idx * 0.3)})`;
                      return <td key={c} className="px-0.5 py-0.5"><div title={`${catLabel(c)}: ${pct(x.share, 2)} of units · ${num(idx, 2)}× median`} className={cn("tabular rounded px-1 py-0.5 text-center", idx > 1.6 ? "text-white" : "text-zinc-800")} style={{ background: bg }}>{x.live ? pct(x.share, 1) : "not live"}</div></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LabCard>

        <div className="grid gap-3 xl:grid-cols-2">
          {/* 9 · mix */}
          <LabCard id="mix" title="9 · Channel-mix shift" why="A category whose revenue is migrating between channels needs its stock, pricing and marketing to migrate too."
            action="Where a channel gains > 5 pp, re-split warehouse allocation and the month target towards it.">
            <div className="space-y-2">
              {L.mixShift.map((m) => (
                <div key={m.c}>
                  <div className="mb-0.5 flex items-center justify-between text-[11.5px]"><Cat c={m.c} /><span className="flex gap-2 text-[11px]">{m.ch.map((x) => <span key={x.k} className="text-zinc-500">{CH_LABEL[x.k]} <span className={cn("tabular font-medium", x.pp == null ? "text-zinc-400" : x.pp > 0.005 ? "text-emerald-700" : x.pp < -0.005 ? "text-rose-600" : "text-zinc-500")}>{x.pp == null ? "—" : `${x.pp > 0 ? "+" : ""}${(x.pp * 100).toFixed(1)}pp`}</span></span>)}</span></div>
                  <div className="flex h-4 overflow-hidden rounded bg-zinc-100">{m.ch.map((x) => (x.share ?? 0) > 0 && <span key={x.k} style={{ width: `${(x.share ?? 0) * 100}%`, background: CH_COLORS[x.k] }} title={`${CH_LABEL[x.k]} ${pct(x.share, 0)} (was ${pct(x.prev, 0)})`} />)}</div>
                </div>
              ))}
            </div>
          </LabCard>

          {/* 10 · returns */}
          <LabCard id="returns" title="10 · Return-cost leakage (lifetime)" why="Returns cost reverse logistics, re-QC and lost margin — ₹ returned, not just %, shows where the money leaks."
            action="Fix size guidance / imagery for the top returned SKUs online; delist on the marketplace with the worst return % if it stays above 30%.">
            <MiniTable head={["Category", "₹ returned", "Overall %", ...(["stores", "online", "marketplace"] as const).map((k) => CH_LABEL[k] + " %")]}
              rows={L.leakage.map((l) => [<Cat key="c" c={l.c} />, inr(l.returned), pct(l.sold ? l.returned / l.sold : null, 1), ...l.ch.map((x) => <span key={x.k} className={cn((x.pct ?? 0) > 0.2 && "text-rose-600")}>{pct(x.pct, 1)}</span>)])} />
            <div className="mt-2 text-[11px] font-medium text-zinc-600">Top SKUs by ₹ returned</div>
            <MiniTable head={["Product", "₹ returned", "Return %", "Online %", "Mkt %"]} rows={L.leakSkus.slice(0, 6).map((s) => [<Sku key="p" r={s} sub={catLabel(s.c)} />, inr(s.returned), pct(s.pct, 0), pct(s.on, 0), pct(s.mp, 0)])} />
          </LabCard>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          {/* 11 · marketplace */}
          <LabCard id="mp" title="11 · Marketplace listing gaps" why="Proven online sellers with warehouse stock but zero marketplace sales are usually a listing problem, not a demand problem."
            action={`Check listings (live / suppressed / priced out) on Myntra, Ajio, Flipkart and Amazon for these SKUs; potential = online ₹ × the long-tail marketplace : online ratio (${pct(L.mpRatio, 0)}).`}>
            <MiniTable head={["Product", "Online units", "Online ₹", "Mkt units (lifetime)", "WH stock", "Potential ₹"]}
              rows={L.mpGaps.slice(0, 10).map((m) => [<Sku key="p" r={m} sub={catLabel(m.c)} />, num(m.onUnits), inr(m.onRev), num(m.mpLifetime), num(m.wh), <b key="x">{inr(m.potential)}</b>])} />
          </LabCard>

          {/* 12 · cannibal */}
          <LabCard id="cannibal" title="12 · Cannibalisation hints" why="A launch that grows while its siblings shrink and the type is flat is shifting demand, not adding it — the buy should have been a replacement."
            action="Treat these as replacement launches: stop repeat buys of the declining siblings and move their stock to channels where the new design isn't live.">
            {L.cannibal.length ? (
              <div className="space-y-2.5">
                {L.cannibal.slice(0, 6).map((g) => (
                  <div key={`${g.c}|${g.l1}`} className="rounded-lg border border-line p-2">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[12px]"><span className="font-medium">{catLabel(g.c)} · {g.l1}</span>
                      <span className="text-[11px] text-zinc-500">{g.oldCount} established <Delta v={g.oldChg} /> · type overall <Delta v={g.grpChg} /> · L7 vs prior 7</span></div>
                    <div className="flex flex-wrap gap-3">{g.fresh.map((f) => <Sku key={f.sku} r={f} sub={`L7 ${inr(f.l7)}`} />)}</div>
                  </div>
                ))}
              </div>
            ) : <p className="py-4 text-center text-[12px] text-zinc-500">No clear cannibalisation pattern this week (needs a ≤ 45-day launch taking ≥ 20% of its type while established siblings drop ≥ 15% and the type is flat).</p>}
          </LabCard>
        </div>

        {/* 13 · turns */}
        <LabCard id="turns" title="13 · Inventory turns & GMROI" why="Turns show how hard stock works; GMROI (gross margin ÷ stock at cost) says whether the category earns its inventory — the metric a CFO will ask for."
          action="Categories below 3 turns / GMROI below 1.5 should buy shallower and replenish faster; high-GMROI categories deserve more open-to-buy.">
          <MiniTable head={["Category", "Stock units", "Stock @ MRP", "Stock @ cost", "L30 units", "Turns / yr", "Gross margin %", "GMROI (annual)", "COGS coverage"]}
            rows={L.turns.map((t) => [<Cat key="c" c={t.c} />, num(t.stock), inr(t.stockMrp), t.stockCost ? inr(t.stockCost) : "—", num(t.l30U),
              <span key="t" className={cn(t.turns != null && t.turns < 3 && "text-amber-700")}>{t.turns == null ? "—" : num(t.turns, 1)}</span>, pct(t.gm, 0),
              <b key="g" className={cn(t.gmroi != null && t.gmroi < 1.5 && "text-amber-700")}>{t.gmroi == null ? "—" : num(t.gmroi, 2)}</b>, pct(t.cogsCover, 0)])} />
          <p className="mt-2 text-[11px] text-zinc-500">Turns = L30 units × 12 ÷ current stock (stores + warehouse). GMROI = (L30 revenue − L30 units × COGS) × 12 ÷ stock at COGS; shown only where ≥ 50% of L30 revenue has a COGS in the Product Master. Revenue is gross of returns.</p>
        </LabCard>

        {/* ideas */}
        <section className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-3">
          <h2 className="text-[13px] font-semibold text-zinc-800">Ideas to expand the horizon</h2>
          <p className="mt-0.5 text-[11.5px] text-zinc-500">Next candidates for the Lab — most need one more data source.</p>
          <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-[12px] text-zinc-700 md:grid-cols-2">
            {[
              ["Pricing & promotion effectiveness", "discount depth vs unit lift by SKU; which promos pay back (needs promo calendar)"],
              ["Store expansion planner", "which cities / formats to open long-tail corners in next, from penetration and catchment"],
              ["Returns deep-dive", "return reasons by size / channel / vendor (needs return-reason feed)"],
              ["Customer cohorts & repeat", "repeat rate and cross-category attach (apparel → shoes / perfume) from CRM"],
              ["Competitor & market pricing", "price-position vs marketplace competitors for top SKUs"],
              ["Festive planning calendar", "Diwali / wedding / EOSS phasing for targets, OTB and allocation"],
              ["Vendor scorecard", "fill rate, lead time, defect / return rate per vendor"],
              ["Attach-rate at the till", "long-tail units per 100 apparel bills by store (needs bill-level data)"],
              ["Online funnel", "PDP views → add-to-cart → orders for long-tail SKUs (needs Shopify analytics)"],
              ["Markdown optimiser", "suggested markdown by ageing bucket to clear before the season turns"],
            ].map(([t, d]) => <li key={t} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" /><span><b className="font-medium">{t}</b> — <span className="text-zinc-500">{d}</span></span></li>)}
          </ul>
        </section>
      </div>
    </>
  );
}
