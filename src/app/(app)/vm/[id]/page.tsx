import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { getRevamp, listRevamps, vmPerformance } from "@/server/data/vm";
import { can } from "@/server/auth";
import { catLabel } from "@/server/views";
import { PageHeader, Section, Kpi, KpiGrid, Pill, Empty, Delta } from "@/components/ui";
import { TrendChart } from "@/components/charts/TrendChart";
import { VmUpdateForm } from "@/components/wip/VmForms";
import { VM_STAGES, stageIndex, statusMeta, isOverdue } from "@/components/wip/vmStages";
import { inr, pct } from "@/lib/format";
import { diffDays, fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "VM Revamp" };

export default async function VmDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const [{ id }, ctx] = await Promise.all([params, pageContext(searchParams)]);
  const r = Number.isInteger(Number(id)) ? await getRevamp(Number(id)).catch(() => null) : null;
  if (!r) return <><PageHeader title="VM Revamp" /><Empty title="Revamp not found"><Link href={withQs(ctx, "/vm")} className="text-brand-700 hover:underline">Back to the board</Link></Empty></>;
  const all = await listRevamps();
  const perf = (await vmPerformance(all.filter((x) => x.category === r.category), ctx.asOf, ctx.settings.enabledCategories)).get(r.id);
  const st = ctx.byCode.get(r.branch_code);
  const sm = statusMeta(r.status);
  const cur = stageIndex(r.stage);
  const od = isOverdue(r, ctx.today);

  return (
    <>
      <PageHeader title={`${st?.short_name ?? `Branch ${r.branch_code}`} · ${catLabel(r.category)} revamp`}
        subtitle={<><Link href={withQs(ctx, "/vm")} className="text-brand-700 hover:underline">VM Revamp</Link> · {st?.city ?? ""}{st?.am ? ` · AM ${st.am}` : ""} · created by {r.created_by} on {fmtDate(r.created_at.slice(0, 10), true)}</>}
        right={<div className="flex gap-1.5"><Pill tone={sm.tone as never}>{sm.label}</Pill>{od && <Pill tone="bad">Overdue {diffDays(r.target_date!, ctx.today)} days</Pill>}</div>} />

      <div className="mb-3 flex overflow-x-auto rounded-xl border border-line bg-white p-3 scroll-thin">
        {VM_STAGES.map((s, i) => (
          <div key={s.key} className="flex min-w-[130px] flex-1 items-start gap-2">
            <div className="flex flex-col items-center">
              <span className={cn("flex size-6 items-center justify-center rounded-full text-[11px] font-semibold", i < cur ? "bg-brand-500 text-white" : i === cur ? "bg-brand-700 text-white ring-4 ring-brand-100" : "bg-zinc-100 text-zinc-400")}>{i < cur ? "✓" : i + 1}</span>
            </div>
            <div className="min-w-0 pr-2 leading-tight">
              <div className={cn("text-[12px] font-medium", i > cur && "text-zinc-400")}>{s.label}</div>
              <div className="text-[10.5px] text-zinc-500">{s.hint}</div>
            </div>
          </div>
        ))}
      </div>

      <KpiGrid cols={5}>
        <Kpi label="Owner" value={r.owner ?? "—"} />
        <Kpi label="Start" value={r.start_date ? fmtDate(r.start_date, true) : "—"} />
        <Kpi label="Target go-live" value={r.target_date ? fmtDate(r.target_date, true) : "—"} tone={od ? "bad" : undefined} />
        <Kpi label="Live" value={r.live_date ? fmtDate(r.live_date, true) : "Not live"} sub={r.live_date ? `${Math.max(0, diffDays(r.live_date, ctx.asOf))} days of data after` : undefined} />
        <Kpi label="Lift vs peers" value={perf?.lift == null ? "—" : `${perf.lift > 0 ? "+" : ""}${pct(perf.lift, 0)}`} tone={perf?.lift == null ? "muted" : perf.afterDays < 7 ? "warn" : perf.lift > 0 ? "good" : "bad"} sub={perf ? (perf.afterDays < 7 ? "too early to read" : `${perf.peers} peer stores`) : "after go-live"} />
      </KpiGrid>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Category sales / day · 28 days either side of live" tip="Bars: this store. Line: average peer store (control) over the same days.">
          {perf ? (
            <>
              <div className="mb-2 flex flex-wrap gap-4 text-[12px]">
                <span>Before <b className="tabular">{inr(perf.before)}</b>/day</span><span>After <b className="tabular">{inr(perf.after)}</b>/day</span>
                <span>Store <Delta v={perf.change} /></span><span>Peers <Delta v={perf.control} /></span><span>Lift <b><Delta v={perf.lift} /></b></span>
                <span>Incremental <b className="tabular">{perf.incrementalPerDay == null ? "—" : inr(perf.incrementalPerDay * 30)}</b>/month</span>
              </div>
              <TrendChart data={perf.series} height={240} series={[{ key: "store", label: "This store", color: "#0b5f6a" }, { key: "peer", label: "Avg peer store", color: "#8fd6da", type: "line", dashed: true }]} />
            </>
          ) : <Empty title="No read-out yet">Performance tracking starts once the revamp has a live date. The chart then compares 28 days before vs after, against peer stores.</Empty>}
        </Section>
        <Section title="Update">
          <VmUpdateForm r={r} admin={can(ctx.user, "admin")} />
        </Section>
      </div>

      <Section className="mt-3" title={`Notes & history (${r.notes.length})`}>
        <ol className="space-y-2">
          {[...r.notes].reverse().map((n, i) => (
            <li key={i} className="flex gap-2.5 text-[12px]">
              <span className={cn("mt-1 size-2 shrink-0 rounded-full", n.kind === "note" || n.kind === "created" ? "bg-brand-500" : "bg-zinc-300")} />
              <div><div className={cn(n.kind === "stage" || n.kind === "status" ? "text-zinc-500" : "text-zinc-800")}>{n.text}</div><div className="text-[10.5px] text-zinc-400">{n.by} · {new Date(n.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div></div>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
