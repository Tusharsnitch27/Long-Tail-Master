"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Change { label: string; from: string; to: string }

/** Confirmation before any target change is written: lists every change (old → new). */
export function ConfirmChanges({ open, title, changes, note, busy, onConfirm, onCancel }: {
  open: boolean; title: string; changes: Change[]; note?: string; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-brand-900/40 p-4 backdrop-blur-[2px]" onClick={onCancel}>
      <div role="dialog" aria-modal="true" className="rise w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700"><AlertTriangle className="size-4" /></span>
          <div>
            <div className="text-[14.5px] font-semibold text-ink">{title}</div>
            <div className="text-[12px] text-zinc-500">{changes.length} change{changes.length === 1 ? "" : "s"} · every change is written to the change log</div>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-y-auto px-5 py-3 scroll-thin">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-[11px] text-zinc-500"><th className="pb-1.5 text-left font-medium">What</th><th className="pb-1.5 text-right font-medium">From</th><th className="pb-1.5 text-right font-medium">To</th></tr></thead>
            <tbody>{changes.slice(0, 200).map((c, i) => (
              <tr key={i} className="border-t border-brand-50">
                <td className="py-1.5 pr-2">{c.label}</td>
                <td className="tabular py-1.5 text-right text-zinc-500 line-through decoration-zinc-300">{c.from}</td>
                <td className={cn("tabular py-1.5 text-right font-semibold", c.to === "—" ? "text-rose-600" : "text-brand-800")}>{c.to}</td>
              </tr>
            ))}</tbody>
          </table>
          {changes.length > 200 && <div className="pt-2 text-[11.5px] text-zinc-500">+{changes.length - 200} more</div>}
          {note && <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-[11.5px] text-brand-900">{note}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onCancel} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-zinc-700 hover:border-zinc-300">Cancel</button>
          <button disabled={busy} onClick={onConfirm} className="rounded-lg bg-brand-700 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{busy ? "Saving…" : `Confirm ${changes.length} change${changes.length === 1 ? "" : "s"}`}</button>
        </div>
      </div>
    </div>
  );
}
