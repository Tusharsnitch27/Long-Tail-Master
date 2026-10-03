import Link from "next/link";
import { Fragment } from "react";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { pageContext, withQs, type SP } from "@/server/context";
import { getProductMap, productL1 } from "@/server/data/products";
import { getWarehouseStock, getProductWarehouseHistory, FACILITIES, ZONE } from "@/server/data/warehouse";
import { getSkuFacts, getSkuDailyMulti } from "@/server/data/sku";
import { getChannelSku, getChannelSkuDaily } from "@/server/data/channels";
import { getStoreInventory, getProductStoreHistory } from "@/server/data/inventory";
import { getInwards } from "@/server/data/metafields";
import { listRemarks } from "@/server/data/remarks";
import { ProductRemarks } from "@/components/products/ProductRemarks";
import { gitOrEmpty } from "@/server/scope";
import { InvMix } from "@/components/InvMix";
import { productTagLabel } from "@/lib/productTags";
import { buildActions, actionStatuses } from "@/server/actions";
import { ucChannel, CH_LABEL, type ChKey } from "@/server/channelData";
import { rollingBySku, isFreeGift, describeProduct, attrList, performanceSummary, productOpportunities, DEF, type DetailFacts, type StoreLine, type Opp } from "@/server/productInsights";
import { catLabel } from "@/server/views";
import { Kpi, KpiGrid, Section, Meter, Empty, DataPrompt, Pill, Delta, Tip } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { SwitchTrend } from "@/components/charts/SwitchTrend";
import { compactNum, inr, num, pct } from "@/lib/format";
import { addDays, diffDays, eachDay, fmtDate, fmtRange } from "@/lib/dates";
import { growth, safeDiv } from "@/lib/metrics";
import { CH_COLORS } from "@/lib/colors";
import { cn } from "@/lib/cn";

const CHS: ChKey[] = ["stores", "online", "marketplace"];
const OPP_TONE = { bad: "bad", warn: "warn", good: "good", info: "info" } as const;
const OPP_LABEL = { bad: "Urgent", warn: "Fix", good: "Grow", info: "Check" } as const;

export default async function ProductDetail({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<SP> }) {
  const sku = decodeURIComponent((await params).sku).toUpperCase();
  const ctx = await pageContext(searchParams);
  const pm = await getProductMap();
  const p = pm.get(sku);
  const back = withQs(ctx, "/products");
  if (!p) return <><Link href={back} className="mb-3 inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-ink"><ChevronLeft className="size-3.5" />Product Master</Link><Empty title={`Product ${sku} not found`}>It isn’t in the product master or the metafield sheet.</Empty></>;
  const cat = p.category;
  const { range, compare } = ctx.period;
  const asOf = ctx.asOf;
  const t60 = { from: addDays(asOf, -59), to: asOf };
  const hist = { from: addDays(asOf, -89), to: asOf };
  const cctx = cat ? { ...ctx, filters: { ...ctx.filters, cats: [cat] } } : ctx;
  const [wh, roll, stPeriod, ucPeriod, storeDaily, ucDaily, inv, inwards, storeHist, whHist, act, statuses] = await Promise.all([
    getWarehouseStock(new Set(pm.keys())),
    rollingBySku(asOf, cat ? [cat] : []),
    cat ? getSkuFacts({ range, compare, asOf, cats: [cat], ch: "store" }) : Promise.resolve([]),
    getChannelSku({ range, compare, asOf }),
    getSkuDailyMulti([sku], t60, "store"), getChannelSkuDaily([sku], t60),
    getStoreInventory([...pm.keys()]).catch(() => []),
    getInwards(sku).catch(() => []),
    getProductStoreHistory(sku, hist.from, hist.to).catch(() => []),
    getProductWarehouseHistory(sku, hist.from, hist.to).catch(() => []),
    buildActions(cctx).catch(() => ({ actions: [] as Awaited<ReturnType<typeof buildActions>>["actions"] })), actionStatuses(),
  ]);
  const git = await gitOrEmpty(new Set(pm.keys()));
  const g = git.bySku.get(sku);
  const remarks = (await listRemarks()).filter((r) => r.scope === "product" && r.scope_id === sku);
  const tagLabels = remarks.map((r) => productTagLabel(r.tag)).filter((x): x is string => !!x);
  const w = wh.bySku.get(sku);
  const rl = roll.map.get(sku);
  const gitInv = g?.units ?? 0;
  const storeInv = p.invOffline ?? 0, whInv = w?.units ?? 0, totalInv = storeInv + gitInv + whInv;
  const allL30u = rl?.all.l30u ?? 0;
  const gift = isFreeGift(rl?.all.l30, allL30u, p.sales.all, p.qty.all);
  const row = {
    l7: rl?.all.l7 ?? 0, p7: rl?.all.p7 ?? 0, l7Units: rl?.all.l7u ?? 0, l30: rl?.all.l30 ?? 0, p30: rl?.all.p30 ?? 0, l30Units: allL30u, p30Units: rl?.all.p30u ?? 0,
    wow: growth(rl?.all.l7, rl?.all.p7), mom: growth(rl?.all.l30, rl?.all.p30), doi: allL30u > 0 ? totalInv / (allL30u / 30) : null,
    str30: allL30u + totalInv > 0 ? allL30u / (allL30u + totalInv) : null, ltStr: safeDiv(p.qty.all, p.inwardTotal),
    storeInv, git: gitInv, whInv, whNorth: w?.byZone.North ?? 0, whSouth: w?.byZone.South ?? 0, totalInv,
  };

  // store distribution: period + L30 sales lines, merged with live store stock
  const lines = new Map<string, StoreLine>();
  const keyOf = (b: string | null, name: string) => b ?? `n:${name.toUpperCase()}`;
  const line = (b: string | null, name: string) => {
    const k = keyOf(b, name);
    let e = lines.get(k);
    if (!e) {
      const s = b ? ctx.byCode.get(b) : undefined;
      lines.set(k, (e = { b, name: s?.short_name ?? name.replace(/^SNITCH\s*-\s*/i, ""), region: s?.region ?? null, city: s?.city ?? null, revenue: 0, units: 0, l30: 0, l30u: 0, l7u: 0, stock: 0, s30: 0, last: null, doi: null }));
    }
    return e;
  };
  const storeB = (n: string) => ctx.byName.get(n.toUpperCase())?.branch_code ?? null;
  for (const f of stPeriod) if (f.sku === sku) { const e = line(storeB(f.ch), f.ch); e.revenue += f.rs; e.units += f.rq; e.l7u += f.l7q; if (f.last && (!e.last || f.last > e.last)) e.last = f.last; }
  for (const f of roll.st) if (f.sku === sku) { const e = line(storeB(f.ch), f.ch); e.l30 += f.rs; e.l30u += f.rq; }
  for (const r of inv) if (r.sku === sku) { const e = line(r.b, r.store); e.stock += r.units; e.s30 += r.s30; }
  for (const l of git.lines) if (l.sku === sku) { const e = line(l.b, l.store); e.git = (e.git ?? 0) + l.qty; }
  const stores = [...lines.values()].filter((s) => s.revenue > 0 || s.l30u > 0 || s.stock > 0 || (s.git ?? 0) > 0)
    .map((s) => ({ ...s, doi: s.l30u > 0 ? (s.stock + (s.git ?? 0)) / (s.l30u / 30) : null }))
    .sort((a, b) => b.revenue - a.revenue || b.l30 - a.l30 || b.stock - a.stock);

  // category benchmarks
  const peers = [...pm.values()].filter((x) => x.category === cat);
  const catSales = peers.reduce((a, x) => a + (x.sales.all ?? 0), 0), catRet = peers.reduce((a, x) => a + (x.returnsValue.all ?? 0), 0);
  const catPairs = roll.st.filter((f) => f.rq > 0);
  const facts: DetailFacts = {
    p, row, roll: rl, stores, sizes: Object.entries(w?.bySize ?? {}).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })),
    catReturn: safeDiv(catRet, catSales), catStorePerStore: catPairs.length ? catPairs.reduce((a, f) => a + f.rs, 0) / catPairs.length : null,
    activeStores: new Set(catPairs.map((f) => f.ch)).size, inwards, soldSinceInward: null, asOf,
  };

  // 60-day trend by channel
  const trend = eachDay(t60.from, t60.to).map((d) => ({ date: d, stores: 0, online: 0, marketplace: 0, uStores: 0, uOnline: 0, uMarketplace: 0, avg: 0 as number | null }));
  const at = new Map(trend.map((x, i) => [x.date, i]));
  for (const r of storeDaily) { const i = at.get(r.date); if (i != null) { trend[i].stores += r.sales; trend[i].uStores += r.qty; } }
  for (const r of ucDaily) { const i = at.get(r.d); const k = ucChannel(r.mp); if (i != null && k) { trend[i][k] += r.revenue; trend[i][k === "online" ? "uOnline" : "uMarketplace"] += r.units; } }
  trend.forEach((x, i) => { const win = trend.slice(Math.max(0, i - 6), i + 1); x.avg = i >= 6 ? win.reduce((a, y) => a + y.stores + y.online + y.marketplace, 0) / 7 : null; });
  const t60Units = trend.reduce((a, x) => a + x.uStores + x.uOnline + x.uMarketplace, 0);
  const lastIn = inwards.at(-1);
  if (lastIn && lastIn.d.slice(0, 10) >= t60.from) facts.soldSinceInward = trend.filter((x) => x.date > lastIn.d.slice(0, 10)).reduce((a, x) => a + x.uStores + x.uOnline + x.uMarketplace, 0);

  const [s1, s2] = performanceSummary(facts);
  const opps: Opp[] = productOpportunities(facts);
  const actions = act.actions.filter((a) => a.product?.sku === sku);
  const desc = describeProduct(p);
  const attrs = attrList(p);
  const admin = ctx.user?.role === "admin";

  // channel table: period (selected preset), L30, lifetime
  const ucMine = ucPeriod.filter((f) => f.sku === sku);
  const perCh = CHS.map((k) => {
    const period = k === "stores" ? stPeriod.filter((f) => f.sku === sku).reduce((a, f) => ({ r: a.r + f.rs, u: a.u + f.rq, pr: a.pr + f.ps }), { r: 0, u: 0, pr: 0 })
      : ucMine.filter((f) => ucChannel(f.mp) === k).reduce((a, f) => ({ r: a.r + f.rs, u: a.u + f.rq, pr: a.pr + f.ps }), { r: 0, u: 0, pr: 0 });
    return { k, period, l30: rl?.ch[k].l30 ?? 0, p30: rl?.ch[k].p30 ?? 0, l30u: rl?.ch[k].l30u ?? 0, lt: p.sales[k] ?? 0, ltu: p.qty[k] ?? 0, ret: p.returnPct[k] };
  });
  const mps = [...new Set(ucMine.filter((f) => ucChannel(f.mp) === "marketplace").map((f) => f.mp))].map((mp) => {
    const r = ucMine.filter((f) => f.mp === mp).reduce((a, f) => ({ r: a.r + f.rs, u: a.u + f.rq, pr: a.pr + f.ps }), { r: 0, u: 0, pr: 0 });
    return { mp, ...r, l30: rl?.mp[mp]?.l30 ?? 0, p30: rl?.mp[mp]?.p30 ?? 0 };
  }).filter((x) => x.r > 0 || x.l30 > 0).sort((a, b) => b.r - a.r || b.l30 - a.l30);
  const pTot = perCh.reduce((a, x) => a + x.period.r, 0), l30Tot = perCh.reduce((a, x) => a + x.l30, 0), ltTot = perCh.reduce((a, x) => a + x.lt, 0);

  // inventory history (daily snapshots)
  const sh = new Map(storeHist.map((r) => [r.d, r]));
  const whD = new Map<string, { south: number; north: number }>();
  for (const r of whHist) { const e = whD.get(r.d) ?? { south: 0, north: 0 }; if (r.zone === "North") e.north += r.units; else e.south += r.units; whD.set(r.d, e); }
  const invTrend = eachDay(hist.from, hist.to).map((d) => ({ date: d, store: sh.get(d)?.units ?? null, south: whD.get(d)?.south ?? null, north: whD.get(d)?.north ?? null, stores: sh.get(d)?.stores ?? null }));
  const hasInvHist = invTrend.some((x) => x.store != null || x.south != null);

  // inward timeline
  const inTot = inwards.reduce((a, x) => a + x.qty, 0);
  const inByWh = [...new Set(inwards.map((x) => x.wh))].map((f) => ({ f, qty: inwards.filter((x) => x.wh === f).reduce((a, x) => a + x.qty, 0), n: inwards.filter((x) => x.wh === f).length })).sort((a, b) => b.qty - a.qty);
  const facs = FACILITIES.map((f) => ({ f, zone: ZONE[f], u: w?.byFacility[f] ?? 0 }));
  const sizes = facts.sizes;
  const sizeMax = Math.max(1, ...sizes.map(([, v]) => v));
  const selling = stores.filter((s) => s.l30u > 0).length, stockedNoSale = stores.filter((s) => s.stock > 0 && s.l30u === 0).length;

  return (
    <>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-ink"><ChevronLeft className="size-3.5" />Product Master</Link>

      <div className="mb-4 grid gap-4 card rounded-[18px] p-4 shadow-[0_1px_2px_rgba(60,40,20,.04)] lg:grid-cols-[184px_1fr]">
        <div>
          {p.image ? (
            <a href={p.image} target="_blank" rel="noreferrer" className="group relative block size-[184px] overflow-hidden rounded-xl border border-line bg-brand-50/40">
              <img src={p.image} alt={p.name ?? sku} className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
              <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100"><ExternalLink className="size-3" />full size</span>
            </a>
          ) : <div className="flex size-[184px] items-center justify-center rounded-xl bg-brand-50 text-[12px] text-brand-400">no image</div>}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="font-serif text-[26px] leading-tight tracking-[-0.02em]">{p.name ?? sku}</h1>
              {tagLabels.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{tagLabels.map((t) => <span key={t} className="rounded-md bg-brand-900 px-1.5 py-0.5 text-[11px] font-medium text-canvas">{t}</span>)}</div>}
              <div className="mt-0.5 text-[12px] text-zinc-500"><span className="font-mono">{sku}</span> · MRP {inr(p.mrp, { compact: false })}{p.sellingPrice && p.sellingPrice !== p.mrp ? ` · selling ${inr(p.sellingPrice, { compact: false })}` : ""}{p.liveDate ? ` · live ${fmtDate(p.liveDate.slice(0, 10), true)}${p.daysSinceLive != null ? ` (${num(p.daysSinceLive)} days)` : ""}` : ""}{p.lastInward ? ` · last inward ${fmtDate(p.lastInward.slice(0, 10), true)}` : ""}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {gift && <Pill tone="info">Free gift</Pill>}
              {p.lifecycle && <Pill tone="muted">{p.lifecycle.toLowerCase()}</Pill>}
              {row.doi != null && row.doi < 21 && <Pill tone="bad">{num(row.doi)} days cover</Pill>}
              {row.doi != null && row.doi > 180 && <Pill tone="warn">overstocked</Pill>}
              {totalInv <= 0 && <Pill tone="bad">out of stock</Pill>}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {cat && <Link href={withQs(ctx, "/category", { cat })} className="rounded bg-brand-900 px-1.5 py-0.5 text-[11px] text-white hover:bg-brand-800">{catLabel(cat)}</Link>}
            {[productL1(p), p.l2, p.attrs.colour, p.collection].filter(Boolean).map((t, i) => <span key={i} className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-800">{t}</span>)}
          </div>
          {desc && <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-zinc-700">{desc}</p>}
          <div className="mt-2.5 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-[12.5px] leading-relaxed text-brand-900">
            <div>{s1}</div><div>{s2}</div>
          </div>
          {attrs.length > 0 ? (
            <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-3 xl:grid-cols-5">
              {attrs.map((a) => <div key={a.k} className="min-w-0"><dt className="text-zinc-400">{a.label}</dt><dd className="truncate font-medium text-zinc-700">{a.v}</dd></div>)}
            </dl>
          ) : <div className="mt-2.5"><DataPrompt compact title="No metafields for this product" href={admin ? "/settings?tab=attributes" : undefined} cta="Add attributes">Colour, type and other attributes power search, filters and the description.{!admin && " Ask an admin to add them."}</DataPrompt></div>}
        </div>
      </div>

      <KpiGrid cols={8}>
        <Kpi label="Lifetime sales" value={inr(p.sales.all)} sub={`${num(p.qty.all)} units`} tip="Product Master, all channels, to date" />
        <Kpi label="Lifetime STR" value={pct(row.ltStr, 0)} sub={`${num(p.qty.all)} of ${num(p.inwardTotal)} inwarded`} tip={DEF.ltStr} />
        <Kpi label="L30 sales" value={inr(row.l30)} delta={row.mom} deltaLabel="vs P30" sub={`${num(row.l30Units)} units`} tip={`${DEF.l30.replace(", selected channel", ", all channels")}; ${DEF.mom}`} />
        <Kpi label="L7 sales" value={inr(row.l7)} delta={row.wow} deltaLabel="vs P7" sub={`${num(row.l7Units)} units`} tip={`${DEF.l7.replace(", selected channel", ", all channels")}; ${DEF.wow}`} />
        <Kpi label="Return %" value={pct(p.returnPct.all, 1)} sub={facts.catReturn != null ? `category ${pct(facts.catReturn, 1)}` : "lifetime"} tone={p.returnPct.all != null && facts.catReturn != null && p.returnPct.all > facts.catReturn + 0.05 ? "warn" : undefined} tip="Lifetime returned ₹ ÷ sold ₹, all channels" />
        <Kpi label="Store stock" value={num(storeInv)} sub={<>{num(p.storesStocked)} stores · {num(selling)} selling{gitInv ? <> · <b className="font-semibold text-brand-700">{num(gitInv)}</b> in transit</> : null}</>} tip={`${DEF.storeInv}. ${DEF.git}`} />
        <Kpi label="Warehouse" value={num(whInv)} sub={`S ${num(row.whSouth)} · N ${num(row.whNorth)}`} tip={DEF.wh} />
        <Kpi label="Days of cover" value={row.doi != null ? num(row.doi) : totalInv > 0 ? "No sales" : "—"} sub={`STR L30 ${pct(row.str30, 0)}`} tone={row.doi == null ? (totalInv > 0 ? "warn" : undefined) : row.doi < 21 ? "bad" : row.doi > 180 ? "warn" : "good"} tip={`${DEF.doi}. ${DEF.str30}`} />
      </KpiGrid>

      <div className="mt-3">
        <Section title="Sales · last 60 days" tip="Daily revenue (with the 7-day average, all channels) or units by channel. Stores = store sales lines; Online / Marketplace = Unicommerce items incl. cancellations">
          <SwitchTrend name={`${sku}-sales-60d`} data={trend} height={230} views={[
            { key: "revenue", label: "Revenue", total: inr(trend.reduce((a, x) => a + x.stores + x.online + x.marketplace, 0)), series: [...CHS.map((k) => ({ key: k, label: CH_LABEL[k], color: CH_COLORS[k], stack: "r" })), { key: "avg", label: "7-day avg", color: "#1b1712", type: "line" as const, dashed: true }] },
            { key: "units", label: "Units", yFormat: "num", total: `${num(t60Units)} units`, series: CHS.map((k) => ({ key: k === "stores" ? "uStores" : k === "online" ? "uOnline" : "uMarketplace", label: CH_LABEL[k], color: CH_COLORS[k], stack: "u" })) },
          ]} />
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.25fr_1fr]">
        <Section title="Channel split" pad={false} tip={`Period = ${fmtRange(range)}; L30 vs prior 30 days; lifetime and return % from the Product Master`}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Channel", `${ctx.period.preset.toUpperCase()} ₹`, "Units", "Growth", "L30 ₹", "vs P30", "Lifetime ₹", "Share", "Return %"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium", i ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
              <tbody>
                {perCh.map((c) => (<Fragment key={c.k}>
                  <tr className="border-b border-zinc-100">
                    <td className="px-3 py-2"><span className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full" style={{ background: CH_COLORS[c.k] }} />{CH_LABEL[c.k]}</span></td>
                    <td className="tabular px-3 text-right">{inr(c.period.r)} <span className="text-[11px] text-zinc-400">{pTot ? pct(c.period.r / pTot, 0) : ""}</span></td>
                    <td className="tabular px-3 text-right">{num(c.period.u)}</td><td className="px-3 text-right"><Delta v={growth(c.period.r, c.period.pr)} /></td>
                    <td className="tabular px-3 text-right">{inr(c.l30)} <span className="text-[11px] text-zinc-400">{l30Tot ? pct(c.l30 / l30Tot, 0) : ""}</span></td><td className="px-3 text-right"><Delta v={growth(c.l30, c.p30)} /></td>
                    <td className="tabular px-3 text-right">{inr(c.lt)}</td><td className="px-3 text-right"><span className="inline-flex w-20 items-center gap-1.5"><Meter value={safeDiv(c.lt, ltTot)} color={CH_COLORS[c.k]} /><span className="tabular text-[11px]">{pct(safeDiv(c.lt, ltTot), 0)}</span></span></td>
                    <td className={cn("tabular px-3 text-right", c.ret != null && facts.catReturn != null && c.ret > facts.catReturn + 0.05 && "font-semibold text-amber-700")}>{pct(c.ret, 1)}</td>
                  </tr>
                  {c.k === "marketplace" && mps.map((x) => (
                    <tr key={x.mp} className="border-b border-zinc-100 text-[12px] text-zinc-600">
                      <td className="py-1.5 pl-8 pr-3">{x.mp[0] + x.mp.slice(1).toLowerCase()}</td><td className="tabular px-3 text-right">{inr(x.r)}</td><td className="tabular px-3 text-right">{num(x.u)}</td>
                      <td className="px-3 text-right"><Delta v={growth(x.r, x.pr)} /></td><td className="tabular px-3 text-right">{inr(x.l30)}</td><td className="px-3 text-right"><Delta v={growth(x.l30, x.p30)} /></td><td colSpan={3} />
                    </tr>
                  ))}
                </Fragment>))}
              </tbody>
              <tfoot><tr className="bg-zinc-50 font-semibold"><td className="px-3 py-2">Total</td><td className="tabular px-3 text-right">{inr(pTot)}</td><td className="tabular px-3 text-right">{num(perCh.reduce((a, c) => a + c.period.u, 0))}</td><td className="px-3 text-right"><Delta v={growth(pTot, perCh.reduce((a, c) => a + c.period.pr, 0))} /></td><td className="tabular px-3 text-right">{inr(l30Tot)}</td><td className="px-3 text-right"><Delta v={row.mom} /></td><td className="tabular px-3 text-right">{inr(ltTot)}</td><td /><td className="tabular px-3 text-right">{pct(p.returnPct.all, 1)}</td></tr></tfoot>
            </table>
          </div>
        </Section>
        <Section title="Inward timeline" tip="New inwards only (putaway completion date, warehouse, quantity)"
          right={inwards.length ? <span className="text-[11.5px] text-zinc-500">{num(inTot)} units · {inwards.length} putaways</span> : undefined}>
          {inwards.length ? <>
            <div className="mb-3 flex flex-wrap gap-1.5">{inByWh.map((x) => <span key={x.f} className="rounded-md bg-zinc-50 px-2 py-1 text-[11.5px] ring-1 ring-zinc-100">{x.f} <span className="text-zinc-400">{ZONE[x.f] ?? ""}</span> <b className="tabular font-semibold">{num(x.qty)}</b></span>)}</div>
            <ol className="relative max-h-[300px] space-y-2.5 overflow-y-auto border-l border-brand-200 pl-4 scroll-thin">
              {[...inwards].reverse().map((x, i) => {
                const d = x.d.slice(0, 10);
                return (
                  <li key={i} className="relative">
                    <span className={cn("absolute -left-[21px] top-1 size-2.5 rounded-full ring-2 ring-white", i === 0 ? "bg-brand-500" : "bg-brand-300")} />
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
                      <span><b className="font-semibold">{fmtDate(d, true)}</b> <span className="text-zinc-400">· {num(diffDays(d, asOf))} days ago</span></span>
                      <span className="tabular font-semibold">{num(x.qty)} units</span>
                    </div>
                    <div className="text-[11.5px] text-zinc-500">{x.wh}{ZONE[x.wh] ? ` (${ZONE[x.wh]})` : ""} · {x.done >= x.qty ? "putaway complete" : `${num(x.done)} put away`}{x.lines > 1 ? ` · ${x.lines} lines` : ""}</div>
                  </li>
                );
              })}
            </ol>
            {facts.soldSinceInward != null && lastIn && <div className="mt-3 text-[11.5px] text-zinc-600">Since the latest inward ({fmtDate(lastIn.d.slice(0, 10))}): <b className="font-semibold">{num(facts.soldSinceInward)}</b> units sold, all channels.</div>}
            {p.inwardTotal != null && Math.abs(p.inwardTotal - inTot) > Math.max(5, inTot * 0.05) && <div className="mt-1 text-[11px] text-zinc-400">Product Master inward total is {num(p.inwardTotal)} (includes inwards outside the new-inward putaway feed).</div>}
          </> : <Empty title="No new-inward putaways">No new inwards recorded for {sku}.{p.inwardTotal ? ` Product Master shows ${num(p.inwardTotal)} inwarded to date.` : ""}</Empty>}
        </Section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.25fr_1fr]">
        <Section title={`Store distribution · ${num(stores.length)} stores`} pad={false} tip={`Sorted by revenue in ${fmtRange(range)}. Stock = latest store report; in transit = on its way to that store. Cover = (store stock + in transit) ÷ that store's L30 daily units.`}
          right={<span className="text-[11.5px] text-zinc-500">{num(selling)} selling L30{stockedNoSale ? <> · <span className="text-amber-700">{num(stockedNoSale)} stocked, no L30 sale</span></> : null}</span>}>
          {stores.length ? (
            <div className="max-h-[440px] overflow-auto scroll-thin">
              <table className="w-full whitespace-nowrap text-[12.5px]">
                <thead className="sticky top-0 bg-white"><tr className="border-b border-line text-[11px] text-zinc-500">{["Store", "Revenue", "Units", "L7", "L30", "Stock", "In transit", "Cover"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium", i ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
                <tbody>{stores.map((s) => (
                  <tr key={keyOf(s.b, s.name)} className="border-b border-zinc-100 hover:bg-zinc-50">
                    <td className="px-3 py-1.5">{s.b ? <Link href={withQs(ctx, `/stores/${s.b}`)} className="font-medium hover:underline">{s.name}</Link> : <span className="font-medium">{s.name}</span>}{(s.city || s.region) && <span className="ml-1.5 text-[11px] text-zinc-400">{[s.city, s.region].filter(Boolean).join(" · ")}</span>}</td>
                    <td className="tabular px-3 text-right font-medium">{s.revenue ? inr(s.revenue) : <span className="text-zinc-300">—</span>}</td><td className="tabular px-3 text-right">{num(s.units)}</td>
                    <td className="tabular px-3 text-right">{num(s.l7u)}</td><td className="tabular px-3 text-right">{num(s.l30u)}</td>
                    <td className={cn("tabular px-3 text-right", s.stock === 0 && s.l30u > 0 && "font-semibold text-rose-600")}>{num(s.stock)}</td>
                    <td className="tabular px-3 text-right text-brand-700">{s.git ? num(s.git) : <span className="text-zinc-300">—</span>}</td>
                    <td className="px-3 text-right">{s.doi != null ? <span className={cn("tabular", s.doi < 14 ? "font-semibold text-rose-600" : s.doi > 120 ? "text-amber-700" : "")}>{num(s.doi)} d</span> : s.stock > 0 ? <Pill tone="warn">no sale</Pill> : <span className="text-zinc-300">—</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="px-4 py-6 text-center text-[12.5px] text-zinc-500">No store sales or store stock for this product.</div>}
        </Section>
        <Section title="Inventory now" tip={`Three phases. ${DEF.storeInv}. ${DEF.git}. ${DEF.wh}`} right={gitInv ? <Link href={withQs(ctx, "/stores", { tab: "git", q: sku })} className="text-[11.5px] font-medium text-brand-700 hover:underline">In-transit detail →</Link> : undefined}>
          <div className="grid grid-cols-5 gap-3">
            {[["Stores", storeInv, `${num(p.storesStocked)} stores`], ["In transit", gitInv, gitInv ? `to ${num(g?.stores ?? 0)} stores` : "none"], ["WH South", row.whSouth, "WH1 + WH2"], ["WH North", row.whNorth, "Tauru"], ["Total", totalInv, row.doi != null ? `${num(row.doi)} days` : "—"]].map(([l, v, s]) => (
              <div key={String(l)} className="min-w-0"><div className="text-[11px] text-zinc-500">{l}</div><div className="tabular text-[16px] font-semibold">{num(Number(v))}</div><div className="text-[11px] text-zinc-400">{s}</div></div>
            ))}
          </div>
          <div className="mt-3"><InvMix className="w-full" store={storeInv} git={gitInv} wh={whInv} title={`${p.name ?? sku} · inventory`} /></div>
          <div className="mt-3 space-y-1.5">{facs.map((f) => (
            <div key={f.f} className="grid grid-cols-[140px_1fr_52px] items-center gap-2 text-[12px]"><span className="text-zinc-600">{f.f} <span className="text-[10.5px] text-zinc-400">{f.zone}</span></span><Meter value={safeDiv(f.u, whInv)} color={f.zone === "North" ? "#2e6f73" : "#c08f60"} /><span className="tabular text-right font-medium">{num(f.u)}</span></div>
          ))}</div>
          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-zinc-500">Warehouse by size <Tip text="Live warehouse units per size (all three warehouses). Red = size out of stock at the warehouse." /></div>
            {sizes.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">{sizes.map(([s, v]) => (
              <div key={s} className={cn("rounded-md px-2 py-1.5 text-center ring-1", v <= 0 ? "bg-rose-50 text-rose-700 ring-rose-100" : "bg-white ring-zinc-100")}>
                <div className="text-[10.5px] text-zinc-500">{s}</div><div className="tabular text-[13px] font-semibold">{num(v)}</div>
                <span className="mt-1 block h-1 overflow-hidden rounded bg-zinc-100"><span className="block h-full bg-brand-500" style={{ width: `${(Math.max(0, v) / sizeMax) * 100}%` }} /></span>
              </div>
            ))}</div> : <div className="text-[12px] text-zinc-400">No warehouse stock rows for this product.</div>}
          </div>
        </Section>
      </div>

      <div className="mt-3">
        <Section title="Inventory history · last 90 days" tip="Daily snapshots: store report (all stores) and warehouse history. Right axis = stores holding stock.">
          {hasInvHist ? <TrendChart name={`${sku}-inventory-history-90d`} data={invTrend} height={220} yFormat="num" rightFormat="num" series={[
            { key: "store", label: "Stores", color: CH_COLORS.stores, type: "line" }, { key: "south", label: "WH South", color: "#c08f60", type: "line" },
            { key: "north", label: "WH North", color: "#2e6f73", type: "line", dashed: true }, { key: "stores", label: "Stores stocked", color: "#b8a894", type: "line", dashed: true, axis: "right" },
          ]} /> : <div className="py-6 text-center text-[12.5px] text-zinc-500">No inventory snapshots for this product in the last 90 days.</div>}
        </Section>
      </div>

      <div className="mt-3">
        <Section title={`Team remarks${remarks.length ? ` · ${remarks.length}` : ""}`} tip="Product-level context for everyone. A tag (e.g. Not to be sent to stores) stops the actions it contradicts for this SKU; Harvey reads remarks too.">
          <ProductRemarks sku={sku} category={cat} remarks={remarks.map((r) => ({ id: r.id, tag: r.tag, text: r.text, by: r.created_by, at: r.created_at, canRemove: ctx.user?.role === "admin" || ctx.user?.username === r.created_by }))} />
        </Section>
      </div>

      <div className="mt-3">
        <Section title={`Action opportunities${opps.length + actions.length ? ` · ${opps.length + actions.length}` : ""}`} tip="Rules over this product's own sales, stock, sizes, returns and inwards — deterministic, no estimates beyond the stated rates">
          {opps.length ? <div className="grid gap-2 lg:grid-cols-2">{opps.map((o, i) => (
            <div key={i} className="flex gap-2.5 rounded-lg border border-line p-3">
              <Pill tone={OPP_TONE[o.tone]} className="h-fit">{OPP_LABEL[o.tone]}</Pill>
              <div className="min-w-0"><div className="text-[12.5px] font-semibold">{o.title}</div><div className="mt-0.5 text-[12px] text-zinc-600">{o.detail}</div></div>
            </div>
          ))}</div> : null}
          {actions.length > 0 && <div className={cn("grid gap-2 xl:grid-cols-2", opps.length && "mt-3")}>{actions.slice(0, 6).map((a) => <ActionCard key={a.key} a={a} qs={ctx.qs} status={statuses.get(a.key) ?? "open"} />)}</div>}
          {!opps.length && !actions.length && <div className="py-4 text-center text-[12.5px] text-zinc-500">Nothing to act on — stock, sizes, returns and sales trend are within normal ranges.</div>}
        </Section>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Store stock: latest store report ({compactNum(storeInv)} units). Warehouse: live{w?.updated ? ` (updated ${w.updated.slice(0, 16)})` : ""}. Sales incl. cancellations, to {fmtDate(asOf, true)}.</p>
    </>
  );
}
