"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Category + metafield filters for the Stores table (URL: cat, mf_l1, mf_l2, mf_colour). */
export function StoreScopeFilter({ categories, options }: { categories: { key: string; label: string }[]; options: Record<string, string[]> }) {
  const sp = useSearchParams(), path = usePathname(), router = useRouter();
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    if (k === "cat") for (const x of ["mf_l1", "mf_l2", "mf_colour"]) p.delete(x); // values differ by category
    start(() => router.push(`${path}?${p.toString()}`, { scroll: false }));
  };
  const fields = [
    { k: "cat", label: "Category", opts: categories.map((c) => ({ v: c.key, l: c.label })) },
    { k: "mf_l1", label: "Type", opts: (options.l1 ?? []).map((v) => ({ v, l: v })) },
    { k: "mf_l2", label: "Sub-type", opts: (options.l2 ?? []).map((v) => ({ v, l: v })) },
    { k: "mf_colour", label: "Colour", opts: (options.colour ?? []).map((v) => ({ v, l: v })) },
  ];
  const any = fields.some((f) => sp.get(f.k));
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-paper px-3 py-2.5 shadow-[0_1px_2px_rgba(60,40,20,.04)]">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Filter stores by</span>
      {fields.map((f) => {
        const v = sp.get(f.k) ?? "";
        if (!f.opts.length && !v) return null;
        return (
          <label key={f.k} className={cn("flex h-8 items-center gap-1 rounded-lg border pl-2.5 pr-1 text-[12px] transition-colors", v ? "border-brand-900 bg-brand-900 text-canvas" : "border-zinc-300 bg-white text-zinc-600 hover:border-brand-400")}>
            <span className={cn("text-[10px] font-semibold uppercase tracking-[0.12em]", v ? "text-brand-300" : "text-zinc-400")}>{f.label}</span>
            <select value={v} onChange={(e) => set(f.k, e.target.value)} className={cn("h-7 max-w-44 cursor-pointer bg-transparent text-[12px] font-medium outline-none", v ? "text-canvas" : "text-ink")}>
              <option value="" className="text-ink">All</option>
              {f.opts.map((o) => <option key={o.v} value={o.v} className="text-ink">{o.l}</option>)}
            </select>
          </label>
        );
      })}
      {any && <button onClick={() => { const p = new URLSearchParams(sp.toString()); for (const f of fields) p.delete(f.k); start(() => router.push(`${path}?${p.toString()}`, { scroll: false })); }} className="flex h-8 items-center gap-0.5 rounded-lg px-2 text-[12px] font-medium text-rose-700 hover:bg-rose-50"><X className="size-3.5" />Clear</button>}
      {pending && <Loader2 className="size-4 animate-spin text-brand-500" />}
      <span className="ml-auto text-[11px] text-zinc-500">Type / colour add “matching products” columns: their sales, units and stock in each store.</span>
    </div>
  );
}
