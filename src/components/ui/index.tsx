import Link from "next/link";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { STATUS_META, type TargetStatus } from "@/lib/metrics";
import { pct, signedPct } from "@/lib/format";

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[13px] text-zinc-500">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function Tip({ text, className }: { text: string; className?: string }) {
  return (
    <span data-tip={text} className={cn("inline-flex cursor-help align-middle text-zinc-400", className)} tabIndex={0} aria-label={text}>
      <Info className="size-3.5" />
    </span>
  );
}

export function Section({ title, tip, right, children, className, pad = true }: {
  title?: React.ReactNode; tip?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={cn("rounded-xl border border-zinc-200 bg-white", className)}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
          <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold">{title}{tip && <Tip text={tip} />}</h2>
          {right}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Delta({ v, invert, className, suffix }: { v: number | null | undefined; invert?: boolean; className?: string; suffix?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className={cn("text-zinc-400", className)}>—</span>;
  const good = invert ? v < 0 : v > 0;
  const neutral = Math.abs(v) < 0.0005;
  return (
    <span className={cn("tabular font-medium", neutral ? "text-zinc-500" : good ? "text-emerald-700" : "text-rose-700", className)}>
      {neutral ? "■" : v > 0 ? "▲" : "▼"} {signedPct(v)}{suffix ? ` ${suffix}` : ""}
    </span>
  );
}

export function StatusBadge({ status, ach }: { status: TargetStatus; ach?: number | null }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] font-medium ring-1", m.cls)}>
      <span aria-hidden>{m.icon}</span>{m.label}{ach != null && status !== "no_target" ? ` · ${pct(ach, 0)}` : ""}
    </span>
  );
}

export function Kpi({ label, value, sub, delta, deltaLabel, tip, status, className }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; delta?: number | null; deltaLabel?: string; tip?: string; status?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-zinc-200 bg-white px-4 py-3", className)}>
      <div className="flex items-center gap-1 text-[11.5px] font-medium uppercase tracking-wide text-zinc-500">{label}{tip && <Tip text={tip} />}</div>
      <div className="tabular mt-1 truncate text-[22px] font-semibold leading-tight tracking-tight">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-zinc-500">
        {delta !== undefined && <Delta v={delta} />}
        {deltaLabel && <span>{deltaLabel}</span>}
        {sub}
        {status}
      </div>
    </div>
  );
}

export function KpiGrid({ children, cols = 6 }: { children: React.ReactNode; cols?: number }) {
  const c = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[cols] ?? "lg:grid-cols-6";
  return <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3", c)}>{children}</div>;
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} scroll={false}
          className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium", t.key === active ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800")}>
          {t.label}{t.count != null && <span className="ml-1.5 rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-600">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Empty({ title = "Nothing to show", children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <div className="text-[14px] font-medium text-zinc-700">{title}</div>
      {children && <div className="mt-1 max-w-md text-[13px] text-zinc-500">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div className={cn("mb-4 rounded-lg border px-3 py-2 text-[12.5px]", tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900")}>
      {children}
    </div>
  );
}

export function AchBar({ v }: { v: number | null }) {
  if (v == null) return <span className="text-zinc-400">—</span>;
  const w = Math.min(v, 1.5) / 1.5;
  const color = v >= 1 ? "bg-emerald-500" : v >= 0.8 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-16 overflow-hidden rounded bg-zinc-100">
        <div className={cn("h-full", color)} style={{ width: `${w * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-zinc-500" style={{ left: `${100 / 1.5}%` }} />
      </div>
      <span className="tabular">{pct(v, 0)}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}
