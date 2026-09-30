import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { loadScope } from "@/server/scope";
import { productRows, rollup, DEF } from "@/server/productInsights";
import { catLabel } from "@/server/views";
import { PageHeader, Kpi, KpiGrid, DataPrompt } from "@/components/ui";
import { ProductGrid, type GridRow } from "@/components/products/ProductGrid";
import { DataTable, type Col } from "@/components/table/DataTable";
import { compactNum, inr, num, pct } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "Product Master" };

/** Product Master: every product in scope with image, identity, metafields, lifetime performance and live inventory. */
export default async function ProductMaster({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const view = ctx.sp.view === "table" ? "table" : "cards";
  const sc = await loadScope(ctx);
  const rows = await productRows(ctx, sc, { master: true, withPeriod: false });
  const multiCat = ctx.filters.cats.length > 1;
  const agg = rollup(rows);
  const noImage = rows.filter((r) => !r.image), noMeta = rows.filter((r) => !r.hasMeta);
  const noColour = rows.filter((r) => !r.colour);
  const admin = ctx.user?.role === "admin";
  const catsNoMeta = [...new Set(noMeta.map((r) => r.catName))].sort();
  const facets = [
    ...(multiCat ? [{ key: "catName", label: "Category" }] : []),
    { key: "l1", label: "Type" }, { key: "l2", label: "Sub-type" }, { key: "colour", label: "Colour" }, { key: "collection", label: "Collection" }, { key: "lifecycle", label: "Lifecycle" }, { key: "flag", label: "Flag" },
  ];
  const title = ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories";
  const pm = sc.pm;
  const grid: GridRow[] = rows.map((r) => {
    const p = pm.get(r.sku);
    const attrs = p ? Object.entries(p.attrs).filter(([k, v]) => v && k !== "colour" && k !== "shape" && k !== "material").map(([, v]) => v).slice(0, 3) : [];
    return {
      sku: r.sku, name: r.name, image: r.image, catName: r.catName, l1: r.l1, l2: r.l2, colour: r.colour, collection: r.collection, lifecycle: r.lifecycle, mrp: r.mrp, search: r.search, attrs,
      ltSales: r.ltSales, ltUnits: r.ltUnits, inward: r.inward, ltStr: r.ltStr, returnPct: r.returnPct, split: r.split, l30: r.l30, mom: r.mom, l30Units: r.l30Units, str30: r.str30,
      storeInv: r.storeInv, storesStocked: r.storesStocked, whInv: r.whInv, whSouth: r.whSouth, whNorth: r.whNorth, doi: r.doi, daysLive: r.daysLive, flag: r.flag,
    };
  });
  const viewHref = (v: string | null) => withQs(ctx, "/products", { view: v });
  const detailQs = new URLSearchParams(ctx.qs);
  for (const k of ["view", "q", "sort", ...facets.map((f) => f.key)]) detailQs.delete(k);

  return (
    <>
      <PageHeader title="Product Master" subtitle={<>{title} · {num(rows.length)} products · lifetime performance and live inventory <span className="text-zinc-400">· sales to {fmtDate(ctx.asOf, true)}</span></>}
        right={<div className="flex rounded-lg border border-line bg-white p-0.5 text-[12px]">
          {(["cards", "table"] as const).map((v) => <Link key={v} href={viewHref(v === "cards" ? null : v)} scroll={false} className={cn("rounded-md px-3 py-1", view === v ? "bg-brand-700 font-medium text-white" : "text-zinc-600 hover:bg-brand-50")}>{v === "cards" ? "Cards" : "Table"}</Link>)}
        </div>} />
      <KpiGrid cols={7}>
        <Kpi label="Products" value={num(agg.products)} sub={`${num(rows.filter((r) => r.l30Units > 0).length)} sold in L30`} />
        <Kpi label="Lifetime sales" value={inr(agg.ltSales)} sub="all channels" tip="Product Master (LONG_TAIL_MASTER_BIBLE), to date" />
        <Kpi label="L30 sales" value={inr(agg.l30)} delta={agg.p30 ? agg.l30 / agg.p30 - 1 : null} deltaLabel="vs prior 30" tip={`${DEF.l30}`} />
        <Kpi label="Lifetime STR" value={pct(agg.ltStr, 0)} sub={`L30 STR ${pct(agg.str30, 0)}`} tip={`${DEF.ltStr}. ${DEF.str30}`} />
        <Kpi label="Store stock" value={compactNum(agg.storeInv)} tip={DEF.storeInv} />
        <Kpi label="Warehouse stock" value={compactNum(agg.whInv)} sub={`South ${compactNum(agg.whSouth)} · North ${compactNum(agg.whNorth)}`} tip={DEF.wh} />
        <Kpi label="Days of cover" value={agg.doi != null ? num(agg.doi) : "—"} sub={`${num(agg.lowCover)} products < 21 days`} tone={agg.doi == null ? undefined : agg.doi < 30 ? "bad" : agg.doi > 180 ? "warn" : "good"} tip={DEF.doi} />
      </KpiGrid>
      {(noImage.length > 0 || catsNoMeta.length > 0 || noColour.length > rows.length * 0.2) && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {catsNoMeta.length > 0 && <DataPrompt compact title={`${num(noMeta.length)} products have no metafields (type / attributes)`} href={admin ? "/settings?tab=attributes" : undefined} cta="Add attributes">
            Mostly {catsNoMeta.slice(0, 4).join(", ")}. Search and filters by type, colour and other attributes only work where metafields exist.{!admin && " Ask an admin to upload them in the Control Centre."}
          </DataPrompt>}
          {noImage.length > 0 && <DataPrompt compact title={`${num(noImage.length)} products have no image`} href={admin ? "/settings?tab=attributes" : undefined} cta="Fix images">
            e.g. {noImage.slice(0, 4).map((r) => r.sku).join(", ")}.{!admin && " Ask an admin to add image links."}
          </DataPrompt>}
          {noColour.length > rows.length * 0.2 && catsNoMeta.length === 0 && <DataPrompt compact title={`${num(noColour.length)} products have no colour`} href={admin ? "/settings?tab=attributes" : undefined} cta="Add colours">The colour filter and colour search skip these products.</DataPrompt>}
        </div>
      )}
      <div className="mt-3">
        {view === "cards" ? <ProductGrid rows={grid} facets={facets} qs={detailQs.toString()} defs={DEF} /> : (
          <DataTable rows={rows as unknown as Record<string, unknown>[]} columns={masterCols(multiCat)} defaultSort={{ key: "ltSales" }} rowHref="/products/{sku}" csvName="product-master" height={760} dense={false}
            searchText="search" facets={facets} urlState searchPlaceholder='Search e.g. "black sneakers"' />
        )}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Lifetime sales, units, inward qty and return %: Product Master (daily). Store stock: latest store report. Warehouse: Unicommerce live inventory. L30: store sales lines + Unicommerce items incl. cancellations, all channels{ctx.filters.channel !== "all" ? " (L30 shown for the selected channel)" : ""}.</p>
    </>
  );
}

function masterCols(multiCat: boolean): Col[] {
  return [
    { key: "name", label: "Product", image: "image", imageSize: 44, sub: "sku", width: 280 },
    { key: "catName", label: "Category", hidden: !multiCat }, { key: "l1", label: "Type" }, { key: "l2", label: "Sub-type" }, { key: "colour", label: "Colour" },
    { key: "collection", label: "Collection", hidden: true }, { key: "lifecycle", label: "Lifecycle", hidden: true }, { key: "mrp", label: "MRP", type: "inrFull" },
    { key: "ltSales", label: "Sales", type: "inr", bar: true, group: "Lifetime", tip: "Lifetime sales, all channels (Product Master)" },
    { key: "ltUnits", label: "Units", type: "num", group: "Lifetime" }, { key: "inward", label: "Inward qty", type: "num", group: "Lifetime", tip: DEF.inward },
    { key: "ltStr", label: "STR", type: "pct", group: "Lifetime", tip: DEF.ltStr }, { key: "returnPct", label: "Return %", type: "pct", group: "Lifetime", tip: DEF.ret },
    { key: "split", label: "Channel mix", type: "split", group: "Lifetime", tip: "Lifetime share: Stores · Online · Marketplace" },
    { key: "l30", label: "Sales", type: "inr", group: "Last 30 days", tip: DEF.l30 }, { key: "mom", label: "vs P30", type: "delta", group: "Last 30 days", tip: DEF.mom },
    { key: "l30Units", label: "Units", type: "num", group: "Last 30 days" }, { key: "str30", label: "STR", type: "pct", group: "Last 30 days", tip: DEF.str30 },
    { key: "storeInv", label: "Stores", type: "num", group: "Inventory", tip: DEF.storeInv }, { key: "storesStocked", label: "# stores", type: "num", group: "Inventory" },
    { key: "whSouth", label: "WH South", type: "num", group: "Inventory", tip: DEF.wh }, { key: "whNorth", label: "WH North", type: "num", group: "Inventory", tip: DEF.wh },
    { key: "totalInv", label: "Total", type: "num", group: "Inventory" }, { key: "doi", label: "Cover (days)", type: "num", group: "Inventory", tip: DEF.doi },
    { key: "flag", label: "Flag", tip: "Free gift = recent ASP under ₹10; Low cover = ≥10 units L30 and under 21 days of cover; Slow = ≥30 units and over 180 days of cover" },
    { key: "liveDate", label: "Live", type: "date", hidden: true }, { key: "lastInward", label: "Last inward", type: "date", hidden: true },
  ];
}
