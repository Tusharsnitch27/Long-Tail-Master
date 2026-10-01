import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadDemand, categoryPlans, parsePlanParams, targetDoi, type SkuDemand } from "@/server/planning";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Section, Kpi, KpiGrid, Pill, type Tone } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { WipBanner, WipPill, HowBox, MiniTable } from "@/components/wip/ui";
import { inr, num, pct } from "@/lib/format";
import { fmtDate } from "@/lib/dates";

export const metadata = { title: "Demand Planning" };

const BAND: Record<SkuDemand["band"], { label: string; tone: Tone }> = {
  stockout: { label: "Stock-out risk", tone: "bad" }, below: { label: "Below band", tone: "warn" }, in: { label: "In band", tone: "good" },
  above: { label: "Above band", tone: "info" }, excess: { label: "Excess", tone: "warn" }, no_sales: { label: "No sales", tone: "muted" },
};

export default async function DemandPlanning({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const pp = parsePlanParams(ctx.sp);
  const tgt = targetDoi(pp);
  const d = await loadDemand(ctx, pp);
  const cats = await categoryPlans(ctx, d, pp);
  const tot = cats.reduce((a, c) => ({ stock: a.stock + c.stock, rate: a.rate + c.rate, f30: a.f30 + c.f30, reorder: a.reorder + c.reorderUnits, reorderSkus: a.reorderSkus + c.reorderSkus, otb: a.otb + c.otb.otb, planned: a.planned + c.otb.plannedSales, onOrder: a.onOrder + c.onOrder, stockout: a.stockout + c.stockoutSkus }),
    { stock: 0, rate: 0, f30: 0, reorder: 0, reorderSkus: 0, otb: 0, planned: 0, onOrder: 0, stockout: 0 });
  const l30Tot = cats.reduce((a, c) => a + c.l30U, 0);
  const doi = l30Tot > 0 ? tot.stock / (l30Tot / 30) : null;
  const doiTone = (v: number | null): Tone => (v == null ? "muted" : v < pp.lo ? (v < 14 ? "bad" : "warn") : v <= pp.hi ? "good" : "warn");
  const nm = cats[0]?.otb.month;

  const skuRows = d.skus.filter((s) => s.rate > 0 || s.stock > 0).sort((a, b) => b.rate - a.rate).slice(0, 600).map((s) => ({
    sku: s.sku, name: s.name, image: s.image, category: catLabel(s.category), l1: s.l1, storeInv: s.storeInv, git: s.git, whInv: s.whInv, stock: s.stock,
    r7: s.l7U / 7, r30: s.l30U / 30, trend: s.trend == null ? null : s.trend - 1, f30: Math.round(s.f30), f60: Math.round(s.f60), f90: Math.round(s.f90),
    doi: s.doi == null ? null : Math.round(s.doi), onOrder: s.onOrder, reorder: s.reorder, reorderValue: s.reorder * (s.asp ?? 0), band: BAND[s.band].label,
  }));
  const cols: Col[] = [
    { key: "name", label: "Product", image: "image", imageSize: 44, sub: "sku", width: 260 }, { key: "category", label: "Category" }, { key: "l1", label: "Type", hidden: !ctx.filters.cat },
    { key: "storeInv", label: "Stores", type: "num", group: "Stock" }, { key: "git", label: "In transit", type: "num", group: "Stock" }, { key: "whInv", label: "Warehouse", type: "num", group: "Stock" }, { key: "stock", label: "Total", type: "num", group: "Stock" },
    { key: "r7", label: "L7", type: "dec", group: "Units / day" }, { key: "r30", label: "L30", type: "dec", group: "Units / day" }, { key: "trend", label: "Trend", type: "delta", group: "Units / day", tip: "L7 rate vs L30 rate (capped ±20–25%)" },
    { key: "f30", label: "30d", type: "num", group: "Forecast units" }, { key: "f60", label: "60d", type: "num", group: "Forecast units" }, { key: "f90", label: "90d", type: "num", group: "Forecast units" },
    { key: "doi", label: "DOI", type: "num", tip: "Days of inventory = stock ÷ (L30 units ÷ 30)" }, { key: "onOrder", label: "On order", type: "num", tip: "Open future inwards for this SKU group" },
    { key: "reorder", label: "Reorder", type: "num", bar: true, tip: `rate × (${pp.lead}d lead + ${tgt}d target) − stock − on order` }, { key: "reorderValue", label: "Reorder ₹", type: "inr", hidden: true },
    { key: "band", label: "Cover band" },
  ];

  return (
    <>
      <PageHeader title="Demand Planning" right={<WipPill />}
        subtitle={<>{ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories"} · DOI control, forecast, reorder and open-to-buy · stock as of {fmtDate(ctx.asOf, true)}</>} />
      <WipBanner>v1 planning model — every forward number here is a <b>projection</b> from recent rate of sale, not an actual. Seasonality (festive, EOSS) is only captured where a month target is set in the Control Centre. Share feedback before this becomes a buying tool.</WipBanner>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 card rounded-[18px] px-4 py-3 text-[12px] shadow-[0_1px_2px_rgba(60,40,20,.04)]">
        {ctx.filters.cat && <input type="hidden" name="cat" value={ctx.filters.cat} />}
        <label className="flex flex-col gap-1"><span className="text-[11px] text-zinc-500">Target DOI — min</span><input name="lo" type="number" min={1} max={365} defaultValue={pp.lo} className="w-24 rounded-md border border-line px-2 py-1" /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] text-zinc-500">Target DOI — max</span><input name="hi" type="number" min={1} max={400} defaultValue={pp.hi} className="w-24 rounded-md border border-line px-2 py-1" /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] text-zinc-500">Lead time (days)</span><input name="lt" type="number" min={0} max={180} defaultValue={pp.lead} className="w-24 rounded-md border border-line px-2 py-1" /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] text-zinc-500">L7 weight (0–1)</span><input name="w" type="number" min={0} max={1} step={0.1} defaultValue={pp.w} className="w-24 rounded-md border border-line px-2 py-1" /></label>
        <button className="rounded-md bg-brand-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-800">Apply</button>
        <Link href={withQs(ctx, "/planning", { lo: null, hi: null, lt: null, w: null })} className="py-1.5 text-[11.5px] text-zinc-500 hover:underline">Reset</Link>
        <span className="ml-auto self-center text-[11.5px] text-zinc-500">Target cover = mid of band = <b className="text-zinc-700">{tgt} days</b></span>
      </form>

      <KpiGrid cols={6}>
        <Kpi label="Stock · stores + warehouse" value={num(tot.stock)} sub="units" />
        <Kpi label="Forecast rate (weighted)" value={`${num(tot.rate, 1)}/day`} sub={`${num(tot.f30)} units next 30 days`} tip="Projection: weighted L7/L30 rate × damped trend" />
        <Kpi label="Days of inventory" value={doi == null ? "—" : `${num(doi)} d`} tone={doiTone(doi)} sub={`L30 basis · band ${pp.lo}–${pp.hi} d`} tip="(store + warehouse units) ÷ (L30 units ÷ 30)" />
        <Kpi label="Stock-out risk SKUs" value={num(tot.stockout)} tone={tot.stockout ? "bad" : "good"} sub="selling, < 14 days cover" />
        <Kpi label="Reorder suggestion" value={num(tot.reorder)} sub={`units across ${num(tot.reorderSkus)} SKUs`} />
        <Kpi label={`Open-to-buy · ${nm ? fmtDate(nm, true).slice(2) : "next month"}`} value={inr(tot.otb)} tone={tot.otb < 0 ? "warn" : "info"} sub={tot.otb < 0 ? "over-bought vs plan" : "at retail (ASP)"} />
      </KpiGrid>

      <Section className="mt-3" title="Category plan" tip="Stock, rate of sale, forecast and cover by category" pad={false}>
        <div className="px-4 pb-3">
          <MiniTable
            head={["Category", "Stores", "Warehouse", "L7/day", "L30/day", "Trend", "30d", "60d", "90d", "DOI", "On order", "Reorder", "Stock-out SKUs", "Excess units"]}
            rows={cats.map((c) => [
              <Link key="c" href={withQs(ctx, "/planning", { cat: c.c })} className="flex items-center gap-1.5 font-medium hover:underline"><span className="size-2 rounded-full" style={{ background: catColor(c.c) }} />{catLabel(c.c)}</Link>,
              num(c.storeInv), num(c.whInv), num(c.l7U / 7, 1), num(c.l30U / 30, 1),
              c.trend == null ? "—" : <span key="t" className={c.trend >= 1 ? "text-emerald-700" : "text-rose-600"}>{c.trend >= 1 ? "+" : ""}{pct(c.trend - 1, 0)}</span>,
              num(c.f30), num(c.f60), num(c.f90),
              <Pill key="d" tone={doiTone(c.doi)}>{c.doi == null ? "—" : `${num(c.doi)} d`}</Pill>,
              num(c.onOrder), <b key="r">{num(c.reorderUnits)}</b>, c.stockoutSkus ? <span key="s" className="text-rose-600">{c.stockoutSkus}</span> : "0", num(c.excessUnits),
            ])} />
        </div>
      </Section>

      <Section className="mt-3" title={`Open-to-buy · ${nm ? fmtDate(nm, true).slice(2) : ""}`} tip="OTB = planned sales + planned closing stock − projected opening stock − on order arriving that month. ₹ at current ASP (retail)." pad={false}>
        <div className="px-4 pb-3">
          <MiniTable
            head={["Category", "Planned sales", "Source", "+ Closing stock", "− Opening stock", "− On order", "= OTB ₹", "≈ OTB units"]}
            rows={cats.map((c) => [
              catLabel(c.c), inr(c.otb.plannedSales), <span key="s" className="text-[11px] text-zinc-500">{c.otb.salesSource}</span>, inr(c.otb.plannedClosing), inr(c.otb.opening), inr(c.otb.onOrder),
              <b key="o" className={c.otb.otb < 0 ? "text-amber-700" : "text-brand-700"}>{inr(c.otb.otb)}</b>, c.otb.otbUnits == null ? "—" : num(Math.round(c.otb.otbUnits)),
            ])} />
          <p className="mt-2 text-[11px] text-zinc-500">Negative OTB = projected stock already covers next month&apos;s plan plus the target closing cover — hold buys or push sell-through (promotions, allocation to stronger stores).</p>
        </div>
      </Section>

      <div className="mt-3">
        <DataTable title={<span className="text-[12.5px] font-semibold">SKU plan · top {skuRows.length} by forecast rate</span>} rows={skuRows} columns={cols} rowHref="/products/{sku}" csvName="demand-plan" defaultSort={{ key: "reorder", desc: true }} height={560} searchKeys={["name", "sku", "l1", "category"]} />
      </div>

      <div className="mt-3">
        <HowBox items={[
          { k: "Free gifts", v: "Items sold under ₹10 per unit (e.g. socks) are gifts, not demand: their units are excluded from L7 / L30, and gift products are left out of forecast, reorder and OTB." },
          { k: "Forecast rate of sale", v: <>base = {pp.w} × L7 units/7 + {1 - pp.w} × L30 units/30, all channels (Stores = store SKU sales, Online / Marketplace = Unicommerce).</> },
          { k: "Trend factor", v: "trend = (L7/7) ÷ (L30/30), capped 0.8–1.25; half of it is carried forward so a hot week doesn't over-inflate: rate = base × (1 + (trend − 1)/2)." },
          { k: "Forecast 30 / 60 / 90", v: "rate × days. Flat projection — no seasonality unless a month target is set (used in OTB)." },
          { k: "Days of inventory (DOI)", v: `(store stock + warehouse stock) ÷ (L30 units ÷ 30) — always the last-30-day basis, like the rest of the tool; the weighted forecast rate is used only for forward numbers. Band ${pp.lo}–${pp.hi} days (editable above); < 14 days = stock-out risk; > 2× the band max = excess.` },
          { k: "Reorder suggestion", v: `max(0, rate × (lead time ${pp.lead}d + target cover ${tgt}d) − stock − open future inwards for that SKU group).` },
          { k: "Open-to-buy (next month)", v: "planned sales (Control Centre month target per channel where set, else forecast × channel share of L30 revenue) + planned closing stock (planned daily sales × target DOI) − projected opening stock (stock − forecast to month end + inwards due before the month) − future inwards due within the month. Valued at current category ASP." },
          { k: "On order", v: <>From <Link href={withQs(ctx, "/inwards")} className="text-brand-700 hover:underline">Future Inwards</Link> with status planned / PO confirmed / in transit. Category OTB uses all open inwards; SKU reorder only those tagged with a SKU group.</> },
          { k: "Caveats", v: "Store SKU sales are gross (line-level); Stores ₹ in OTB is DSR net. Inventory is live store report + Unicommerce warehouse (good stock only). No size-level or store-level allocation yet." },
        ]} />
      </div>
    </>
  );
}
