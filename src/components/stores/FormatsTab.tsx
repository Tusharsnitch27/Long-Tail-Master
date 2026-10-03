import type { Ctx } from "@/server/context";
import { groupStores, titleCase, type StoreModel, type StoreInsight } from "@/server/storeInsights";

const title = (v: string) => titleCase(v) ?? v;
import { catColor, catLabel } from "@/server/views";
import { Section, Kpi, KpiGrid, Pill, achTone, Tip } from "@/components/ui";
import { GroupTable, Pointers, ltLabel, ctLabel, type Pointer } from "./parts";
import { inr, num, pct } from "@/lib/format";
import { safeDiv } from "@/lib/metrics";
import { cn } from "@/lib/cn";


export function FormatsTab({ ctx, model }: { ctx: Ctx; model: StoreModel }) {
  const th = ctx.settings.thresholds;
  const byLt = groupStores(model, (s) => s.lt, ltLabel, th);
  const byCt = groupStores(model, (s) => s.ct, ctLabel, th);
  const byMix = groupStores(model, (s) => (s.lt && s.ct ? `${s.lt}|${s.ct}` : null), (k) => { const [a, b] = k.split("|"); return `${ltLabel(a)} · ${ctLabel(b)}`; }, th);
  const byState = groupStores(model, (s) => s.state, title, th);
  const byRegion = groupStores(model, (s) => s.region, title, th);
  const byStatus = groupStores(model, (s) => s.status, title, th);
  const total = groupStores(model, () => "ALL", () => "Total", th)[0];
  const g = (rows: typeof byLt, k: string) => rows.find((r) => r.key === k);
  const hs = g(byLt, "HS"), mall = g(byLt, "MALL"), metro = g(byCt, "METRO"), non = g(byCt, "NON_METRO");

  // category productivity by format: sales and units per live store per day
  const segs: { key: string; label: string; test: (s: StoreInsight) => boolean }[] = [
    { key: "HS", label: "High street", test: (s) => s.lt === "HS" }, { key: "MALL", label: "Mall", test: (s) => s.lt === "MALL" },
    { key: "METRO", label: "Metro", test: (s) => s.ct === "METRO" }, { key: "NON_METRO", label: "Non-metro", test: (s) => s.ct === "NON_METRO" },
  ];
  const catSeg = model.cats.map((c) => ({
    c: c.c,
    cells: segs.map((sg) => {
      const ss = model.stores.filter((s) => sg.test(s));
      const live = ss.filter((s) => s.cells[c.c]?.live);
      const sales = live.reduce((a, s) => a + (s.cells[c.c]?.w.r.s ?? 0), 0), qty = live.reduce((a, s) => a + (s.cells[c.c]?.w.r.q ?? 0), 0);
      const s30 = live.reduce((a, s) => a + (s.cells[c.c]?.s30 ?? 0), 0), su = live.reduce((a, s) => a + s.storeUnits30, 0);
      return { key: sg.key, n: ss.length, live: live.length, perDay: safeDiv(sales, live.length * model.days), units: safeDiv(qty, live.length * model.days), pen: safeDiv(s30, su) };
    }),
  }));

  const pointers: Pointer[] = [];
  if (hs?.perStoreDay && mall?.perStoreDay) {
    const hi = hs.perStoreDay >= mall.perStoreDay ? hs : mall, lo = hi === hs ? mall : hs;
    pointers.push({ tone: "neutral", text: <>{hi.label} stores sell <b>{inr(hi.perStoreDay)}</b> / store / day vs {inr(lo.perStoreDay)} in {lo.label.toLowerCase()} ({pct(hi.perStoreDay! / lo.perStoreDay! - 1, 0)} higher); penetration {pct(hi.pen, 1)} vs {pct(lo.pen, 1)}.</> });
  }
  if (metro?.perStoreDay && non?.perStoreDay) pointers.push({ tone: "neutral", text: <>Metro stores: <b>{inr(metro.perStoreDay)}</b> / store / day vs {inr(non.perStoreDay)} non-metro; achievement {pct(metro.ach, 0)} vs {pct(non.ach, 0)}.</> });
  for (const c of catSeg) {
    const [h, m] = c.cells;
    if (h.units && m.units && h.live >= 3 && m.live >= 3) {
      const r = h.units / m.units;
      if (r >= 1.4 || r <= 1 / 1.4) pointers.push({ tone: "neutral", text: <><b>{catLabel(c.c)}</b> sells {num(Math.max(h.units, m.units), 2)} units / store / day in {r > 1 ? "high street" : "mall"} stores vs {num(Math.min(h.units, m.units), 2)} in {r > 1 ? "malls" : "high street"} — weight allocation and depth accordingly.</> });
    }
  }
  const st = byState.filter((s) => s.ach != null && s.withTarget >= 2);
  if (st.length >= 2) {
    const best = [...st].sort((a, b) => b.ach! - a.ach!)[0], worst = [...st].sort((a, b) => a.ach! - b.ach!)[0];
    pointers.push({ tone: "positive", text: <>Best state on achievement: <b>{best.label}</b> {pct(best.ach, 0)} ({best.liveStores} stores).</> });
    pointers.push({ tone: "negative", text: <>Weakest: <b>{worst.label}</b> {pct(worst.ach, 0)} — {worst.behind} of {worst.withTarget} stores below {pct(th.atRisk, 0)}.</> });
  }
  const lowCov = byState.filter((s) => s.coverage != null && s.stores >= 3).sort((a, b) => a.coverage! - b.coverage!)[0];
  if (lowCov && model.cats.length > 1) pointers.push({ tone: "negative", text: <>Lowest range coverage: <b>{lowCov.label}</b> — only {pct(lowCov.coverage, 0)} of store × category cells live across {lowCov.stores} stores.</> });

  return (
    <>
      <KpiGrid cols={4}>
        {[hs, mall, metro, non].map((x, i) => x ? (
          <Kpi key={x.key} label={`${x.label} · sales / store / day`} value={inr(x.perStoreDay)} delta={x.growth} deltaLabel="revenue"
            sub={<>{x.liveStores} stores · ach {pct(x.ach, 0)}</>} tone={achTone(x.ach, th)} />
        ) : <Kpi key={i} label={["High street", "Mall", "Metro", "Non-metro"][i]} value="—" sub="no stores" />)}
      </KpiGrid>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.3fr_1fr]">
        <Section title="Category productivity by format" pad={false} tip="Per live store per day in the selected period (stores where the category is live). Penetration = category L30 units ÷ all store units.">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-zinc-400"><th className="px-4 pt-2" />{segs.map((s) => <th key={s.key} colSpan={3} className="border-l border-line px-3 pt-2 text-center font-semibold">{s.label}</th>)}</tr>
                <tr className="border-b border-line text-[11px] text-zinc-500"><th className="px-4 py-1.5 text-left font-medium">Category</th>{segs.map((s) => ["Live", "₹ / day", "Pen."].map((h, i) => <th key={s.key + h} className={cn("px-2 py-1.5 text-right font-medium", i === 0 && "border-l border-line")}>{h}</th>))}</tr>
              </thead>
              <tbody>{catSeg.map((c) => (
                <tr key={c.c} className="border-b border-brand-50 last:border-0">
                  <td className="px-4 py-2"><span className="flex items-center gap-1.5 font-medium"><span className="size-2 rounded-full" style={{ background: catColor(c.c) }} />{catLabel(c.c)}</span></td>
                  {c.cells.map((x) => [
                    <td key={x.key + "l"} className="tabular border-l border-line px-2 text-right text-zinc-500">{x.live}<span className="text-zinc-300">/{x.n}</span></td>,
                    <td key={x.key + "p"} className="tabular px-2 text-right font-medium" title={`${num(x.units, 2)} units / store / day`}>{inr(x.perDay)}</td>,
                    <td key={x.key + "n"} className="tabular px-2 text-right text-zinc-500">{pct(x.pen, 1)}</td>,
                  ])}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
        <Section title="Key pointers"><Pointers items={pointers.slice(0, 7)} /></Section>
      </div>

      <div className="mt-3"><Section title="Format × city type" pad={false}><GroupTable rows={byMix} th={th} total={total} first="Segment" /></Section></div>
      <div className="mt-3"><Section title="High street vs Mall" pad={false} tip="Location type from the store master"><GroupTable rows={byLt} th={th} total={total} first="Format" /></Section></div>
      <div className="mt-3"><Section title="Metro vs Non-metro" pad={false}><GroupTable rows={byCt} th={th} total={total} first="City type" /></Section></div>
      <div className="mt-3"><Section title={`State-level performance · ${byState.length} states`} pad={false} tip="Sorted by revenue"><GroupTable rows={byState} th={th} total={total} first="State" /></Section></div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Section title="Region" pad={false}><GroupTable rows={byRegion} th={th} total={total} first="Region" showCoverage={false} /></Section>
        <Section title="Store status" pad={false} tip="Fresh vs Outlet stores"><GroupTable rows={byStatus} th={th} total={total} first="Status" showCoverage={false} /></Section>
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-500"><Tip text="Per-store-day rates divide by live stores only, so stores without the range don't dilute productivity" /> Bills, ATV and UPT cover Perfumes + Shoes only (the categories whose DSR reports bills).</p>
      {byLt.some((r) => r.key === "—") && <p className="mt-1 text-[11px] text-zinc-500">“Not set” = stores without a location / city type in the store master.</p>}
      {byState.length === 0 && <Pill tone="muted">No stores</Pill>}
    </>
  );
}
