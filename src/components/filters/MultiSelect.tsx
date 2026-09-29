"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Option { value: string; label: string; hint?: string }

export function MultiSelect({ label, options, value, onChange, width = 260 }: {
  label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; width?: number;
}) {
  const [open, setOpen] = useState(false);
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
        onClick={() => (open ? commit() : setOpen(true))}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-[13px] hover:border-zinc-400",
          value.length ? "border-brand-500 text-brand-700" : "border-zinc-300 text-zinc-700",
        )}
      >
        {label}
        {value.length > 0 && <span className="rounded bg-brand-500 px-1.5 text-[11px] font-semibold text-white">{value.length}</span>}
        <ChevronDown className="size-3.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-50 rounded-lg border border-zinc-200 bg-white shadow-lg" style={{ width }}>
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
            <button onClick={commit} className="rounded-md bg-zinc-900 px-3 py-1 text-[12px] font-medium text-white">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
