"use client";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { compactNum, inr, num, pct } from "@/lib/format";

export interface MixPart { label: string; value: number; color: string }
const FMT = { inr: (v: number) => inr(v), num: (v: number) => num(v), compact: (v: number) => compactNum(v), none: () => "" } as const;

/**
 * Stacked share bar. Hovering (or focusing) it shows the full split — every part's value and % share — in a popover
 * positioned on the viewport, so it is never clipped by a scrolling table and thin segments stay readable.
 */
export function MixBar({ parts, title, format = "inr", className, barClass = "h-2", labelMin = 1, legend = false }: {
  parts: MixPart[]; title?: string; format?: keyof typeof FMT; className?: string; barClass?: string;
  /** print % inside segments at least this share wide (1 = never) */ labelMin?: number;
  /** show a small "largest part · share" line under the bar */ legend?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const fmt = FMT[format];
  const t = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  if (!t) return <span className="text-zinc-400">—</span>;
  const shown = parts.filter((p) => p.value > 0);
  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.bottom > window.innerHeight - 220 ? r.top : r.bottom, up: r.bottom > window.innerHeight - 220 });
  };
  const top = [...shown].sort((a, b) => b.value - a.value);
  return (
    <span ref={ref} tabIndex={0} onMouseEnter={open} onMouseLeave={() => setPos(null)} onFocus={open} onBlur={() => setPos(null)}
      className={cn("block cursor-default outline-none", className)} aria-label={top.map((p) => `${p.label} ${pct(p.value / t, 0)}`).join(", ")}>
      <span className={cn("flex w-full overflow-hidden rounded-full bg-zinc-100 transition", pos && "ring-2 ring-brand-300", barClass)}>
        {shown.map((p) => (
          <span key={p.label} className="flex items-center justify-center overflow-hidden text-[10px] font-semibold text-white" style={{ width: `${(p.value / t) * 100}%`, background: p.color }}>
            {p.value / t >= labelMin ? pct(p.value / t, 0) : ""}
          </span>
        ))}
      </span>
      {legend && <span className="mt-0.5 block truncate text-[10.5px] text-zinc-500">{top[0].label} {pct(top[0].value / t, 0)}{top[1] ? ` · ${top[1].label} ${pct(top[1].value / t, 0)}` : ""}</span>}
      {pos && (
        <span role="tooltip" style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.up ? "calc(-100% - 6px)" : "6px"})` }}
          className="pointer-events-none fixed z-[90] block w-max min-w-48 max-w-72 rounded-lg bg-brand-900 px-2.5 py-2 text-left text-[11.5px] font-normal normal-case leading-snug tracking-normal text-canvas shadow-[0_18px_40px_-16px_rgba(60,40,20,.6)]">
          {title && <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-300">{title}</span>}
          {top.map((p) => (
            <span key={p.label} className="grid grid-cols-[10px_1fr_auto_36px] items-center gap-1.5 py-px">
              <span className="size-2 rounded-full" style={{ background: p.color }} />
              <span className="truncate">{p.label}</span>
              <span className="tabular text-canvas/70">{fmt(p.value)}</span>
              <span className="tabular text-right font-semibold">{pct(p.value / t, 0)}</span>
            </span>
          ))}
          {format !== "none" && <span className="mt-1 flex justify-between border-t border-white/15 pt-1 text-canvas/70"><span>Total</span><span className="tabular">{fmt(t)}</span></span>}
        </span>
      )}
    </span>
  );
}
