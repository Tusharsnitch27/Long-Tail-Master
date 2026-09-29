import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Insight } from "@/server/executive";

export function InsightList({ items, qs = "", numbered, empty = "Nothing material." }: { items: Insight[]; qs?: string; numbered?: boolean; empty?: string }) {
  if (!items.length) return <div className="py-3 text-[12.5px] text-zinc-500">{empty}</div>;
  const withQs = (h: string) => (qs ? `${h}${h.includes("?") ? "&" : "?"}${qs}` : h);
  return (
    <ul className="divide-y divide-zinc-100">
      {items.map((x, i) => {
        const Icon = x.tone === "positive" ? ArrowUpRight : x.tone === "negative" ? ArrowDownRight : Minus;
        const body = (
          <span className="flex items-start gap-2.5 py-2">
            {numbered ? <span className="tabular mt-px w-4 shrink-0 text-[12px] font-semibold text-zinc-400">{i + 1}</span>
              : <Icon className={cn("mt-0.5 size-3.5 shrink-0", x.tone === "positive" ? "text-emerald-600" : x.tone === "negative" ? "text-rose-600" : "text-zinc-400")} />}
            <span className="flex-1 text-[12.5px] leading-snug text-zinc-700">{x.text}</span>
            {x.href && <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-zinc-300 group-hover:text-zinc-600" />}
          </span>
        );
        return <li key={i}>{x.href ? <Link href={withQs(x.href)} className="group -mx-2 block rounded-md px-2 hover:bg-zinc-50">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}
