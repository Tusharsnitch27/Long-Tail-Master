import { FlaskConical, Lightbulb, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";

/** Small shared pieces for the Admin Lab and the "In the works" pages (server-safe). */
export function ExperimentalPill({ label = "Experimental" }: { label?: string }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 ring-1 ring-brand-200"><FlaskConical className="size-2.5" />{label}</span>;
}

export function WipPill({ label = "WIP" }: { label?: string }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200"><Wrench className="size-3" />{label}</span>;
}

export function WipBanner({ children, title = "Work in progress" }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-[12px] text-amber-900">
      <Wrench className="mt-0.5 size-3.5 shrink-0" />
      <div><span className="font-semibold">{title}. </span>{children}</div>
    </div>
  );
}

/** One experimental view: title, why it matters, the view, and a possible action. */
export function LabCard({ id, title, why, action, children, className, right }: {
  id?: string; title: string; why: string; action?: React.ReactNode; children: React.ReactNode; className?: string; right?: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 card rounded-[18px] shadow-[0_1px_2px_rgba(60,40,20,.04)]", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-zinc-800">{title}<ExperimentalPill /></h2>
          <p className="mt-0.5 text-[11.5px] text-zinc-500"><span className="font-medium text-zinc-600">Why it matters:</span> {why}</p>
        </div>
        {right}
      </div>
      <div className="px-4 pb-3">{children}</div>
      {action && (
        <div className="flex items-start gap-2 rounded-b-xl border-t border-line bg-brand-50/40 px-4 py-2 text-[11.5px] text-brand-900">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand-600" /><div><span className="font-semibold">Possible action:</span> {action}</div>
        </div>
      )}
    </section>
  );
}

export function HowBox({ title = "How this is calculated", items }: { title?: string; items: { k: string; v: React.ReactNode }[] }) {
  return (
    <details className="group card rounded-[18px] px-4 py-3 text-[12px] shadow-[0_1px_2px_rgba(60,40,20,.04)]">
      <summary className="cursor-pointer select-none text-[12.5px] font-semibold text-zinc-800">{title}</summary>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 md:grid-cols-2">
        {items.map((i) => <div key={i.k}><dt className="font-medium text-zinc-700">{i.k}</dt><dd className="text-zinc-500">{i.v}</dd></div>)}
      </dl>
    </details>
  );
}

/** Minimal compact table for server-rendered views. */
export function MiniTable({ head, rows, align, className }: { head: React.ReactNode[]; rows: React.ReactNode[][]; align?: ("l" | "r" | "c")[]; className?: string }) {
  const a = (i: number) => (align?.[i] ?? (i === 0 ? "l" : "r")) === "l" ? "text-left" : align?.[i] === "c" ? "text-center" : "text-right";
  return (
    <div className={cn("overflow-x-auto scroll-thin", className)}>
      <table className="w-full whitespace-nowrap text-[12px]">
        <thead><tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-zinc-500">{head.map((h, i) => <th key={i} className={cn("px-2 py-1.5 font-medium first:pl-0", a(i))}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, j) => <tr key={j} className="border-b border-line/60 last:border-0">{r.map((c, i) => <td key={i} className={cn("tabular px-2 py-1.5 first:pl-0", a(i))}>{c}</td>)}</tr>)}</tbody>
      </table>
      {!rows.length && <div className="py-5 text-center text-[12px] text-zinc-500">Nothing to show for this selection.</div>}
    </div>
  );
}
