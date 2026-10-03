import Link from "next/link";
import { withQs, type Ctx } from "@/server/context";
import { getProductMap } from "@/server/data/products";
import { GIT_STAGES, GIT_STUCK_DAYS, gitStage } from "@/server/data/git";
import { gitOrEmpty } from "@/server/scope";
import { storeSkuRows } from "@/server/storeProducts";
import { catColor, catLabel } from "@/server/views";
import { Kpi, KpiGrid, Section, DataPrompt, Pill, MixBar } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { ChartDownload } from "@/components/charts/ChartDownload";
import { compactNum, inr, num, pct } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { safeDiv } from "@/lib/metrics";

const AGE = [{ k: "0–2 days", lo: 0, hi: 2 }, { k: "3–6 days", lo: 3, hi: 6 }, { k: "7–13 days", lo: 7, hi: 13 }, { k: "14–29 days", lo: 14, hi: 29 }, { k: "30+ days", lo: 30, hi: Infinity }];
const ageBucket = (d: number) => AGE.find((a) => d >= a.lo && d <= a.hi)!.k;

/**
 * Goods in transit (warehouse → stores): the full pipeline by status, ageing, store and product. This is the only view
 * that shows the pipeline status; every other page shows just the in-transit quantity.
 */
export async function GitTab({ ctx }: { ctx: Ctx }) {
  const pm = await getProductMap();
  const [git, ss] = await Promise.all([gitOrEmpty(new Set(pm.keys())), storeSkuRows(ctx).catch(() => [])]);
  const cats = new Set(ctx.filters.cats);
  const only = ctx.filters.stores.length ? new Set(ctx.filters.stores) : null;
  const lines = git.lines.filter((l) => cats.has(pm.get(l.sku)?.category ?? "") && (!only || only.has(l.b)));
  if (!lines.length) return <DataPrompt title="Nothing in transit for this selection">No long-tail stock is allocated to {only ? "the selected stores" : "stores"} in these categories right now{git.updated ? ` (table updated ${git.updated.slice(0, 16).replace("T", " ")})` : ""}.</DataPrompt>;

  const at = new Map(ss.map((r) => [`${r.b}|${r.sku}`, r]));
  const price = (sku: string) => pm.get(sku)?.sellingPrice ?? pm.get(sku)?.mrp ?? 0;
  const units = lines.reduce((a, l) => a + l.qty, 0), value = lines.reduce((a, l) => a + l.qty * price(l.sku), 0);
  const stores = new Set(lines.map((l) => l.b)), skus = new Set(lines.map((l) => l.sku));
  const stuck = lines.filter((l) => l.aging >= GIT_STUCK_DAYS), stuckU = stuck.reduce((a, l) => a + l.qty, 0);
  const avgAge = safeDiv(lines.reduce((a, l) => a + l.qty * l.aging, 0), units);
  const oldest = Math.max(...lines.map((l) => l.aging));

  // pipeline by status, ageing buckets, categories
  const stage = GIT_STAGES.map((s) => { const ls = lines.filter((l) => l.status === s.key); return { ...s, units: ls.reduce((a, l) => a + l.qty, 0), stores: new Set(ls.map((l) => l.b)).size, avgAge: safeDiv(ls.reduce((a, l) => a + l.qty * l.aging, 0), ls.reduce((a, l) => a + l.qty, 0)) }; });
  const other = lines.filter((l) => !gitStage(l.status)).reduce((a, l) => a + l.qty, 0);
  const ages = AGE.map((a) => { const ls = lines.filter((l) => l.aging >= a.lo && l.aging <= a.hi); return { bucket: a.k, units: ls.reduce((x, l) => x + l.qty, 0), lines: ls.length, stores: new Set(ls.map((l) => l.b)).size }; });
  const ageMax = Math.max(...ages.map((a) => a.units), 1);
  const byCat = ctx.filters.cats.map((c) => {
    const ls = lines.filter((l) => pm.get(l.sku)?.category === c);
    return { c, units: ls.reduce((a, l) => a + l.qty, 0), value: ls.reduce((a, l) => a + l.qty * price(l.sku), 0), stores: new Set(ls.map((l) => l.b)).size, skus: new Set(ls.map((l) => l.sku)).size, stuck: ls.filter((l) => l.aging >= GIT_STUCK_DAYS).reduce((a, l) => a + l.qty, 0), oldest: ls.length ? Math.max(...ls.map((l) => l.aging)) : 0 };
  }).filter((x) => x.units > 0);

  // store table
  const storeRows = [...stores].map((b) => {
    const ls = lines.filter((l) => l.b === b), st = ctx.byCode.get(b);
    const u = ls.reduce((a, l) => a + l.qty, 0);
    return {
      b, store: st?.short_name ?? ls[0].store, city: st?.city ?? null, units: u, value: ls.reduce((a, l) => a + l.qty * price(l.sku), 0), skus: new Set(ls.map((l) => l.sku)).size,
      oldest: Math.max(...ls.map((l) => l.aging)), avgAge: safeDiv(ls.reduce((a, l) => a + l.qty * l.aging, 0), u), stuck: ls.filter((l) => l.aging >= GIT_STUCK_DAYS).reduce((a, l) => a + l.qty, 0),
      ...Object.fromEntries(GIT_STAGES.map((s) => [s.key, ls.filter((l) => l.status === s.key).reduce((a, l) => a + l.qty, 0) || null])),
      storeStock: [...new Set(ls.map((l) => l.sku))].reduce((a, k) => a + (at.get(`${b}|${k}`)?.stock ?? 0), 0),
    };
  });
  const storeCols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 200 },
    { key: "units", label: "Units", type: "num", bar: true }, { key: "value", label: "Value", type: "inr", tip: "Units × selling price" }, { key: "skus", label: "Products", type: "num" },
    ...GIT_STAGES.map((s) => ({ key: s.key, label: s.short, type: "num" as const, group: "By status", tip: s.label })),
    { key: "avgAge", label: "Avg age (d)", type: "dec" }, { key: "oldest", label: "Oldest (d)", type: "num" }, { key: "stuck", label: `Stuck ≥${GIT_STUCK_DAYS}d`, type: "num", tip: `Units pending ${GIT_STUCK_DAYS} days or more` },
    { key: "storeStock", label: "Store stock", type: "num", tip: "Current store stock of the same products" },
  ];

  // line detail
  const detail = lines.map((l) => {
    const p = pm.get(l.sku), x = at.get(`${l.b}|${l.sku}`), st = ctx.byCode.get(l.b);
    return {
      id: `${l.b}|${l.item}|${l.status}|${l.inward}`, sku: l.sku, item: l.item, name: p?.name ?? l.sku, image: p?.image ?? null, catName: catLabel(p?.category ?? ""), store: st?.short_name ?? l.store, city: st?.city ?? null, b: l.b,
      qty: l.qty, status: gitStage(l.status)?.label ?? l.status, inward: l.inward, aging: l.aging, age: ageBucket(l.aging),
      storeStock: x?.stock ?? 0, l30: x?.l30Units ?? 0, cover: x && x.l30Units > 0 ? (x.stock + x.git) / (x.l30Units / 30) : null,
      flag: l.aging >= GIT_STUCK_DAYS ? "Stuck" : x && x.l30Units === 0 && x.stock >= 3 ? "Store not selling it" : null,
    };
  });
  const detailCols: Col[] = [
    { key: "name", label: "Product", image: "image", imageSize: 44, sub: "item", width: 260 }, { key: "catName", label: "Category", hidden: ctx.filters.cats.length === 1 },
    { key: "store", label: "Store", sub: "city", width: 180 }, { key: "qty", label: "Qty", type: "num" }, { key: "status", label: "Status", width: 190 },
    { key: "inward", label: "Allocated", type: "date", tip: "Date the stock was allocated to the store" }, { key: "aging", label: "Age (d)", type: "num" },
    { key: "storeStock", label: "Store stock", type: "num", group: "At this store" }, { key: "l30", label: "L30 units", type: "num", group: "At this store" }, { key: "cover", label: "Cover after", type: "num", group: "At this store", tip: "(Store stock + in transit) ÷ L30 daily units at this store" },
    { key: "flag", label: "Flag", width: 150 },
  ];
  // in transit to stores that already hold it and don't sell it: redirect candidates
  const redirect = detail.filter((d) => d.flag === "Store not selling it").sort((a, b) => b.qty * price(b.sku) - a.qty * price(a.sku));
  const redirectU = redirect.reduce((a, d) => a + d.qty, 0);

  return (
    <>
      <KpiGrid cols={6}>
        <Kpi label="Units in transit" value={compactNum(units)} sub={`≈${inr(value)} at selling price`} tip="All long-tail stock allocated to stores and not yet in their stock" />
        <Kpi label="Stores receiving" value={num(stores.size)} sub={`${num(skus.size)} products`} />
        <Kpi label="Average age" value={`${num(avgAge, 1)} days`} sub={`oldest ${oldest} days`} tone={avgAge != null && avgAge >= GIT_STUCK_DAYS ? "warn" : undefined} />
        <Kpi label={`Stuck ≥${GIT_STUCK_DAYS} days`} value={compactNum(stuckU)} sub={`${pct(safeDiv(stuckU, units), 0)} of units · ${num(new Set(stuck.map((l) => l.b)).size)} stores`} tone={stuckU ? "bad" : "good"} />
        <Kpi label="On the road" value={compactNum(stage.find((s) => s.key === "DELIVERY_PENDING")?.units ?? 0)} sub={`${compactNum(stage.find((s) => s.key === "INWARD_PENDING")?.units ?? 0)} delivered, not inwarded`} />
        <Kpi label="Redirect candidates" value={compactNum(redirectU)} sub="to stores holding it without selling" tone={redirectU ? "warn" : undefined} tip="In transit to a store that already has ≥3 units of the product and sold none in 30 days" />
      </KpiGrid>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.3fr_1fr]">
        <Section title="Pipeline by status" tip="Where in-transit stock sits right now, warehouse to store shelf"
          right={<ChartDownload name="git-pipeline-by-status" data={stage.map((s) => ({ status: s.label, units: s.units, stores: s.stores, avg_age: s.avgAge }))} columns={[{ key: "status", label: "Status" }, { key: "units", label: "Units" }, { key: "stores", label: "Stores" }, { key: "avg_age", label: "Avg age (days)" }]} />}>
          <MixBar barClass="h-4 rounded-md" labelMin={0.08} format="num" title="In transit by status" parts={stage.map((s) => ({ label: s.label, value: s.units, color: s.color }))} />
          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            {stage.map((s, i) => (
              <div key={s.key} className="card relative rounded-[14px] px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500"><span className="flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: s.color }}>{i + 1}</span>{s.short}</div>
                <div className="tabular mt-1 text-[18px] font-semibold">{compactNum(s.units)}</div>
                <div className="text-[11px] text-zinc-500">{num(s.stores)} stores · {num(s.avgAge, 1)}d avg</div>
              </div>
            ))}
          </div>
          {other > 0 && <div className="mt-2 text-[11px] text-zinc-500">{num(other)} units carry another status.</div>}
        </Section>
        <Section title="Ageing" tip="Days since the stock was allocated to the store (AGING)" right={<ChartDownload name="git-ageing" data={ages} columns={[{ key: "bucket", label: "Age" }, { key: "units", label: "Units" }, { key: "lines", label: "Lines" }, { key: "stores", label: "Stores" }]} />}>
          <div className="space-y-2.5">{ages.map((a, i) => (
            <div key={a.bucket} className="grid grid-cols-[84px_1fr_64px] items-center gap-3 text-[12px]">
              <span className="text-zinc-600">{a.bucket}</span>
              <span className="h-5 overflow-hidden rounded-md bg-zinc-100 shadow-[inset_0_1px_2px_rgba(60,40,20,.1)]"><span className="block h-full rounded-md" style={{ width: `${(a.units / ageMax) * 100}%`, background: i >= 2 ? `linear-gradient(90deg, #f59e0b, ${i >= 3 ? "#dc2626" : "#d97706"})` : "linear-gradient(90deg, #d3b089, #a8703f)" }} /></span>
              <span className="tabular text-right"><b className="font-semibold">{compactNum(a.units)}</b> <span className="text-[11px] text-zinc-400">{num(a.stores)} st</span></span>
            </div>
          ))}</div>
        </Section>
      </div>

      <div className="mt-3">
        <Section title="By category" pad={false} right={<ChartDownload name="git-by-category" data={byCat.map((x) => ({ category: catLabel(x.c), units: x.units, value: x.value, stores: x.stores, products: x.skus, stuck: x.stuck, oldest: x.oldest }))} />}>
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Category", "Units", "Value", "Stores", "Products", `Stuck ≥${GIT_STUCK_DAYS}d`, "Oldest"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>{byCat.map((x) => (
              <tr key={x.c} className="border-b border-brand-50 last:border-0">
                <td className="px-4 py-2"><span className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full" style={{ background: catColor(x.c) }} />{catLabel(x.c)}</span></td>
                <td className="tabular px-4 text-right font-semibold">{num(x.units)}</td><td className="tabular px-4 text-right">{inr(x.value)}</td>
                <td className="tabular px-4 text-right">{num(x.stores)}</td><td className="tabular px-4 text-right">{num(x.skus)}</td>
                <td className="px-4 text-right">{x.stuck ? <Pill tone="bad">{num(x.stuck)}</Pill> : <span className="text-zinc-300">—</span>}</td>
                <td className="tabular px-4 text-right">{x.oldest} d</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      </div>

      <div className="mt-3">
        <DataTable title="Stores receiving stock" rows={storeRows as unknown as Record<string, unknown>[]} columns={storeCols} rowHref="/stores/{b}" defaultSort={{ key: "units" }} csvName="git-by-store" height={420}
          searchKeys={["store", "city"]} totals={{ store: "Total", units, value, skus: skus.size, stuck: stuckU, ...Object.fromEntries(stage.map((s) => [s.key, s.units])) }} />
      </div>
      <div className="mt-3">
        <DataTable title="In-transit lines" rows={detail as unknown as Record<string, unknown>[]} columns={detailCols} rowHref="/products/{sku}" defaultSort={{ key: "aging" }} csvName="goods-in-transit" height={620} dense={false}
          urlState facets={[{ key: "store", label: "Store" }, ...(ctx.filters.cats.length > 1 ? [{ key: "catName", label: "Category" }] : []), { key: "status", label: "Status" }, { key: "age", label: "Age" }, { key: "flag", label: "Flag" }]}
          searchKeys={["name", "sku", "item", "store", "city"]} searchPlaceholder="Search product, SKU or store" />
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        Warehouse → store allocations not yet in store stock{git.updated ? `, updated ${fmtDate(git.updated.slice(0, 10), true)} ${git.updated.slice(11, 16)}` : ""}. Status order: {GIT_STAGES.map((s) => s.short).join(" → ")}.
        Elsewhere in the tool these units appear as “In transit”, the third inventory phase next to Stores and Warehouse; store actions and allocations net them off. <Link href={withQs(ctx, "/actions", { group: "merchandising" })} className="font-medium text-brand-700 hover:underline">Stuck-in-transit actions →</Link>
      </p>
    </>
  );
}
