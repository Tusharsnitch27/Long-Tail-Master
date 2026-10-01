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
  freshness: { label: string; value: string; tip?: string; stale?: boolean }[];
}

const PERIODS = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" }, { key: "cw", label: "Current week" }, { key: "pw", label: "Previous week" },
  { key: "mtd", label: "MTD" }, { key: "l30", label: "Last 30" }, { key: "l90", label: "Last 90" }, { key: "pm", label: "Previous month" },
];
const CHANNELS = [{ key: "all", label: "Overall" }, { key: "stores", label: "Stores" }, { key: "online", label: "Online" }, { key: "marketplace", label: "Marketplace" }];

function Seg({ items, value, onChange, label }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void; label?: string }) {
  return (
    <div className="flex h-9 items-center gap-0.5 rounded-xl border border-zinc-300 bg-white p-0.5 shadow-[0_1px_2px_rgba(60,40,20,.06)]">
      {label && <span className="px-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-brand-600">{label}</span>}
      {items.map((i) => (
        <button key={i.key} onClick={() => onChange(i.key)}
          className={cn("h-full whitespace-nowrap rounded-lg px-2.5 text-[12.5px] transition-colors", value === i.key ? "bg-brand-900 font-medium text-canvas shadow-sm" : "text-zinc-700 hover:bg-brand-50 hover:text-ink")}>
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
      <button onClick={() => setOpen((o) => !o)} className={cn("flex h-9 items-center gap-2 rounded-xl border px-3 text-[12.5px] shadow-[0_1px_2px_rgba(60,40,20,.06)] transition-colors", value !== items[0]?.key ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/15" : "border-zinc-300 bg-white hover:border-brand-400")}>
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-brand-600">{label}</span>
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
    <div className="sticky top-0 z-30 border-b border-line bg-[#efe5d8]/90 shadow-[0_6px_18px_-14px_rgba(60,40,20,.45)] backdrop-blur-md">
      <div className={cn("h-px w-full bg-brand-500 transition-opacity", pending ? "animate-pulse opacity-100" : "opacity-0")} />
      <div className="flex flex-wrap items-center gap-2 px-6 py-2.5">
        {scope.category && (
          <Dropdown label="Category" value={cat} onChange={(k) => set({ cat: k === "overall" ? null : k })}
            items={[{ key: "overall", label: "Overall", color: "#1b1712" }, ...options.categories]} />
        )}
        {scope.period && (
          <>
            <Seg label="Period" items={[...PERIODS, { key: "custom", label: "Custom" }]} value={p} onChange={(k) => set(k === "custom" ? { p: "custom", from: sp.get("from") ?? options.asOf, to: sp.get("to") ?? options.asOf } : { p: k === "mtd" ? null : k, from: null, to: null })} />
            {custom && (
              <div className="flex h-9 items-center gap-1 rounded-xl border border-brand-500 bg-white px-2.5 text-[12.5px] ring-2 ring-brand-500/15">
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
            <Seg label="Channel" items={CHANNELS} value={ch} onChange={(k) => set({ ch: k === "all" ? null : k, mp: null })} />
            {ch === "marketplace" && (options.marketplaces[cat] ?? []).length > 1 && (
              <Seg label="Marketplace" items={[{ key: "", label: "All" }, ...(options.marketplaces[cat] ?? []).map((m) => ({ key: m, label: m[0] + m.slice(1).toLowerCase() }))]} value={mp} onChange={(k) => set({ mp: k || null })} />
            )}
          </>
        )}
        {!show && <div className="h-8" />}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          <span className="eyebrow !text-zinc-400">Updated</span>
          {options.freshness.map((f) => (
            <span key={f.label} className="flex items-center gap-1.5" title={f.tip}><span className={cn("size-1.5 rounded-full", f.stale ? "bg-amber-500" : "bg-emerald-500")} />{f.label} <span className="font-medium text-zinc-700">{f.value}</span></span>
          ))}
        </div>
      </div>
    </div>
  );
}
