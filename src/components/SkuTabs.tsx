"use client";
import Link from "next/link";
import { useState } from "react";
import { Thumb } from "@/components/ui";
import { useAccess } from "@/components/shell/Permissions";
import { inr, num, pct } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface SkuRow { sku: string; name: string; image: string | null; revenue: number; units: number; growth?: number | null; note?: string | null; tone?: "good" | "bad" | "warn" | null }
export interface SkuTab { key: string; label: string; color?: string; rows: SkuRow[] }

/** One tab per category (only categories in scope), each listing its products with image, revenue and units. */
export function SkuTabs({ tabs, qs = "", empty = "No sales in this period.", limit = 10 }: { tabs: SkuTab[]; qs?: string; empty?: string; limit?: number }) {
  const [k, setK] = useState(tabs[0]?.key);
  const money = useAccess().revenue;
  const cur = tabs.find((t) => t.key === k) ?? tabs[0];
  if (!cur) return <div className="py-6 text-center text-[12.5px] text-zinc-500">{empty}</div>;
  const max = Math.max(...cur.rows.map((r) => r.revenue), 1);
  const total = cur.rows.reduce((a, r) => a + r.revenue, 0);
  const href = (sku: string) => `/products/${encodeURIComponent(sku)}${qs ? `?${qs}` : ""}`;
  return (
    <div>
      {tabs.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setK(t.key)} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors", t.key === cur.key ? "border-brand-700 bg-brand-900 text-white" : "border-line bg-white text-zinc-600 hover:border-brand-300")}>
              {t.color && <span className="size-1.5 rounded-full" style={{ background: t.key === cur.key ? "#fff" : t.color }} />}{t.label}
            </button>
          ))}
        </div>
      )}
      {cur.rows.length === 0 ? <div className="py-6 text-center text-[12.5px] text-zinc-500">{empty}</div> : (
        <ol className="space-y-1">
          {cur.rows.slice(0, limit).map((r, i) => (
            <li key={r.sku}>
              <Link href={href(r.sku)} className="group -mx-2 grid grid-cols-[18px_52px_1fr_auto] items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-brand-50/60">
                <span className="tabular text-[11px] font-semibold text-zinc-400">{i + 1}</span>
                <Thumb src={r.image} size={52} />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{r.name}</span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-brand-50"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(r.revenue / max) * 100}%` }} /></span>
                  <span className="mt-0.5 block font-mono text-[10.5px] text-zinc-400">{r.sku}{r.note ? <span className={cn("ml-1.5 font-sans", r.tone === "bad" ? "text-rose-600" : r.tone === "warn" ? "text-amber-700" : r.tone === "good" ? "text-emerald-700" : "text-zinc-500")}>{r.note}</span> : null}</span>
                </span>
                <span className="tabular text-right text-[12px]">
                  {money ? <b className="font-semibold">{inr(r.revenue)}</b> : <b className="font-semibold">{num(r.units)} units</b>}
                  <span className="block text-[11px] text-zinc-500">{money ? `${num(r.units)} units · ` : ""}{pct(total ? r.revenue / total : null, 0)} share</span>
                  {r.growth !== undefined && r.growth != null && <span className={cn("block text-[10.5px] font-medium", r.growth >= 0 ? "text-emerald-600" : "text-rose-600")}>{r.growth >= 0 ? "+" : ""}{(r.growth * 100).toFixed(0)}%</span>}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
