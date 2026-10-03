"use client";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { compactNum, inr, num, pct } from "@/lib/format";
import { Pill, Tip, achTone } from "@/components/ui";
import { InvMix } from "@/components/InvMix";
import { ChartDownload } from "@/components/charts/ChartDownload";
import type { CvRow, CvTable, CvView } from "@/server/categoryView";

export interface CvVisibility { revenue: boolean; gp: boolean; stores: boolean; online: boolean; marketplace: boolean; qcom: boolean }
const LABEL: Record<CvView, string> = { overall: "Overall", stores: "Stores", online: "Online · normal", omni: "Omni", qcom: "Qcom", marketplace: "Marketplace" };
const INV_TIP: Record<CvView, string> = {
  overall: "Stores + in transit + warehouse, now", stores: "Store stock (latest store report)", online: "Warehouse stock (serves Online and Marketplace)",
  marketplace: "Warehouse stock (serves Online and Marketplace)", omni: "Store stock (Omni orders ship from stores)", qcom: "Qcom stock isn't in the current data",
};

/** Category view: Overall, then Stores / Online / Marketplace / Qcom. Columns honour the viewer's access. */
export function CategoryViews({ tables, grouping, vis, period, qs, catHref = true }: {
  tables: Record<CvView, CvTable>; grouping: "category" | "type"; vis: CvVisibility; period: string; qs: string; catHref?: boolean;
}) {
  const channelViews = (["stores", "online", "omni", "qcom", "marketplace"] as CvView[]).filter((v) => (v === "omni" ? vis.online : vis[v as "stores"]));
  const [v, setV] = useState<CvView>(channelViews[0] ?? "overall");
  const showOverall = vis.stores && vis.online && vis.marketplace;
  return (
    <div className="space-y-3">
      {showOverall && <CvTableView t={tables.overall} grouping={grouping} vis={vis} period={period} qs={qs} catHref={catHref} />}
      {channelViews.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">By channel</span>
            <div className="card flex gap-0.5 rounded-[12px] p-1">
              {channelViews.map((k) => <button key={k} onClick={() => setV(k)} className={cn("rounded-[9px] px-3 py-1 text-[12px] transition-all", v === k ? "bg-brand-900 font-medium text-canvas" : "text-zinc-600 hover:bg-brand-50")}>{LABEL[k]}</button>)}
            </div>
          </div>
          <CvTableView t={tables[v]} grouping={grouping} vis={vis} period={period} qs={qs} catHref={catHref} />
        </div>
      )}
    </div>
  );
}

function CvTableView({ t, grouping, vis, period, qs, catHref }: { t: CvTable; grouping: "category" | "type"; vis: CvVisibility; period: string; qs: string; catHref: boolean }) {
  const hasT = t.rows.some((r) => r.target != null);
  const cols: { k: string; h: string; tip?: string; show: boolean; cell: (r: CvRow, total: boolean) => React.ReactNode }[] = [
    { k: "inv", h: "Current inv", tip: INV_TIP[t.view], show: t.view !== "qcom", cell: (r) => r.inv == null ? "—" : <span className="inline-flex items-center justify-end gap-2">{t.view === "overall" && <InvMix className="w-16" store={r.invStore} git={r.invGit} wh={r.invWh} title={`${r.label} · inventory`} />}{compactNum(r.inv)}</span> },
    { k: "units", h: "Qty sold", tip: `Units sold, ${period} (free gifts excluded)`, show: true, cell: (r) => num(r.units) },
    { k: "rev", h: "Revenue", tip: `Gross sales, ${period}`, show: vis.revenue, cell: (r) => <b className="font-semibold">{inr(r.revenue)}</b> },
    { k: "disc", h: "Discount", tip: "1 − revenue ÷ MRP value sold", show: true, cell: (r) => pct(r.disc, 1) },
    { k: "gp", h: "GP %", tip: "Gross profit: (revenue ÷ 1.18 − COGS) ÷ (revenue ÷ 1.18); COGS = units × unit cost", show: vis.gp, cell: (r) => r.gp == null ? "—" : <span className={cn(r.gp < 0.4 ? "text-rose-600" : r.gp >= 0.6 ? "text-emerald-700" : "")}>{pct(r.gp, 1)}</span> },
    { k: "doi", h: "DOI · 30D", tip: "Current inventory ÷ last-30-day daily units (this channel)", show: t.view !== "qcom", cell: (r) => r.doi == null ? "—" : <Pill tone={r.doi < 21 ? "bad" : r.doi > 180 ? "warn" : "good"}>{num(r.doi)} d</Pill> },
    { k: "str", h: "STR", tip: "Units sold ÷ (units sold + current inventory)", show: t.view !== "qcom", cell: (r) => pct(r.str, 0) },
    { k: "inw", h: "Inward L30", tip: "New inwards (putaway) in the last 30 days", show: t.view !== "qcom" && t.view !== "stores" && t.view !== "omni", cell: (r) => r.inward30 ? num(r.inward30) : <span className="text-zinc-300">—</span> },
    { k: "git", h: "In transit", tip: "Goods allocated to stores, not yet in store stock", show: t.view === "stores", cell: (r) => r.invGit ? num(r.invGit) : <span className="text-zinc-300">—</span> },
    { k: "ret", h: "Returns %", tip: "Units returned ÷ units sold, last 30 days (this channel)", show: true, cell: (r) => pct(r.returnsPct, 1) },
    { k: "asp", h: "ASP", tip: "Revenue ÷ units", show: vis.revenue, cell: (r) => inr(r.asp, { compact: false }) },
    { k: "tgt", h: "Target", tip: `Phased target for ${period}`, show: hasT && vis.revenue, cell: (r) => r.target == null ? <span className="text-zinc-300">—</span> : inr(r.target) },
    { k: "ach", h: "Achievement", tip: "Revenue on target days ÷ phased target", show: hasT, cell: (r) => r.ach == null ? <span className="text-zinc-300">—</span> : <Pill tone={achTone(r.ach)}>{pct(r.ach, 0)}</Pill> },
    { k: "proj", h: "Projection", tip: "Month-end projection (MTD pace × month target where set)", show: hasT && vis.revenue, cell: (r) => r.projection == null ? "—" : <>{inr(r.projection)}{r.projAch != null && <span className="ml-1 text-[11px] text-zinc-400">{pct(r.projAch, 0)}</span>}</> },
    { k: "share", h: "Share", tip: "Share of revenue in this view", show: true, cell: (r) => pct(r.share, 0) },
  ];
  const shown = cols.filter((c) => c.show);
  const first = grouping === "category" ? "Category" : "Product type";
  const href = (r: CvRow) => (grouping === "category" ? `/category?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), cat: r.key }).toString()}` : `/category?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), tab: "products", l1: r.key }).toString()}`);
  const dl = t.rows.map((r) => ({ group: r.label, inventory: r.inv, store: r.invStore, in_transit: r.invGit, warehouse: r.invWh, units: r.units, ...(vis.revenue ? { revenue: r.revenue, asp: r.asp, target: r.target, projection: r.projection } : {}), discount: r.disc, ...(vis.gp ? { gp: r.gp } : {}), doi: r.doi, str: r.str, inward_l30: r.inward30, returns_pct: r.returnsPct, achievement: r.ach, share: r.share }));
  return (
    <section className="card rounded-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2.5 pt-3.5">
        <h2 className="flex items-center gap-2 font-serif text-[15.5px] leading-tight text-ink"><span className="ornament" />{LABEL[t.view]} · by {first.toLowerCase()} <span className="font-sans text-[11.5px] text-zinc-500">{period}{t.view !== "qcom" ? " · DOI on last 30 days" : ""}</span></h2>
        <ChartDownload name={`category-view-${t.view}`} data={dl} />
      </div>
      <div className="gold-rule mx-4" />
      {t.note && <div className="mx-4 mt-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11.5px] text-brand-900">{t.note}.</div>}
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full whitespace-nowrap text-[12.5px]">
          <thead><tr className="border-b border-line text-[11px] text-zinc-500">
            <th className="px-4 py-2 text-left font-medium">{first}</th>
            {shown.map((c) => <th key={c.k} className="px-3 py-2 text-right font-medium"><span className="inline-flex items-center gap-1">{c.h}{c.tip && <Tip text={c.tip} />}</span></th>)}
          </tr></thead>
          <tbody>{t.rows.map((r) => (
            <tr key={r.key} className="border-b border-brand-50 last:border-0 hover:bg-brand-50/40">
              <td className="px-4 py-2">{catHref ? <Link href={href(r)} className="flex items-center gap-2 font-medium hover:underline">{r.color && <span className="size-2 rounded-full" style={{ background: r.color }} />}{r.label}</Link> : <span className="font-medium">{r.label}</span>}</td>
              {shown.map((c) => <td key={c.k} className="tabular px-3 text-right">{c.cell(r, false)}</td>)}
            </tr>
          ))}</tbody>
          {t.rows.length > 1 && <tfoot><tr className="border-t border-brand-200 bg-gradient-to-b from-[#f7efe4] to-[#f1e6d6] font-semibold text-brand-900">
            <td className="px-4 py-2">Total</td>{shown.map((c) => <td key={c.k} className="tabular px-3 text-right">{c.cell(t.total, true)}</td>)}
          </tr></tfoot>}
        </table>
        {!t.rows.length && <div className="px-4 py-8 text-center text-[12.5px] text-zinc-500">No sales or stock in this view for the selection.</div>}
      </div>
    </section>
  );
}
