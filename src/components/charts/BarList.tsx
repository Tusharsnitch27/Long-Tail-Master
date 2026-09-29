import Link from "next/link";
import { inr } from "@/lib/format";

/** Ranked horizontal bars (server component). */
export function BarList({ items, color = "#5b4fd6", format = "inr", empty = "No data" }: {
  items: { label: string; value: number; sub?: string; href?: string }[]; color?: string; format?: "inr" | "num"; empty?: string;
}) {
  if (!items.length) return <div className="py-6 text-center text-[13px] text-zinc-500">{empty}</div>;
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <ul className="space-y-1.5">
      {items.map((i, idx) => {
        const body = (
          <div className="relative flex items-center justify-between gap-3 overflow-hidden rounded-md px-2 py-1.5 text-[12.5px] hover:bg-zinc-50">
            <div className="absolute inset-y-0 left-0 rounded-md opacity-15" style={{ width: `${(Math.abs(i.value) / max) * 100}%`, background: color }} />
            <span className="relative truncate"><span className="mr-1.5 text-zinc-400">{idx + 1}</span>{i.label}{i.sub && <span className="ml-1.5 text-[11px] text-zinc-500">{i.sub}</span>}</span>
            <span className="tabular relative shrink-0 font-medium">{format === "inr" ? inr(i.value) : i.value.toLocaleString("en-IN")}</span>
          </div>
        );
        return <li key={idx}>{i.href ? <Link href={i.href}>{body}</Link> : body}</li>;
      })}
    </ul>
  );
}
