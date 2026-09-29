"use client";
import { X, RotateCcw, CalendarDays } from "lucide-react";
import { PRESETS } from "@/lib/dates";
import { PRICE_BANDS, STORE_DIMS } from "@/lib/filters";
import { filterScope } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { MultiSelect, type Option } from "./MultiSelect";
import { useQuery } from "./useQuery";

export interface FilterOptions {
  cats: { key: string; label: string; color: string }[];
  stores: Option[];
  dims: Record<string, string[]>;
  asOf: string;
  today: string;
}

const CHANNELS = [
  { key: "store", label: "Stores" },
  { key: "shopify", label: "Website/App" },
  { key: "marketplace", label: "Marketplace" },
  { key: "all", label: "All channels" },
];

export function FilterBar({ options }: { options: FilterOptions }) {
  const { sp, set, list, pending, path } = useQuery();
  const scope = filterScope(path);
  if (!scope.date && !scope.store && !scope.sku) return null;
  const preset = sp.get("p") ?? "mtd";
  const cats = list("cat");
  const activeCats = cats.length ? cats : options.cats.map((c) => c.key);
  const storeLabel = new Map(options.stores.map((o) => [o.value, o.label]));

  const chips: { k: string; v: string; label: string }[] = [];
  if (scope.store) {
    for (const v of list("store")) chips.push({ k: "store", v, label: storeLabel.get(v) ?? v });
    for (const d of STORE_DIMS) for (const v of list(d.key)) chips.push({ k: d.key, v, label: `${d.label}: ${v}` });
  }
  if (scope.sku) for (const v of list("pb")) chips.push({ k: "pb", v, label: PRICE_BANDS.find((b) => b.key === v)?.label ?? v });
  const dirty = chips.length > 0 || cats.length > 0 || sp.get("p") || sp.get("ch");

  const toggleCat = (k: string) => {
    const next = activeCats.includes(k) ? activeCats.filter((c) => c !== k) : [...activeCats, k];
    set({ cat: next.length === options.cats.length || next.length === 0 ? null : next });
  };

  return (
    <div className="z-30 border-b border-zinc-200 bg-white/95 backdrop-blur md:sticky md:top-0">
      <div className={cn("h-0.5 w-full bg-brand-500 transition-opacity", pending ? "animate-pulse opacity-100" : "opacity-0")} />
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 sm:px-5">
        {scope.date && (
          <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-0.5 scroll-thin">
            {PRESETS.filter((p) => p.key !== "custom").map((p) => (
              <button key={p.key} onClick={() => set({ p: p.key === "mtd" ? null : p.key, from: null, to: null })}
                className={cn("shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[12.5px] font-medium", preset === p.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900")}>
                {p.label}
              </button>
            ))}
            <label className={cn("flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[12.5px]", preset === "custom" ? "bg-white shadow-sm" : "text-zinc-600")}>
              <CalendarDays className="size-3.5" />
              <input type="date" max={options.today} value={sp.get("from") ?? ""} className="w-[118px] bg-transparent outline-none"
                onChange={(e) => set({ p: "custom", from: e.target.value, to: sp.get("to") ?? options.asOf })} />
              <span>–</span>
              <input type="date" max={options.today} value={sp.get("to") ?? ""} className="w-[118px] bg-transparent outline-none"
                onChange={(e) => set({ p: "custom", to: e.target.value, from: sp.get("from") ?? e.target.value })} />
            </label>
          </div>
        )}

        <div className="flex items-center gap-1">
          {options.cats.map((c) => {
            const on = activeCats.includes(c.key);
            return (
              <button key={c.key} onClick={() => toggleCat(c.key)} aria-pressed={on}
                className={cn("flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium", on ? "border-zinc-800 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-500 line-through decoration-zinc-400")}>
                <span className="size-2 rounded-full" style={{ background: c.color }} />{c.label}
              </button>
            );
          })}
        </div>

        {scope.sku && (
          <select value={sp.get("ch") ?? "store"} onChange={(e) => set({ ch: e.target.value === "store" ? null : e.target.value })}
            className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-[13px]">
            {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        )}

        {scope.store && (
          <>
            <span className="mx-1 h-5 w-px bg-zinc-200" />
            <MultiSelect label="Store" width={320} options={options.stores} value={list("store")} onChange={(v) => set({ store: v })} />
            {STORE_DIMS.map((d) =>
              (options.dims[d.key]?.length ?? 0) > 1 ? (
                <MultiSelect key={d.key} label={d.label} options={options.dims[d.key].map((v) => ({ value: v, label: v }))} value={list(d.key)} onChange={(v) => set({ [d.key]: v })} />
              ) : null,
            )}
          </>
        )}
        {scope.sku && (
          <MultiSelect label="Price band" options={PRICE_BANDS.map((b) => ({ value: b.key, label: b.label }))} value={list("pb")} onChange={(v) => set({ pb: v })} />
        )}

        {dirty && (
          <button onClick={() => set(Object.fromEntries(["p", "from", "to", "cat", "store", "ch", "pb", ...STORE_DIMS.map((d) => d.key)].map((k) => [k, null])))}
            className="ml-auto flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] text-zinc-600 hover:bg-zinc-100">
            <RotateCcw className="size-3.5" /> Reset filters
          </button>
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-5 pb-2">
          {chips.map((c) => (
            <span key={c.k + c.v} className="flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-[12px] text-brand-700 ring-1 ring-brand-100">
              {c.label}
              <button aria-label={`Remove ${c.label}`} onClick={() => set({ [c.k]: list(c.k).filter((x) => x !== c.v) })} className="rounded-full p-0.5 hover:bg-brand-100">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
