"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Option { value: string; label: string; hint?: string }

export function MultiSelect({ label, options, value, onChange, width = 260, pill = false }: {
  label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; width?: number;
  /** labelled filter-pill style (espresso when active) */ pill?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // open towards whichever side has room, so the panel never runs off-screen
  const [alignRight, setAlignRight] = useState(false);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<string[]>(value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) commit(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  });
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)) : options;
  }, [q, options]);
  const set = new Set(draft);
  function commit() {
    setOpen(false); setQ("");
    if (draft.join(",") !== value.join(",")) onChange(draft);
  }
  const toggle = (v: string) => setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));
  const allShownSelected = shown.length > 0 && shown.every((o) => set.has(o.value));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (open) return commit();
          const r = ref.current?.getBoundingClientRect();
          setAlignRight(!!r && r.left + width > window.innerWidth - 12);
          setOpen(true);
        }}
        className={pill ? cn(
          "flex h-8 items-center gap-1.5 rounded-lg border pl-2.5 pr-2 text-[12px] shadow-[0_1px_2px_rgba(60,40,20,.06)] transition-colors",
          value.length ? "border-brand-900 bg-brand-900 text-canvas" : "border-zinc-300 bg-white text-ink hover:border-brand-400",
        ) : cn(
          "flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-[13px] hover:border-zinc-400",
          value.length ? "border-brand-500 text-brand-700" : "border-zinc-300 text-zinc-700",
        )}
      >
        {pill ? <>
          <span className={cn("text-[10px] font-semibold uppercase tracking-[0.12em]", value.length ? "text-brand-300" : "text-zinc-400")}>{label}</span>
          <span className="max-w-36 truncate font-medium">{value.length === 0 ? "All" : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? value[0] : `${value.length} selected`}</span>
        </> : <>
          {label}
          {value.length > 0 && <span className="rounded bg-brand-500 px-1.5 text-[11px] font-semibold text-white">{value.length}</span>}
        </>}
        <ChevronDown className="size-3.5 opacity-60" />
      </button>
      {open && (
        <div className={cn("absolute top-10 z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_18px_40px_-16px_rgba(60,40,20,.45)]", alignRight ? "right-0" : "left-0")} style={{ width: Math.min(width, typeof window === "undefined" ? width : window.innerWidth - 24) }}>
          <div className="flex items-center gap-2 border-b border-zinc-100 px-2.5 py-2">
            <Search className="size-3.5 text-zinc-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full text-[13px] outline-none" onKeyDown={(e) => e.key === "Enter" && commit()} />
          </div>
          <div className="flex items-center justify-between border-b border-zinc-100 px-2.5 py-1.5 text-[12px]">
            <button className="font-medium text-brand-600 hover:underline" onClick={() =>
              setDraft(allShownSelected ? draft.filter((v) => !shown.some((o) => o.value === v)) : Array.from(new Set([...draft, ...shown.map((o) => o.value)])))}>
              {allShownSelected ? "Deselect" : "Select"} all{q ? " shown" : ""}
            </button>
            <button className="text-zinc-500 hover:text-zinc-800" onClick={() => setDraft([])}>Clear</button>
          </div>
          <div className="max-h-72 overflow-y-auto py-1 scroll-thin">
            {shown.length === 0 && <div className="px-3 py-3 text-[12px] text-zinc-500">No matches</div>}
            {shown.map((o) => (
              <button key={o.value} onClick={() => toggle(o.value)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-zinc-50">
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", set.has(o.value) ? "border-brand-500 bg-brand-500 text-white" : "border-zinc-300")}>
                  {set.has(o.value) && <Check className="size-3" />}
                </span>
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="ml-auto text-[11px] text-zinc-400">{o.hint}</span>}
              </button>
            ))}
          </div>
          <div className="flex justify-end border-t border-zinc-100 p-2">
            <button onClick={commit} className="rounded-md bg-brand-900 px-3 py-1 text-[12px] font-medium text-canvas">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
