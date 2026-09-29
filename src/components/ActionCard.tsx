import Link from "next/link";
import { Store } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Action } from "@/server/actions";
import { Thumb } from "@/components/ui";
import { ActionStatus } from "./ActionStatus";

const PRI = {
  urgent: "bg-rose-50 text-rose-700 ring-rose-200",
  high: "bg-amber-50 text-amber-800 ring-amber-200",
  medium: "bg-zinc-100 text-zinc-600 ring-zinc-200",
} as const;

export function ActionCard({ a, compact, qs = "", status }: { a: Action; compact?: boolean; qs?: string; status?: string | null }) {
  const withQs = (h: string) => (qs ? `${h}${h.includes("?") ? "&" : "?"}${qs}` : h);
  return (
    <div className={cn("rounded-lg border border-line bg-white transition-colors hover:border-zinc-300", compact ? "p-3" : "p-4", status && status !== "open" && "opacity-60")}>
      <div className="flex items-start gap-3">
        {a.product ? <Thumb src={a.product.image} size={compact ? 36 : 44} /> : <span className={cn("flex shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500", compact ? "size-9" : "size-11")}><Store className="size-4" /></span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide ring-1", PRI[a.priority])}>{a.priority}</span>
            <span className="text-[11px] text-zinc-500">{a.typeLabel}</span>
            <span className="text-[11px] text-zinc-300">·</span>
            <span className="text-[11px] text-zinc-500">{a.confidence} confidence</span>
          </div>
          <div className={cn("mt-1 font-medium leading-snug text-ink", compact ? "text-[12.5px]" : "text-[13.5px]")}>{a.title}</div>
          {!compact && <div className="mt-0.5 text-[12px] text-zinc-500">{a.reason}</div>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {a.evidence.slice(0, compact ? 3 : 6).map((e) => (
              <span key={e.label} className="tabular rounded-md bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600 ring-1 ring-zinc-100">{e.label} <b className="font-semibold text-zinc-800">{e.value}</b></span>
            ))}
          </div>
          {!compact && <div className="mt-2 text-[12.5px] text-zinc-700"><span className="text-zinc-400">Recommended · </span>{a.recommendation}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px]">
            <span className="tabular font-medium text-zinc-800">{a.impactLabel}</span>
            {a.links.map((l) => <Link key={l.href} href={withQs(l.href)} className="text-brand-600 hover:underline">{l.label} →</Link>)}
            {!compact && <span className="ml-auto"><ActionStatus actionKey={a.key} status={status ?? "open"} /></span>}
          </div>
        </div>
      </div>
    </div>
  );
}
