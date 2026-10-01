"use client";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { MultiSelect, type Option } from "@/components/filters/MultiSelect";

export interface StoreFilterDef { key: string; label: string; options: Option[]; width?: number }

/** Store Overview filter bar: pick stores directly or by region, state, city, format, city type, model, status, AM. */
export function StoreOverviewFilters({ fields, matched, total, network }: { fields: StoreFilterDef[]; matched: number; total: number; network?: boolean }) {
  const sp = useSearchParams(), path = usePathname(), router = useRouter();
  const [pending, start] = useTransition();
  const list = (k: string) => (sp.get(k) ?? "").split(",").filter(Boolean);
  const set = (k: string, v: string[]) => {
    const p = new URLSearchParams(sp.toString());
    if (v.length) p.set(k, v.join(",")); else p.delete(k);
    start(() => router.push(`${path}?${p.toString()}`, { scroll: false }));
  };
  const any = fields.some((f) => list(f.key).length);
  return (
    <div className="card mb-3 flex flex-wrap items-center gap-2 rounded-[16px] px-3 py-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-700">Stores</span>
      {fields.filter((f) => f.options.length > 1 || list(f.key).length).map((f) => (
        <MultiSelect key={f.key} pill label={f.label} width={f.width ?? 260} options={f.options} value={list(f.key)} onChange={(v) => set(f.key, v)} />
      ))}
      {any && <button onClick={() => { const p = new URLSearchParams(sp.toString()); for (const f of fields) p.delete(f.key); start(() => router.push(`${path}?${p.toString()}`, { scroll: false })); }}
        className="flex h-8 items-center gap-0.5 rounded-lg px-2 text-[12px] font-medium text-rose-700 hover:bg-rose-50"><X className="size-3.5" />Clear</button>}
      {pending && <Loader2 className="size-4 animate-spin text-brand-500" />}
      <span className="ml-auto text-[11.5px] text-zinc-500">
        <b className="tabular font-semibold text-ink">{matched}</b> of {total} stores{network ? " · network view: store picks don't apply, attribute filters do" : ""}
      </span>
    </div>
  );
}
