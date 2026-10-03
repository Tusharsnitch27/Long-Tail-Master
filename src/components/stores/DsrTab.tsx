import Link from "next/link";
import { withQs, type Ctx } from "@/server/context";
import type { Fact } from "@/server/data/facts";
import type { StoreModel, Todo } from "@/server/storeInsights";
import { catLabel } from "@/server/views";
import { Kpi, KpiGrid, Section, achTone } from "@/components/ui";
import { DataTable, type Col } from "@/components/table/DataTable";
import { TODO_LABEL, ltLabel } from "./parts";
import { inr, num, pct } from "@/lib/format";
import { fmtDate, fmtRange, weekday } from "@/lib/dates";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";
import { cn } from "@/lib/cn";

const BOARD: Todo["kind"][] = ["stockout", "pace", "lowcover", "wow", "dead", "nonlive", "underpen"];
const BOARD_HINT: Record<string, string> = {
  stockout: "Live category at 0 units — raise a transfer / replenishment today",
  pace: "Required run rate >25% above current — push top sellers, staff briefing",
  lowcover: "<14 days of cover on a selling category — replenish before it stocks out",
  wow: "Last 7 days down >25% vs prior 7 — check availability, staff, VM",
  dead: "≥10 units, no sale in 30 days — move to a selling store or re-merchandise",
  nonlive: "Target set on a category that isn't live — launch or reallocate",
  underpen: "Category share of store units under half of format peers — fix placement / depth",
};

export function DsrTab({ ctx, facts, model }: { ctx: Ctx; facts: Fact[]; model: StoreModel }) {
  const th = ctx.settings.thresholds;
  const S = model.stores;
  const W = model.windows;
  const t = S.reduce((a, s) => ({ y: a.y + s.y, lw: a.lw + s.lw, l7: a.l7 + s.l7, p7: a.p7 + s.p7, wtd: a.wtd + s.wtd, pwtd: a.pwtd + s.pwtd, mtd: a.mtd + s.mtd, lm: a.lm + s.lm,
    mtdT: a.mtdT + (s.mtdTarget ?? 0), mtdS: a.mtdS + (s.mtdTarget ? s.mtd : 0), monT: a.monT + (s.monthTarget ?? 0), yT: a.yT + (s.yTarget ?? 0), yS: a.yS + (s.yTarget ? s.y : 0),
    inv: a.inv + s.inv, s30: a.s30 + s.s30 }),
    { y: 0, lw: 0, l7: 0, p7: 0, wtd: 0, pwtd: 0, mtd: 0, lm: 0, mtdT: 0, mtdS: 0, monT: 0, yT: 0, yS: 0, inv: 0, s30: 0 });
  // MTD for DSR includes all cells; "mtd" in the model is live cells (non-live cells cannot have recent sales)
  const live = S.filter((s) => s.liveCats.length);
  const sellingY = S.filter((s) => s.y > 0).length;
  const req = model.remainingDays > 0 && t.monT ? Math.max(t.monT - t.mtdS, 0) / model.remainingDays : null;

  const rows = S.filter((s) => s.liveCats.length || s.sales).map((s) => {
    const top = s.todos.filter((x) => x.kind !== "ok");
    return {
      b: s.b, store: s.store, city: s.city, lt: ltLabel(s.lt), y: s.y, yAch: safeDiv(s.yTarget ? s.y : null, s.yTarget), lw: s.lw, dLw: growth(s.y, s.lw),
      l7: s.l7, wow: growth(s.l7, s.p7), wtd: s.wtd, dWtd: growth(s.wtd, s.pwtd), mtd: s.mtd, dLm: growth(s.mtd, s.lm), mtdAch: safeDiv(s.mtd, s.mtdTarget), mtdTarget: s.mtdTarget,
      projAch: s.projAch, req: s.reqPerDay, cur: s.curPerDay, inv: s.inFeed ? s.inv : null, cover: s.cover, stockOuts: s.stockOuts.map(catLabel).join(", ") || null,
      todo: top.length ? top.slice(0, 2).map((x) => `${TODO_LABEL[x.kind]}: ${x.text}`).join(" | ") : "—", todos: top.length,
    };
  });
  const cols: Col[] = [
    { key: "store", label: "Store", sub: "city", width: 200 },
    { key: "y", label: fmtDate(ctx.asOf), type: "inr", group: "Day", tip: "Last complete day" }, { key: "dLw", label: "vs LW", type: "delta", group: "Day", tip: `vs ${weekday(ctx.asOf)} last week` }, { key: "yAch", label: "Ach.", type: "ach", group: "Day" },
    { key: "wtd", label: "WTD", type: "inr", group: "Week", hidden: true }, { key: "dWtd", label: "vs LW", type: "delta", group: "Week", hidden: true },
    { key: "l7", label: "L7", type: "inr", group: "Week", bar: true }, { key: "wow", label: "vs P7", type: "delta", group: "Week", tip: "Last 7 days vs prior 7" },
    { key: "mtd", label: "MTD", type: "inr", group: "Month" }, { key: "dLm", label: "vs LM", type: "delta", group: "Month", tip: "vs same days last month" },
    { key: "mtdAch", label: "Ach.", type: "ach", group: "Month" }, { key: "projAch", label: "Proj.", type: "ach", group: "Month" },
    { key: "req", label: "Need/day", type: "inr", group: "Month" }, { key: "cur", label: "Now/day", type: "inr", group: "Month" },
    { key: "inv", label: "Stock", type: "num", group: "Inventory" }, { key: "cover", label: "Cover", type: "num", group: "Inventory", tip: "Days at L30 rate" },
    { key: "stockOuts", label: "Stock-outs", group: "Inventory" },
    { key: "todo", label: "What to do", width: 360 },
    { key: "mtdTarget", label: "MTD target", type: "inr", hidden: true }, { key: "lw", label: "Same day LW", type: "inr", hidden: true }, { key: "lt", label: "Format", hidden: true },
  ];

  const board = BOARD.map((k) => ({ k, items: S.flatMap((s) => s.todos.filter((x) => x.kind === k).map((x) => ({ s, x }))).sort((a, b) => b.x.weight - a.x.weight) })).filter((g) => g.items.length);

  // daily detail
  const range = ctx.period.range;
  const detail: Record<string, unknown>[] = [];
  let dS = 0, dQ = 0, dN = 0, dT = 0, dTS = 0;
  for (const f of facts) {
    if (f.d < range.from || f.d > range.to || (f.s === 0 && !(f.t ?? 0))) continue;
    const st = ctx.byCode.get(f.b);
    const lv = model.byCode.get(f.b)?.cells[f.c]?.live ?? false;
    detail.push({ date: f.d, dow: weekday(f.d), b: f.b, store: st?.short_name ?? `Branch ${f.b}`, city: st?.city, category: catLabel(f.c), live: lv ? "Live" : "Not live",
      revenue: f.s, units: f.q, bills: f.n, target: f.t, ach: safeDiv(f.s, f.t), status: targetStatus(f.s, f.t, th), asp: safeDiv(f.s, f.q) });
    dS += f.s; dQ += f.q; dN += f.n ?? 0; if (f.t) { dT += f.t; dTS += f.s; }
  }
  detail.sort((x, y) => String(y.date).localeCompare(String(x.date)) || (y.revenue as number) - (x.revenue as number));
  const tS = rows.reduce((a, r) => ({ mtdT: a.mtdT + (r.mtdTarget ?? 0), mtdS: a.mtdS + (r.mtdTarget ? r.mtd : 0) }), { mtdT: 0, mtdS: 0 });

  return (
    <>
      <KpiGrid cols={8}>
        <Kpi label={`${weekday(ctx.asOf)} ${fmtDate(ctx.asOf)}`} value={inr(t.y)} delta={growth(t.y, t.lw)} deltaLabel="vs same day LW" tone={t.yT ? achTone(t.yS / t.yT, th) : undefined} sub={t.yT ? `${pct(t.yS / t.yT, 0)} of day target` : undefined} />
        <Kpi label="Week to date" value={inr(t.wtd)} delta={growth(t.wtd, t.pwtd)} deltaLabel="vs last week, same days" />
        <Kpi label="Last 7 days" value={inr(t.l7)} delta={growth(t.l7, t.p7)} deltaLabel="vs prior 7" />
        <Kpi label="Month to date" value={inr(t.mtd)} delta={growth(t.mtd, t.lm)} deltaLabel="vs last month, same days" />
        <Kpi label="MTD achievement" value={pct(safeDiv(t.mtdS, t.mtdT), 1)} tone={t.mtdT ? achTone(t.mtdS / t.mtdT, th) : undefined} sub={t.mtdT ? `target ${inr(t.mtdT)} · live cells` : "no target"} />
        <Kpi label="Required / day" value={inr(req)} sub={<>{model.remainingDays} days left · now {inr(t.mtd / model.elapsed)}</>} tone={req != null && req > (t.mtd / model.elapsed) * 1.1 ? "bad" : req != null ? "good" : undefined} />
        <Kpi label="Stores selling" value={`${sellingY} / ${live.length}`} sub={`on ${fmtDate(ctx.asOf)} · live stores`} tone={live.length && sellingY / live.length < 0.8 ? "warn" : undefined} />
        <Kpi label="Store stock" value={num(t.inv)} sub={<>cover {t.s30 ? `${num(t.inv / (t.s30 / 30))} days` : "—"}</>} tip={`Latest store report${model.invDate ? ` (${model.invDate})` : ""}`} />
      </KpiGrid>

      <div className="mt-3">
        <Section title="Store to-dos" tip="Rules on each store's own sales, target pace and live store stock — every item is computed, not inferred">
          {board.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {board.map((g) => (
                <div key={g.k} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between"><span className={cn("text-[12px] font-semibold", g.items[0].x.tone === "bad" ? "text-rose-700" : g.items[0].x.tone === "warn" ? "text-amber-800" : "text-brand-800")}>{TODO_LABEL[g.k]}</span><span className="tabular rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-600">{g.items.length}</span></div>
                  <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">{BOARD_HINT[g.k]}</div>
                  <ul className="mt-2 space-y-1">{g.items.slice(0, 6).map(({ s, x }, i) => (
                    <li key={i}><Link href={withQs(ctx, `/stores/${s.b}`)} className="-mx-1 block rounded px-1 py-0.5 text-[11.5px] leading-snug hover:bg-brand-50/60"><b className="font-medium">{s.store}</b><span className="block text-zinc-500">{x.text}</span></Link></li>
                  ))}</ul>
                  {g.items.length > 6 && <div className="mt-1 text-[11px] text-zinc-400">+{g.items.length - 6} more in the table below</div>}
                </div>
              ))}
            </div>
          ) : <div className="py-4 text-center text-[12.5px] text-zinc-500">No store needs attention.</div>}
        </Section>
      </div>

      <div className="mt-3">
        <DataTable title="Store DSR · day, week, month and stock" rows={rows} columns={cols} rowHref="/stores/{b}" defaultSort={{ key: "mtd" }} csvName={`dsr-stores-${ctx.asOf}`} height={640} searchKeys={["store", "city", "todo", "stockOuts"]}
          totals={{ store: "Total", y: t.y, dLw: growth(t.y, t.lw), yAch: safeDiv(t.yS, t.yT), wtd: t.wtd, dWtd: growth(t.wtd, t.pwtd), l7: t.l7, wow: growth(t.l7, t.p7), mtd: t.mtd, dLm: growth(t.mtd, t.lm), mtdAch: safeDiv(tS.mtdS, tS.mtdT), mtdTarget: tS.mtdT || null, projAch: safeDiv(S.reduce((a, s) => a + (s.monthTarget ? s.projected : 0), 0), t.monT), req, inv: t.inv, lw: t.lw }} />
        <p className="mt-1.5 text-[11.5px] text-zinc-500">Day = {fmtDate(ctx.asOf, true)}; LW = {fmtDate(W.lw.from)}; L7 = {fmtRange(W.l7)} vs {fmtRange(W.p7)}; MTD vs {fmtRange(W.lm)}. Achievement and targets count live categories only.</p>
      </div>

      <div className="mt-3">
        <DataTable title={`Daily detail · store × category · ${fmtRange(range)}`} rows={detail} height={520} csvName={`dsr-${range.from}-${range.to}`} rowHref="/stores/{b}" searchKeys={["store", "city", "category", "date", "live"]}
          columns={[{ key: "date", label: "Date", type: "date", sub: "dow" }, { key: "store", label: "Store", sub: "city", width: 200 }, { key: "category", label: "Category" }, { key: "live", label: "Live", hidden: true },
            { key: "revenue", label: "Revenue", type: "inr" }, { key: "units", label: "Units", type: "num" }, { key: "bills", label: "Bills", type: "num" },
            { key: "target", label: "Target", type: "inr" }, { key: "ach", label: "Achievement", type: "ach" }, { key: "status", label: "Status", type: "status" }, { key: "asp", label: "ASP", type: "inrFull" }]}
          totals={{ date: "Total", revenue: dS, units: dQ, bills: dN || null, target: dT || null, ach: safeDiv(dTS, dT), asp: safeDiv(dS, dQ) }} />
        <p className="mt-1.5 text-[11.5px] text-zinc-500">Gross sales; bills are reported for Perfumes and Shoes only. Sorted by date, then revenue.</p>
      </div>
    </>
  );
}
