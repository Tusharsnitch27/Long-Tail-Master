import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { inr, num, pct } from "@/lib/format";
import { Delta, Meter, Pill, Tip, achTone, type Tone } from "@/components/ui";
import type { GroupAgg, StoreInsight, Todo } from "@/server/storeInsights";
import { LT_LABEL, CT_LABEL } from "@/server/storeInsights";
import type { Thresholds } from "@/lib/metrics";

export const ltLabel = (v: string | null) => (v ? LT_LABEL[v] ?? v : "—");
export const ctLabel = (v: string | null) => (v ? CT_LABEL[v] ?? v : "—");
export const days = (v: number | null | undefined) => (v == null ? "—" : `${num(v)}d`);
export const coverTone = (v: number | null | undefined): Tone => (v == null ? "muted" : v < 14 ? "bad" : v > 180 ? "warn" : "good");

export interface Pointer { text: React.ReactNode; tone?: "positive" | "negative" | "neutral"; href?: string }

/** Actionable bullet list — each line is computed from data. */
export function Pointers({ items, empty = "Nothing material." }: { items: Pointer[]; empty?: string }) {
  if (!items.length) return <div className="py-3 text-[12.5px] text-zinc-500">{empty}</div>;
  return (
    <ul className="divide-y divide-zinc-100">
      {items.map((x, i) => {
        const Icon = x.tone === "positive" ? ArrowUpRight : x.tone === "negative" ? ArrowDownRight : Minus;
        const body = (
          <span className="flex items-start gap-2.5 py-2">
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", x.tone === "positive" ? "text-emerald-600" : x.tone === "negative" ? "text-rose-600" : "text-brand-500")} />
            <span className="flex-1 text-[12.5px] leading-snug text-zinc-700">{x.text}</span>
            {x.href && <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-zinc-300 group-hover:text-zinc-600" />}
          </span>
        );
        return <li key={i}>{x.href ? <Link href={x.href} className="group -mx-2 block rounded-md px-2 hover:bg-brand-50/50">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}

const TODO_TONE: Record<Todo["tone"], Tone> = { bad: "bad", warn: "warn", info: "info", good: "good" };
export const TODO_LABEL: Record<Todo["kind"], string> = { stockout: "Restock", lowcover: "Replenish", dead: "Dead stock", pace: "Behind pace", wow: "Declining", nonlive: "Target not live", underpen: "Under-penetrated", ok: "OK" };

export function TodoPill({ t }: { t: Todo }) {
  return <Pill tone={TODO_TONE[t.tone]}>{TODO_LABEL[t.kind]}</Pill>;
}

/** Compact ranked store list (top / bottom achievement etc.). */
export function StoreRank({ rows, hrefOf, metric, th, empty = "No stores to rank." }: {
  rows: StoreInsight[]; hrefOf: (b: string) => string; metric: "ach" | "projAch"; th: Thresholds; empty?: string;
}) {
  if (!rows.length) return <div className="py-6 text-center text-[12.5px] text-zinc-500">{empty}</div>;
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full whitespace-nowrap text-[12.5px]">
        <thead><tr className="border-b border-line text-[11px] text-zinc-500">
          {["#", "Store", "Revenue", "Target", "Achievement", "Gap", "Need / day"].map((h, i) => <th key={h} className={cn("px-2 py-1.5 font-medium", i > 1 ? "text-right" : "text-left")}>{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.b} className="border-b border-brand-50 last:border-0 hover:bg-brand-50/40">
            <td className="tabular px-2 py-1.5 text-[11px] text-zinc-400">{i + 1}</td>
            <td className="max-w-[220px] px-2"><Link href={hrefOf(r.b)} className="block truncate font-medium hover:underline">{r.store}</Link><span className="text-[10.5px] text-zinc-400">{[r.city, ltLabel(r.lt)].filter(Boolean).join(" · ")}</span></td>
            <td className="tabular px-2 text-right">{inr(r.sales)}</td>
            <td className="tabular px-2 text-right text-zinc-600">{inr(r.target)}</td>
            <td className="px-2 text-right"><Pill tone={achTone(metric === "ach" ? r.ach : r.projAch, th)}>{pct(metric === "ach" ? r.ach : r.projAch, 0)}</Pill></td>
            <td className={cn("tabular px-2 text-right", (r.gap ?? 0) > 0 ? "text-rose-600" : "text-emerald-700")}>{r.gap == null ? "—" : r.gap > 0 ? inr(r.gap) : `+${inr(-r.gap)}`}</td>
            <td className="tabular px-2 text-right text-zinc-600">{r.reqPerDay == null ? "—" : r.reqPerDay <= 0 ? <span className="text-emerald-700">month target met</span> : <>{inr(r.reqPerDay)}<span className="block text-[10.5px] text-zinc-400">now {inr(r.curPerDay)}</span></>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Group comparison table (state, format, city type…). */
export function GroupTable({ rows, th, first = "Group", showCoverage = true, total }: { rows: GroupAgg[]; th: Thresholds; first?: string; showCoverage?: boolean; total?: GroupAgg }) {
  if (!rows.length) return <div className="py-6 text-center text-[12.5px] text-zinc-500">No stores.</div>;
  const maxP = Math.max(...rows.map((r) => r.perStoreDay ?? 0), 1);
  const heads: [string, string?][] = [
    [first], ["Stores", "Live stores (≥1 in-scope category live) of stores with data"], ["Revenue"], ["Share"], ["Growth"],
    ["Sales / store / day", "Revenue ÷ (live stores × days)"], ["Units / store / day"], ["Bills / store / day", "Perfumes + Shoes bills (only DSR categories carry bills) ÷ stores where either is live"],
    ["ATV", "Bill value: Perfumes + Shoes sales ÷ their bills"], ["UPT", "Units per bill (Perfumes + Shoes)"], ["Discount"],
    ["Achievement", "Live store × category cells only"], ["Proj. month"], ["Ahead · Behind", `Stores ≥${pct(th.onTrack, 0)} · <${pct(th.atRisk, 0)} of target`],
    ["LT penetration", "In-scope category L30 units ÷ the stores' total L30 units across all categories (store report)"], ["Store stock"], ["Cover", "Store stock ÷ L30 daily units (store report)"],
    ...(showCoverage ? [["Range coverage", "Share of store × category cells that are live"] as [string, string]] : []),
  ];
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full whitespace-nowrap text-[12.5px]">
        <thead><tr className="border-b border-line text-[11px] text-zinc-500">
          {heads.map(([h, tip], i) => <th key={h} className={cn("px-3 py-2 font-medium", i ? "text-right" : "text-left")}><span className="inline-flex items-center gap-1">{h}{tip && <Tip text={tip} />}</span></th>)}
        </tr></thead>
        <tbody>{[...rows, ...(total && rows.length > 1 ? [{ ...total, key: "__total", label: "Total" }] : [])].map((r) => (
          <tr key={r.key} className={cn("border-b border-brand-50 last:border-0", r.key === "__total" ? "bg-brand-50/60 font-semibold" : "hover:bg-brand-50/40")}>
            <td className="px-3 py-2 font-medium">{r.label}</td>
            <td className="tabular px-3 text-right">{r.liveStores}<span className="text-zinc-400"> / {r.stores}</span></td>
            <td className="tabular px-3 text-right font-semibold">{inr(r.sales)}</td>
            <td className="tabular px-3 text-right text-zinc-500">{pct(r.share, 0)}</td>
            <td className="px-3 text-right"><Delta v={r.growth} /></td>
            <td className="px-3 text-right"><span className="inline-flex items-center justify-end gap-2"><Meter value={(r.perStoreDay ?? 0) / maxP} className="w-14" /><span className="tabular w-14">{inr(r.perStoreDay)}</span></span></td>
            <td className="tabular px-3 text-right">{num(r.unitsPerStoreDay, 2)}</td>
            <td className="tabular px-3 text-right">{num(r.billsPerStoreDay, 2)}</td>
            <td className="tabular px-3 text-right">{inr(r.atv, { compact: false })}</td>
            <td className="tabular px-3 text-right">{num(r.upt, 2)}</td>
            <td className="tabular px-3 text-right">{pct(r.disc, 1)}</td>
            <td className="px-3 text-right">{r.ach == null ? <span className="text-zinc-400">—</span> : <Pill tone={achTone(r.ach, th)}>{pct(r.ach, 0)}</Pill>}</td>
            <td className="tabular px-3 text-right">{pct(r.projAch, 0)}</td>
            <td className="tabular px-3 text-right"><span className="text-emerald-700">{r.ahead}</span><span className="text-zinc-300"> · </span><span className="text-rose-600">{r.behind}</span><span className="text-zinc-400"> / {r.withTarget}</span></td>
            <td className="tabular px-3 text-right">{pct(r.pen, 1)}</td>
            <td className="tabular px-3 text-right">{num(r.inv)}</td>
            <td className="px-3 text-right">{r.cover == null ? "—" : <Pill tone={coverTone(r.cover)}>{days(r.cover)}</Pill>}</td>
            {showCoverage && <td className="tabular px-3 text-right">{pct(r.coverage, 0)}</td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Small legend for live / not-live cells. */
export function LiveLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
      <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-brand-500" />Live · units / day (L30)</span>
      <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-rose-400" />Live · 0 stock (stock-out)</span>
      <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm border border-dashed border-zinc-400 bg-white" />Not live</span>
    </div>
  );
}
