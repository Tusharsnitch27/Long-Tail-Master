import Link from "next/link";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { STATUS_META, type TargetStatus } from "@/lib/metrics";
import { pct, signedPct } from "@/lib/format";

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[19px] font-semibold tracking-[-0.015em]">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[12.5px] text-zinc-500">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function Tip({ text, className }: { text: string; className?: string }) {
  return (
    <span data-tip={text} className={cn("inline-flex cursor-help align-middle text-zinc-300 hover:text-zinc-500", className)} tabIndex={0} aria-label={text}>
      <Info className="size-3" />
    </span>
  );
}

export function Section({ title, tip, right, children, className, pad = true }: {
  title?: React.ReactNode; tip?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={cn("rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(11,42,48,.04)]", className)}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-1 pt-3">
          <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-zinc-800">{title}{tip && <Tip text={tip} />}</h2>
          {right}
        </div>
      )}
      <div className={pad ? "px-4 pb-4 pt-2" : ""}>{children}</div>
    </section>
  );
}

export function Delta({ v, invert, className, suffix }: { v: number | null | undefined; invert?: boolean; className?: string; suffix?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className={cn("text-zinc-400", className)}>—</span>;
  const good = invert ? v < 0 : v > 0;
  const neutral = Math.abs(v) < 0.0005;
  return (
    <span className={cn("tabular font-medium", neutral ? "text-zinc-500" : good ? "text-emerald-600" : "text-rose-600", className)}>
      {signedPct(v)}{suffix ? ` ${suffix}` : ""}
    </span>
  );
}

export function StatusBadge({ status, ach }: { status: TargetStatus; ach?: number | null }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1", m.cls)}>
      {m.label}{ach != null && status !== "no_target" ? ` · ${pct(ach, 0)}` : ""}
    </span>
  );
}

export type Tone = "good" | "warn" | "bad" | "info" | "muted";
const TONE_TEXT: Record<Tone, string> = { good: "text-emerald-700", warn: "text-amber-700", bad: "text-rose-600", info: "text-brand-700", muted: "text-zinc-400" };
const TONE_BAR: Record<Tone, string> = { good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", info: "bg-brand-500", muted: "bg-zinc-300" };
/** Tone for an achievement ratio against the status thresholds. */
export const achTone = (a: number | null | undefined, th = { onTrack: 0.95, atRisk: 0.8 }): Tone => (a == null ? "muted" : a >= th.onTrack ? "good" : a >= th.atRisk ? "warn" : "bad");

export function Kpi({ label, value, sub, delta, deltaLabel, tip, className, href, tone }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; delta?: number | null; deltaLabel?: string; tip?: string; className?: string; href?: string; tone?: Tone;
}) {
  const body = (
    <>
      {tone && <span className={cn("absolute inset-x-0 top-0 h-[3px] rounded-t-xl", TONE_BAR[tone])} />}
      <div className="flex items-center gap-1 text-[11.5px] text-zinc-500">{label}{tip && <Tip text={tip} />}</div>
      <div className={cn("tabular mt-1 truncate text-[20px] font-semibold leading-tight tracking-[-0.02em]", tone && tone !== "info" && tone !== "muted" && TONE_TEXT[tone])}>{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-zinc-500">
        {delta !== undefined && <Delta v={delta} />}
        {deltaLabel && <span>{deltaLabel}</span>}
        {sub}
      </div>
    </>
  );
  const cls = cn("relative block min-w-0 rounded-xl border border-line bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(11,42,48,.04)]", href && "transition-colors hover:border-brand-300", className);
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function KpiGrid({ children, cols = 5 }: { children: React.ReactNode; cols?: number }) {
  const c = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6", 7: "lg:grid-cols-4 xl:grid-cols-7", 8: "lg:grid-cols-4 xl:grid-cols-8" }[cols] ?? "lg:grid-cols-5";
  return <div className={cn("grid grid-cols-2 gap-2.5 md:grid-cols-3", c)}>{children}</div>;
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg border border-line bg-white p-0.5 scroll-thin">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} scroll={false}
          className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[12.5px] transition-colors", t.key === active ? "bg-brand-700 font-medium text-white" : "text-zinc-600 hover:bg-brand-50 hover:text-ink")}>
          {t.label}{t.count != null && <span className={cn("tabular rounded px-1 text-[10.5px]", t.key === active ? "bg-white/20" : "bg-zinc-100 text-zinc-500")}>{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Empty({ title = "Nothing to show", children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
      <div className="text-[13px] font-medium text-zinc-700">{title}</div>
      {children && <div className="mt-1 max-w-md text-[12.5px] text-zinc-500">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div className={cn("mb-4 rounded-lg border px-3 py-2 text-[12px]", tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-brand-100 bg-brand-50/60 text-brand-900")}>
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

/** Product image with a large preview on hover. */
export function Thumb({ src, size = 44, className }: { src: string | null | undefined; size?: number; className?: string }) {
  if (!src) return <div className={cn("flex shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[9px] text-brand-400", className)} style={{ width: size, height: size }}>no image</div>;
  return (
    <span className={cn("thumb inline-block shrink-0", className)} style={{ width: size, height: size }}>
      <img src={src} alt="" loading="lazy" className="size-full rounded-lg border border-line bg-white object-cover" />
      <img src={src} alt="" loading="lazy" className="preview" />
    </span>
  );
}

export function ProductCell({ name, sku, image, href, size = 44, sub }: { name: string | null; sku: string; image: string | null; href?: string; size?: number; sub?: React.ReactNode }) {
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Thumb src={image} size={size} />
      <span className="min-w-0 leading-tight"><span className="block truncate font-medium">{name ?? sku}</span><span className="block font-mono text-[10.5px] text-zinc-400">{sku}{sub ? <span className="ml-1.5 font-sans text-zinc-500">{sub}</span> : null}</span></span>
    </span>
  );
  return href ? <Link href={href} className="block rounded-md hover:bg-brand-50/60">{body}</Link> : body;
}

/**
 * Data-gap prompt: says what is missing for this view and where to fix it (upload / configure) — never a silent blank.
 */
export function DataPrompt({ title, children, href, cta, compact }: { title: string; children?: React.ReactNode; href?: string; cta?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border border-dashed border-brand-300 bg-brand-50/50 text-brand-900", compact ? "px-3 py-2" : "px-4 py-3")}>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-white">!</span>
      <div className="min-w-0 flex-1 text-[12.5px]">
        <div className="font-semibold">{title}</div>
        {children && <div className="mt-0.5 text-[12px] text-brand-800/80">{children}</div>}
      </div>
      {href && <Link href={href} className="shrink-0 rounded-lg bg-brand-700 px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-brand-800">{cta ?? "Set up"} →</Link>}
    </div>
  );
}

export function Pill({ tone = "info", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  const cls: Record<Tone, string> = { good: "bg-emerald-50 text-emerald-800 ring-emerald-200", warn: "bg-amber-50 text-amber-800 ring-amber-200", bad: "bg-rose-50 text-rose-700 ring-rose-200", info: "bg-brand-50 text-brand-800 ring-brand-200", muted: "bg-zinc-100 text-zinc-600 ring-zinc-200" };
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1", cls[tone], className)}>{children}</span>;
}

/** Horizontal share bar. */
export function Meter({ value, color = "#0e8a96", className }: { value: number | null; color?: string; className?: string }) {
  return (
    <span className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-zinc-100", className)}>
      <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%`, background: color }} />
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="tabular truncate text-[14px] font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}
