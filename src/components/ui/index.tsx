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
    <section className={cn("rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(17,17,20,.03)]", className)}>
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

export function Kpi({ label, value, sub, delta, deltaLabel, tip, className, href }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; delta?: number | null; deltaLabel?: string; tip?: string; className?: string; href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-[11.5px] text-zinc-500">{label}{tip && <Tip text={tip} />}</div>
      <div className="tabular mt-1 truncate text-[20px] font-semibold leading-tight tracking-[-0.02em]">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-zinc-500">
        {delta !== undefined && <Delta v={delta} />}
        {deltaLabel && <span>{deltaLabel}</span>}
        {sub}
      </div>
    </>
  );
  const cls = cn("block min-w-0 rounded-xl border border-line bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(17,17,20,.03)]", href && "transition-colors hover:border-zinc-300", className);
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function KpiGrid({ children, cols = 5 }: { children: React.ReactNode; cols?: number }) {
  const c = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[cols] ?? "lg:grid-cols-5";
  return <div className={cn("grid grid-cols-2 gap-2.5 md:grid-cols-3", c)}>{children}</div>;
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg border border-line bg-white p-0.5 scroll-thin">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} scroll={false}
          className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[12.5px] transition-colors", t.key === active ? "bg-ink font-medium text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-ink")}>
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
    <div className={cn("mb-4 rounded-lg border px-3 py-2 text-[12px]", tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-white text-zinc-600")}>
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

/** Small product image with a larger preview on hover. */
export function Thumb({ src, size = 32, className }: { src: string | null | undefined; size?: number; className?: string }) {
  if (!src) return <div className={cn("shrink-0 rounded-md bg-zinc-100", className)} style={{ width: size, height: size }} />;
  return (
    <span className={cn("thumb inline-block shrink-0", className)} style={{ width: size, height: size }}>
      <img src={src} alt="" loading="lazy" className="size-full rounded-md border border-line bg-white object-cover" />
      <img src={src} alt="" loading="lazy" className="preview" />
    </span>
  );
}

export function ProductCell({ name, sku, image, href }: { name: string | null; sku: string; image: string | null; href?: string }) {
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Thumb src={image} />
      <span className="min-w-0 leading-tight"><span className="block truncate font-medium">{name ?? sku}</span><span className="block font-mono text-[10.5px] text-zinc-400">{sku}</span></span>
    </span>
  );
  return href ? <Link href={href} className="block rounded-md hover:bg-zinc-50">{body}</Link> : body;
}

/** Horizontal share bar. */
export function Meter({ value, color = "#5046e5", className }: { value: number | null; color?: string; className?: string }) {
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
