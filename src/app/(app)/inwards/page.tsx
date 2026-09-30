import { pageContext, withQs, type SP } from "@/server/context";
import { loadDemand, parsePlanParams, weekOf, type SkuDemand } from "@/server/planning";
import { getRecentInwards } from "@/server/data/metafields";
import { FACILITIES, productCode } from "@/server/data/warehouse";
import { catLabel } from "@/server/views";
import { can } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { PageHeader, Section, Kpi, KpiGrid, DataPrompt, ProductCell } from "@/components/ui";
import { WipBanner, WipPill, HowBox, MiniTable } from "@/components/wip/ui";
import { InwardsManager, type InwardRow } from "@/components/wip/InwardsManager";
import { OPEN_INWARD } from "@/components/wip/vmStages";
import { inr, num, pct } from "@/lib/format";
import { addDays, fmtDate } from "@/lib/dates";
import { safeDiv } from "@/lib/metrics";

export const metadata = { title: "Future Inwards" };

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export default async function FutureInwards({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const pp = parsePlanParams({});
  const [d, recent] = await Promise.all([loadDemand(ctx, pp), getRecentInwards(90).catch(() => [])]);
  const cats = new Set(ctx.filters.cats);
  const bySku = new Map(d.skus.map((s) => [s.sku, s]));
  // selling peers by category + L1 for new-design benchmarks
  const peers = (c: string, l1: string | null) => d.skus.filter((s) => s.category === c && (!l1 || s.l1 === l1) && s.l30U > 0 && (s.p.daysSinceLive ?? 999) > 30);
  const l1sByCat = new Map<string, string[]>();
  for (const s of d.skus) if (s.l1) l1sByCat.set(s.category, [...new Set([...(l1sByCat.get(s.category) ?? []), s.l1])]);
  const today = ctx.today;

  const rows: InwardRow[] = d.fut.filter((f) => cats.has(f.category)).map((f) => {
    const s: SkuDemand | undefined = f.sku_group ? bySku.get(f.sku_group.toUpperCase()) : undefined;
    const open = OPEN_INWARD.has(f.status);
    let bench: InwardRow["bench"] = null;
    if (f.kind === "new" || !s) {
      const l1 = s?.l1 ?? (l1sByCat.get(f.category) ?? []).sort((a, b) => b.length - a.length).find((x) => f.design.toLowerCase().includes(x.toLowerCase())) ?? null;
      let ps = peers(f.category, l1), label = l1 ? `${catLabel(f.category)} · ${l1}` : `${catLabel(f.category)} (all)`;
      if (l1 && ps.length < 3) { ps = peers(f.category, null); label = `${catLabel(f.category)} (all — few ${l1} peers)`; }
      const medRate = median(ps.map((p) => p.l30U / 30));
      const asp = median(ps.map((p) => p.asp ?? 0).filter((x) => x > 0));
      bench = ps.length ? { label, peers: ps.length, medRate, daysToSell: medRate ? f.qty / medRate : null, asp } : null;
    }
    const asp = s?.asp ?? bench?.asp ?? null;
    return {
      id: f.id, category: f.category, categoryLabel: catLabel(f.category), design: f.design, sku_group: f.sku_group, kind: f.kind, qty: f.qty,
      expected_date: f.expected_date, warehouse: f.warehouse, status: f.status, note: f.note, created_by: f.created_by,
      image: s?.image ?? null, name: s?.name ?? null, overdue: open && !!f.expected_date && f.expected_date < today,
      stock: s ? s.stock : null, l30: s ? s.l30U : null, doi: s?.doi ?? null,
      coverAfter: s && s.l30U > 0 ? (s.stock + f.qty) / (s.l30U / 30) : null,
      bench, value: asp ? asp * f.qty : null,
    };
  });
  const open = rows.filter((r) => OPEN_INWARD.has(r.status));
  const newQ = open.filter((r) => r.kind === "new").reduce((a, r) => a + r.qty, 0), repQ = open.filter((r) => r.kind === "repeat").reduce((a, r) => a + r.qty, 0);
  const value = open.reduce((a, r) => a + (r.value ?? 0), 0);
  const next30 = open.filter((r) => r.expected_date && r.expected_date <= addDays(today, 30)).reduce((a, r) => a + r.qty, 0);
  const late = open.filter((r) => r.overdue).length;

  // timeline by expected week (next 16 weeks + anything late / undated)
  const w0 = weekOf(today);
  const weeks = Array.from({ length: 16 }, (_, i) => addDays(w0, i * 7));
  const bucket = (r: InwardRow) => (!r.expected_date ? "undated" : r.expected_date < w0 ? "late" : weekOf(r.expected_date) > weeks.at(-1)! ? "later" : weekOf(r.expected_date));
  const tl = new Map<string, { n: number; r: number; items: string[] }>();
  for (const r of open) { const k = bucket(r); const e = tl.get(k) ?? { n: 0, r: 0, items: [] }; if (r.kind === "new") e.n += r.qty; else e.r += r.qty; e.items.push(r.design); tl.set(k, e); }
  const tlKeys = [...(tl.has("late") ? ["late"] : []), ...weeks, ...(tl.has("later") ? ["later"] : []), ...(tl.has("undated") ? ["undated"] : [])];
  const tlMax = Math.max(1, ...[...tl.values()].map((e) => e.n + e.r));

  // actual recent inwards (PUTAWAY_TRACKING, last 90 days) for context
  const recAgg = new Map<string, { qty: number; first: string; last: string; whs: Set<string> }>();
  const known = new Set(bySku.keys());
  for (const r of recent) {
    if (!r.sku) continue;
    const s = bySku.get(productCode(String(r.sku), known));
    if (!s || !cats.has(s.category)) continue;
    const e = recAgg.get(s.sku) ?? { qty: 0, first: r.first, last: r.last, whs: new Set<string>() };
    e.qty += r.qty; if (r.first < e.first) e.first = r.first; if (r.last > e.last) e.last = r.last; e.whs.add(r.wh);
    recAgg.set(s.sku, e);
  }
  const rec = [...recAgg.entries()].map(([sku, e]) => ({ s: bySku.get(sku)!, ...e })).sort((a, b) => b.last.localeCompare(a.last) || b.qty - a.qty);
  const recQty = rec.reduce((a, r) => a + r.qty, 0);
  const warehouses = [...new Set([...FACILITIES, ...recent.map((r) => r.wh).filter(Boolean)])];

  return (
    <>
      <PageHeader title="Future Inwards" right={<WipPill />} subtitle={<>{ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories"} · new designs & repeat buys expected into the warehouse · cover impact vs current rate of sale</>} />
      <WipBanner>Plan inputs are entered here (or uploaded) until a PO / vendor feed is connected. Open inwards feed the on-order figure in <a className="underline" href={withQs(ctx, "/planning")}>Demand Planning</a>.</WipBanner>
      {!dbConfigured() && <div className="mb-3"><DataPrompt title="Database not configured">Future inwards are stored in PostgreSQL — set DATABASE_URL to add rows.</DataPrompt></div>}

      <KpiGrid cols={6}>
        <Kpi label="Open inwards" value={num(open.length)} sub={`${num(newQ + repQ)} units`} />
        <Kpi label="New designs" value={num(newQ)} sub={`${open.filter((r) => r.kind === "new").length} designs`} />
        <Kpi label="Repeat designs" value={num(repQ)} sub={`${open.filter((r) => r.kind === "repeat").length} designs`} />
        <Kpi label="Due in next 30 days" value={num(next30)} sub="units" />
        <Kpi label="Value ≈ at ASP" value={inr(value)} sub="retail value" />
        <Kpi label="Late (past expected)" value={num(late)} tone={late ? "bad" : "good"} sub="still open" />
      </KpiGrid>

      <Section className="mt-3" title="Timeline by expected week" tip="Open inwards (planned / PO confirmed / in transit) by week of expected date">
        {open.length ? (
          <div className="flex h-44 items-end gap-1.5 overflow-x-auto scroll-thin pb-1">
            {tlKeys.map((k) => {
              const e = tl.get(k) ?? { n: 0, r: 0, items: [] };
              const h = ((e.n + e.r) / tlMax) * 120;
              return (
                <div key={k} className="flex min-w-[42px] flex-1 flex-col items-center gap-1" title={e.items.slice(0, 8).join("\n")}>
                  <span className="tabular text-[10px] text-zinc-500">{e.n + e.r ? num(e.n + e.r) : ""}</span>
                  <div className="flex w-full max-w-[34px] flex-col-reverse overflow-hidden rounded-t" style={{ height: Math.max(h, 2) }}>
                    <div style={{ height: `${((e.r) / Math.max(1, e.n + e.r)) * 100}%` }} className="bg-brand-300" />
                    <div style={{ height: `${((e.n) / Math.max(1, e.n + e.r)) * 100}%` }} className="bg-brand-700" />
                  </div>
                  <span className={`text-[10px] ${k === "late" ? "font-semibold text-rose-600" : "text-zinc-500"}`}>{k.length === 10 ? fmtDate(k) : k}</span>
                </div>
              );
            })}
          </div>
        ) : <div className="py-6 text-center text-[12px] text-zinc-500">No open inwards yet.</div>}
        <div className="mt-1 flex gap-3 text-[11px] text-zinc-500"><span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-brand-700" />New designs</span><span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-brand-300" />Repeat designs</span></div>
      </Section>

      <Section className="mt-3" title="Inward plan" tip="Repeat: current stock, L30 sales, days of cover now and after the inward. New: similar-product benchmark (same category + product type).">
        <InwardsManager rows={rows} cats={ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c) }))} admin={can(ctx.user, "admin")} warehouses={warehouses} />
      </Section>

      <Section className="mt-3" title={`Actual new inwards · last 90 days (${num(recQty)} units, ${rec.length} products)`} tip="PUTAWAY_TRACKING where FINAL_TYPE = 'New Inward' — for context on what landed recently and how it is selling">
        <MiniTable head={["Product", "Category", "Inwarded", "First", "Last", "Warehouse", "L30 sold", "Stock now", "Sell-through", "DOI"]}
          rows={rec.slice(0, 40).map((r) => [
            <ProductCell key="p" name={r.s.name} sku={r.s.sku} image={r.s.image} href={`/products/${encodeURIComponent(r.s.sku)}`} />,
            catLabel(r.s.category), num(r.qty), fmtDate(r.first), fmtDate(r.last), [...r.whs].join(", "), num(r.s.l30U), num(r.s.stock),
            pct(safeDiv(r.s.l30U, r.qty), 0), r.s.doi == null ? "—" : `${num(r.s.doi)} d`,
          ])} />
        {rec.length > 40 && <p className="mt-2 text-[11px] text-zinc-500">Showing 40 most recent of {rec.length}.</p>}
      </Section>

      <div className="mt-3">
        <HowBox items={[
          { k: "Stock now", v: "Store stock (live store report) + warehouse good stock (Unicommerce, SAPL-WH1 / WH2 / North)." },
          { k: "DOI now / cover after", v: "DOI = stock ÷ (L30 units ÷ 30); cover after = (stock + inward qty) ÷ (L30 units ÷ 30). Free-gift units (< ₹10) excluded. > 150 days after inward is flagged." },
          { k: "New-design benchmark", v: "Peers = SKUs in the same category and product type (L1 from the SKU group, else matched from the design name), live > 30 days and selling. Days to sell = qty ÷ median peer rate. Falls back to the whole category when < 3 peers." },
          { k: "Value", v: "qty × ASP (SKU ASP for repeats, median peer ASP for new designs) — retail value, not cost." },
          { k: "Sell-through (actual inwards)", v: "L30 units ÷ units inwarded in the last 90 days — a proxy, since L30 sales include older stock." },
          { k: "Permissions", v: "Any signed-in user can add or edit rows; delete is admin-only. Every change is written to the audit log." },
        ]} />
      </div>
    </>
  );
}
