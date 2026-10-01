import Link from "next/link";
import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { listRevamps, vmCandidates, vmPerformance, type VmRevamp } from "@/server/data/vm";
import { can } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { catColor, catLabel } from "@/server/views";
import { PageHeader, Section, Kpi, KpiGrid, Pill, DataPrompt, Delta } from "@/components/ui";
import { HowBox, MiniTable } from "@/components/wip/ui";
import { VmCreateForm, VmShortlistButton, VmAdvanceButton } from "@/components/wip/VmForms";
import { VM_STAGES, statusMeta, isOverdue } from "@/components/wip/vmStages";
import { inr, num, pct } from "@/lib/format";
import { addDays, diffDays, fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "VM Revamp" };

export default async function VmRevampPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const admin = can(ctx.user, "admin");
  const cats = new Set(ctx.filters.cats);
  const all = await listRevamps().catch(() => [] as VmRevamp[]);
  const revamps = all.filter((r) => cats.has(r.category));
  const [facts, perf] = await Promise.all([loadFacts(ctx, [{ from: addDays(ctx.asOf, -27), to: ctx.asOf }]), vmPerformance(revamps, ctx.asOf, ctx.settings.enabledCategories)]);
  const cands = await vmCandidates(facts, ctx.filters.cats, ctx.asOf, ctx.byCode, all).catch(() => []);
  const today = ctx.today;
  const active = revamps.filter((r) => r.status !== "dropped" && r.stage !== "review");
  const overdue = revamps.filter((r) => isOverdue(r, today));
  const perfRows = [...perf.values()];
  const lifts = perfRows.filter((p) => p.lift != null && p.afterDays >= 7);
  const avgLift = lifts.length ? lifts.reduce((a, p) => a + p.lift!, 0) / lifts.length : null;
  const incr = lifts.reduce((a, p) => a + (p.incrementalPerDay ?? 0) * 30, 0);
  const store = (b: string) => ctx.byCode.get(b);

  return (
    <>
      <PageHeader title="VM Revamp" subtitle={<>{ctx.filters.cat ? catLabel(ctx.filters.cat) : "All categories"} · stores selected for a visual-merchandising revamp, tracked from shortlist to a 28-day before / after read-out</>}
        right={admin ? <VmCreateForm stores={ctx.stores.filter((s) => s.store_status == null || !/clos/i.test(s.store_status)).map((s) => ({ code: s.branch_code, name: s.short_name, city: s.city })).sort((a, b) => a.name.localeCompare(b.name))} cats={ctx.filters.cats.map((c) => ({ key: c, label: catLabel(c) }))} defaultCat={ctx.filters.cat} /> : undefined} />
      {!dbConfigured() && <div className="mb-3"><DataPrompt title="Database not configured">VM revamps are stored in PostgreSQL — set DATABASE_URL to start tracking.</DataPrompt></div>}

      <div className="mb-3 flex flex-wrap items-stretch gap-1 overflow-x-auto scroll-thin">
        {VM_STAGES.map((s, i) => {
          const n = revamps.filter((r) => r.stage === s.key && r.status !== "dropped").length;
          return (
            <div key={s.key} className="flex min-w-[120px] flex-1 items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-2" title={s.hint}>
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold", n ? "bg-brand-900 text-white" : "bg-brand-50 text-brand-400")}>{i + 1}</span>
              <span className="min-w-0 leading-tight"><span className="block truncate text-[11.5px] font-medium">{s.label}</span><span className="text-[10.5px] text-zinc-500">{n} store{n === 1 ? "" : "s"}</span></span>
            </div>
          );
        })}
      </div>

      <KpiGrid cols={5}>
        <Kpi label="Active revamps" value={num(active.length)} sub={`${revamps.length} total`} />
        <Kpi label="Live · tracking" value={num(perfRows.length)} sub="with a live date" />
        <Kpi label="Overdue" value={num(overdue.length)} tone={overdue.length ? "bad" : "good"} sub="past target, not live" />
        <Kpi label="Avg lift vs peers" value={avgLift == null ? "—" : `${avgLift > 0 ? "+" : ""}${pct(avgLift, 0)}`} tone={avgLift == null ? "muted" : avgLift > 0 ? "good" : "bad"} sub={`${lifts.length} revamps ≥ 7 days live`} tip="Category sales/day change vs the change at peer stores over the same windows" />
        <Kpi label="Incremental · per month" value={lifts.length ? inr(incr) : "—"} sub="vs peer-adjusted baseline" />
      </KpiGrid>

      <Section className="mt-3" title="Revamp board" tip="One card per store × category. Click a card for the full stepper, notes and performance." pad={false}>
        <div className="overflow-x-auto scroll-thin px-4 pb-4">
          <div className="grid min-w-[1050px] grid-cols-7 gap-2">
            {VM_STAGES.map((s) => {
              const col = revamps.filter((r) => r.stage === s.key).sort((a, b) => (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"));
              return (
                <div key={s.key} className="rounded-lg bg-canvas p-1.5">
                  <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-semibold text-zinc-600">{s.label}<span className="tabular rounded bg-white px-1 text-[10px] text-zinc-500">{col.length}</span></div>
                  <div className="space-y-1.5">
                    {col.map((r) => {
                      const st = statusMeta(r.status), od = isOverdue(r, today), p = perf.get(r.id);
                      return (
                        <div key={r.id} className={cn("rounded-md border bg-white p-2 text-[11.5px] shadow-sm", od ? "border-rose-300" : "border-line", r.status === "dropped" && "opacity-50")}>
                          <Link href={withQs(ctx, `/vm/${r.id}`)} className="block hover:underline"><span className="block truncate font-semibold">{store(r.branch_code)?.short_name ?? `Branch ${r.branch_code}`}</span></Link>
                          <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-zinc-500"><span className="size-1.5 rounded-full" style={{ background: catColor(r.category) }} />{catLabel(r.category)}{r.owner ? ` · ${r.owner}` : ""}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Pill tone={st.tone as never} className="!text-[10px]">{st.label}</Pill>
                            {od && <Pill tone="bad" className="!text-[10px]">Overdue {diffDays(r.target_date!, today)}d</Pill>}
                            {p?.lift != null && p.afterDays >= 7 && <Pill tone={p.lift > 0 ? "good" : "bad"} className="!text-[10px]">{p.lift > 0 ? "+" : ""}{pct(p.lift, 0)} lift</Pill>}
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10.5px] text-zinc-400">
                            <span>{r.live_date ? `live ${fmtDate(r.live_date)}` : r.target_date ? `target ${fmtDate(r.target_date)}` : "no target date"}</span>
                            {r.status !== "dropped" && <VmAdvanceButton id={r.id} stage={r.stage} />}
                          </div>
                        </div>
                      );
                    })}
                    {!col.length && <div className="px-1 py-3 text-center text-[10.5px] text-zinc-400">—</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {!revamps.length && <div className="mt-3 text-center text-[12px] text-zinc-500">No revamps yet{admin ? " — start one with “New revamp” or shortlist a suggested store below." : "."}</div>}
        </div>
      </Section>

      <Section className="mt-3" title="Performance · 28 days before vs after live" tip="Category sales / day at the store vs the same windows at peer stores (control). Lift = store change adjusted for the peer change.">
        <MiniTable head={["Store", "Category", "Live", "Days after", "Before / day", "After / day", "Store change", "Peer change", "Lift", "Incremental / month"]}
          rows={perfRows.sort((a, b) => b.live.localeCompare(a.live)).map((p) => {
            const r = revamps.find((x) => x.id === p.id)!;
            return [
              <Link key="s" href={withQs(ctx, `/vm/${r.id}`)} className="font-medium hover:underline">{store(r.branch_code)?.short_name ?? r.branch_code}</Link>, catLabel(r.category), fmtDate(p.live, true),
              p.afterDays < 7 ? <span key="d" className="text-amber-700">{p.afterDays} · too early</span> : p.afterDays, inr(p.before), inr(p.after),
              <Delta key="c" v={p.change} />, <Delta key="p" v={p.control} />, <b key="l"><Delta v={p.lift} /></b>, p.incrementalPerDay == null ? "—" : inr(p.incrementalPerDay * 30),
            ];
          })} />
      </Section>

      <Section className="mt-3" title="Suggested candidates" tip="Top-half stores by total L30 units (all categories) where this category is not live or under-indexes vs the median store">
        <MiniTable head={["Store", "Category", "Size rank", "Category share of store units", "Median share", "Sales / day · L28", "Opportunity / month", "Why", ...(admin ? [""] : [])]}
          rows={cands.slice(0, 20).map((c) => [
            <Link key="s" href={`/stores/${c.b}`} className="font-medium hover:underline">{c.store}<span className="ml-1 text-[10.5px] font-normal text-zinc-500">{c.city}</span></Link>,
            <span key="c" className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: catColor(c.c) }} />{catLabel(c.c)}</span>,
            `#${c.sizeRank}`, c.live ? pct(c.share, 1) : <Pill key="n" tone="warn">Not live</Pill>, pct(c.peerShare, 1), inr(c.salesPerDay), <b key="o">{inr(c.opportunity)}</b>,
            <span key="w" className="text-[11px] text-zinc-500">{c.live ? "under-indexed" : `${num(c.catInv)} units in stock`}</span>,
            ...(admin ? [<VmShortlistButton key="b" branch_code={c.b} category={c.c} reason={c.reason} />] : []),
          ])} />
      </Section>

      <div className="mt-3">
        <HowBox items={[
          { k: "Process", v: VM_STAGES.map((s) => s.label).join(" → ") + ". Any signed-in user can move stages, change status / dates and add notes; creating and deleting is admin-only. Every write goes to the audit log and the revamp's note trail." },
          { k: "Overdue", v: "Target go-live date has passed and the revamp is not yet Live (and not done / dropped)." },
          { k: "Before / after", v: "Category sales per day at the store: 28 days before the live date vs up to 28 days after (live day excluded). Perfumes / Shoes = DSR gross sales; other categories = store SKU sales (gross)." },
          { k: "Lift (control-adjusted)", v: "Peers = all other stores selling the category in both windows (stores with their own revamp in that category excluded). Lift = (1 + store change) ÷ (1 + peer change) − 1. Incremental / month = (after − before × (1 + peer change)) × 30. Read-outs under 7 days are marked too early." },
          { k: "Candidates", v: "Store size = total L30 units across all categories (store report, apparel included). Top half by size, where the category has no stock and no sales, or its share of the store's units is below 70% of the median share of stores where it is live. Opportunity ≈ (median share × store units − category units) × category ASP." },
        ]} />
      </div>
    </>
  );
}
