import type { Ctx } from "@/server/context";
import type { StoreModel } from "@/server/storeInsights";
import { catLabel } from "@/server/views";
import { DataTable, type Col } from "@/components/table/DataTable";
import { Notice } from "@/components/ui";
import { ltLabel, ctLabel, TODO_LABEL } from "./parts";
import { safeDiv } from "@/lib/metrics";

export function StoresTab({ ctx, model }: { ctx: Ctx; model: StoreModel }) {
  const nCats = ctx.filters.cats.length;
  const one = ctx.filters.cat;
  const rows = model.stores.map((s) => {
    const t = s.todos[0];
    return {
      b: s.b, store: s.store, city: s.city, state: s.state, region: s.region, lt: ltLabel(s.lt), ct: ctLabel(s.ct), status: s.status, am: s.am, area: s.area,
      live: `${s.liveCats.length}/${nCats}`, liveN: s.liveCats.length, notLive: s.notLiveCats.map(catLabel).join(", ") || "—",
      revenue: s.sales, growth: s.growth, perDay: s.perDay, unitsPerDay: s.unitsPerDay, billsPerDay: s.billsPerDay, atv: s.atv, upt: s.upt, asp: s.asp, disc: s.disc,
      target: s.target, ach: s.ach, tstatus: s.tstatus, gap: s.gap, monthTarget: s.monthTarget, projected: s.projected, projAch: s.projAch, reqPerDay: s.reqPerDay, curPerDay: s.curPerDay,
      nonLiveTarget: s.nonLiveTarget || null, pen: s.pen, inv: s.inFeed ? s.inv : null, cover: s.cover, storeUnits: s.inFeed ? s.storeUnits30 : null,
      stockOuts: s.stockOuts.length, dead: s.dead.length, todo: t && t.kind !== "ok" ? `${TODO_LABEL[t.kind]}: ${t.text}` : "—",
      l7: s.l7, wow: safeDiv(s.l7 - s.p7, s.p7),
    };
  });
  const cols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 210 },
    { key: "state", label: "State", hidden: true }, { key: "region", label: "Region", hidden: true },
    { key: "lt", label: "Format", tip: "Location type: High street (HS) or Mall" }, { key: "ct", label: "City type" },
    ...(one ? [] : [{ key: "live", label: "Live cats", tip: "In-scope categories live in the store: stock on the latest store report or a sale in the last 60 days" } as Col, { key: "notLive", label: "Not live", hidden: true } as Col]),
    { key: "revenue", label: "Revenue", type: "inr", bar: true }, { key: "growth", label: "Growth", type: "delta" },
    { key: "perDay", label: "Sales / day", type: "inr" }, { key: "unitsPerDay", label: "Units / day", type: "dec" },
    { key: "billsPerDay", label: "Bills / day", type: "dec", tip: "Perfumes + Shoes bills (only DSR categories report bills)" },
    { key: "atv", label: "ATV", type: "inrFull", tip: "Perfumes + Shoes sales ÷ their bills" }, { key: "upt", label: "UPT", type: "dec", tip: "Perfumes + Shoes units per bill" },
    { key: "asp", label: "ASP", type: "inrFull", hidden: true }, { key: "disc", label: "Discount", type: "pct", hidden: true },
    { key: "target", label: "Target", type: "inr", tip: "Period target on live categories only", hidden: true }, { key: "ach", label: "Achievement", type: "ach", tip: "Live categories only" },
    { key: "gap", label: "Gap", type: "inr", hidden: true },
    { key: "projAch", label: "Proj. month", type: "ach", tip: "MTD achievement × month target (live categories)" }, { key: "reqPerDay", label: "Need / day", type: "inr", tip: "Remaining month target ÷ remaining days" },
    { key: "curPerDay", label: "MTD / day", type: "inr", hidden: true }, { key: "monthTarget", label: "Month target", type: "inr", hidden: true }, { key: "projected", label: "Projection", type: "inr", hidden: true },
    { key: "nonLiveTarget", label: "Target not live", type: "inr", tip: "Month target on categories that are not live in this store — excluded from achievement", hidden: !!one },
    { key: "pen", label: "LT penetration", type: "pct", tip: "In-scope L30 units ÷ store's total L30 units across all categories (store report)" },
    { key: "inv", label: "Store stock", type: "num" }, { key: "cover", label: "Cover (days)", type: "num", tip: "Store stock ÷ L30 daily units" },
    { key: "stockOuts", label: "Stock-outs", type: "num", tip: "Live categories with 0 units in store" }, { key: "dead", label: "Dead stock", type: "num", tip: "Categories with ≥10 units and no sale in 30 days", hidden: true },
    { key: "storeUnits", label: "Store units L30", type: "num", tip: "All categories incl. apparel — store size proxy", hidden: true }, { key: "area", label: "Carpet area", type: "num", hidden: true },
    { key: "l7", label: "L7 revenue", type: "inr", hidden: true }, { key: "wow", label: "L7 vs prior 7", type: "delta", hidden: true },
    { key: "todo", label: "Top to-do", width: 280 },
    { key: "am", label: "AM", hidden: true }, { key: "status", label: "Status", hidden: true },
  ];
  const liveRows = rows.filter((r) => r.liveN > 0);
  const notLiveRows = rows.filter((r) => r.liveN === 0);
  const sumT = (ss: typeof model.stores) => {
    const t = ss.reduce((a, s) => ({ s: a.s + s.sales, p: a.p + s.prev, t: a.t + (s.target ?? 0), ts: a.ts + (s.target ? (s.ach ?? 0) * s.target : 0), m: a.m + (s.monthTarget ?? 0), pj: a.pj + (s.monthTarget ? s.projected : 0) }), { s: 0, p: 0, t: 0, ts: 0, m: 0, pj: 0 });
    return { store: "Total", revenue: t.s, growth: safeDiv(t.s - t.p, t.p), target: t.t || null, ach: safeDiv(t.ts, t.t), gap: t.t ? t.t - t.ts : null, monthTarget: t.m || null, projAch: safeDiv(t.pj, t.m) };
  };
  const liveSet = new Set(liveRows.map((r) => r.b));
  return (
    <>
      <Notice>Achievement, projection and ranking count only <b>live</b> store × category cells (stock on the latest store report or a sale in the last 60 days). Click a store for its category mix, inventory and products.</Notice>
      <DataTable title={one ? `Stores where ${catLabel(one)} is live` : "Stores with a live long-tail category"} rows={liveRows} columns={cols} rowHref="/stores/{b}" defaultSort={{ key: "revenue" }}
        csvName={`stores-${ctx.period.range.from}-${ctx.period.range.to}`} searchKeys={["store", "city", "state", "region", "b", "lt", "ct", "am"]} height={640}
        totals={sumT(model.stores.filter((s) => liveSet.has(s.b)))} />
      {notLiveRows.length > 0 && (
        <div className="mt-3">
          <DataTable title={one ? `Stores where ${catLabel(one)} is not live · ${notLiveRows.length}` : `Stores with no live long-tail category · ${notLiveRows.length}`} rows={notLiveRows}
            columns={[{ key: "store", label: "Store", sub: "city", width: 210 }, { key: "state", label: "State" }, { key: "lt", label: "Format" }, { key: "ct", label: "City type" },
              { key: "storeUnits", label: "Store units L30", type: "num", tip: "All categories — store size proxy" }, { key: "area", label: "Carpet area", type: "num" },
              { key: "nonLiveTarget", label: "Target set", type: "inr", tip: "Month target on a category that isn't live" }, { key: "revenue", label: "Revenue", type: "inr" }]}
            rowHref="/stores/{b}" defaultSort={{ key: "revenue" }} csvName="stores-not-live" height={320}
            totals={{ store: "Total", revenue: notLiveRows.reduce((a, r) => a + r.revenue, 0), nonLiveTarget: notLiveRows.reduce((a, r) => a + (r.nonLiveTarget ?? 0), 0) || null }} />
          <p className="mt-1.5 text-[11.5px] text-zinc-500">No stock on the latest store report and no sale in 60 days. See Distribution &amp; expansion for which of these to launch first.</p>
        </div>
      )}
    </>
  );
}
