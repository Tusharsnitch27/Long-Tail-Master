"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, CalendarDays } from "lucide-react";
import { filterScope } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { useQuery } from "@/components/filters/useQuery";

export interface ContextOptions {
  categories: { key: string; label: string; color: string }[];
  /** marketplaces with sales, per category key ("overall" = all categories) */
  marketplaces: Record<string, string[]>;
  asOf: string;
  today: string;
  freshness: { label: string; value: string }[];
}

const PERIODS = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" }, { key: "cw", label: "This week" },
  { key: "pw", label: "Last week" }, { key: "mtd", label: "MTD" }, { key: "l30", label: "L30" },
];
const CHANNELS = [{ key: "all", label: "Overall" }, { key: "stores", label: "Stores" }, { key: "online", label: "Online" }, { key: "marketplace", label: "Marketplace" }];

function Seg({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex h-8 items-center gap-0.5 rounded-lg border border-line bg-white p-0.5">
      {items.map((i) => (
        <button key={i.key} onClick={() => onChange(i.key)}
          className={cn("h-full whitespace-nowrap rounded-md px-2.5 text-[12.5px] transition-colors", value === i.key ? "bg-ink font-medium text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-ink")}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

function Dropdown({ label, value, items, onChange }: { label: string; value: string; items: { key: string; label: string; color?: string }[]; onChange: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const cur = items.find((i) => i.key === value) ?? items[0];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex h-8 items-center gap-2 rounded-lg border border-line bg-white px-2.5 text-[12.5px] hover:border-zinc-300">
        <span className="text-zinc-500">{label}</span>
        {cur?.color && <span className="size-2 rounded-full" style={{ background: cur.color }} />}
        <span className="font-medium">{cur?.label}</span>
        <ChevronDown className="size-3.5 text-zinc-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-50 min-w-44 rounded-lg border border-line bg-white p-1 shadow-lg">
          {items.map((i) => (
            <button key={i.key} onClick={() => { onChange(i.key); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-zinc-50">
              {i.color ? <span className="size-2 rounded-full" style={{ background: i.color }} /> : <span className="size-2" />}
              <span className="flex-1">{i.label}</span>
              {i.key === value && <Check className="size-3.5 text-brand-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ContextBar({ options }: { options: ContextOptions }) {
  const { sp, set, pending, path } = useQuery();
  const scope = filterScope(path);
  const cat = sp.get("cat") ?? "overall";
  const p = sp.get("p") ?? "mtd";
  const ch = sp.get("ch") ?? "all";
  const mp = sp.get("mp") ?? "";
  const custom = p === "custom";
  const show = scope.category || scope.period || scope.channel;

  return (
    <div className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
      <div className={cn("h-px w-full bg-brand-500 transition-opacity", pending ? "animate-pulse opacity-100" : "opacity-0")} />
      <div className="flex flex-wrap items-center gap-2 px-6 py-2.5">
        {scope.category && (
          <Dropdown label="Category" value={cat} onChange={(k) => set({ cat: k === "overall" ? null : k })}
            items={[{ key: "overall", label: "Overall", color: "#111114" }, ...options.categories]} />
        )}
        {scope.period && (
          <>
            <Seg items={[...PERIODS, { key: "custom", label: "Custom" }]} value={p} onChange={(k) => set(k === "custom" ? { p: "custom", from: sp.get("from") ?? options.asOf, to: sp.get("to") ?? options.asOf } : { p: k === "mtd" ? null : k, from: null, to: null })} />
            {custom && (
              <div className="flex h-8 items-center gap-1 rounded-lg border border-line bg-white px-2 text-[12.5px]">
                <CalendarDays className="size-3.5 text-zinc-400" />
                <input type="date" max={options.today} value={sp.get("from") ?? ""} onChange={(e) => set({ p: "custom", from: e.target.value })} className="bg-transparent outline-none" />
                <span className="text-zinc-400">→</span>
                <input type="date" max={options.today} value={sp.get("to") ?? ""} onChange={(e) => set({ p: "custom", to: e.target.value })} className="bg-transparent outline-none" />
              </div>
            )}
          </>
        )}
        {scope.channel && (
          <>
            <Seg items={CHANNELS} value={ch} onChange={(k) => set({ ch: k === "all" ? null : k, mp: null })} />
            {ch === "marketplace" && (options.marketplaces[cat] ?? []).length > 1 && (
              <Seg items={[{ key: "", label: "All" }, ...(options.marketplaces[cat] ?? []).map((m) => ({ key: m, label: m[0] + m.slice(1).toLowerCase() }))]} value={mp} onChange={(k) => set({ mp: k || null })} />
            )}
          </>
        )}
        {!show && <div className="h-8" />}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-zinc-500">
          {options.freshness.map((f) => (
            <span key={f.label} className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" />{f.label} <span className="font-medium text-zinc-700">{f.value}</span></span>
          ))}
        </div>
      </div>
    </div>
  );
}
