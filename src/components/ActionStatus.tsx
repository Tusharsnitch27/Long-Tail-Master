"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, RotateCcw, AlarmClock, MessageSquarePlus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { RemarkForm, type RemarkTarget } from "./actions/RemarkForm";

const btn = "flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11.5px] text-zinc-600 transition-colors hover:border-brand-300 hover:text-ink disabled:opacity-40";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

/** Track what the team did with an action (open → done / dismissed). Kept for pages that only need status buttons. */
export function ActionStatus({ actionKey, status }: { actionKey: string; status: string }) {
  const router = useRouter();
  const [s, setS] = useState(status);
  const [busy, setBusy] = useState(false);
  async function update(next: string) {
    setBusy(true);
    const res = await fetch("/api/actions/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: actionKey, status: next }) });
    setBusy(false);
    if (res.ok) { setS(next); router.refresh(); }
  }
  if (s !== "open") return <button disabled={busy} onClick={() => update("open")} className={btn}><RotateCcw className="size-3" />{s === "done" ? "Done" : "Dismissed"} · reopen</button>;
  return (
    <span className="flex gap-1.5">
      <button disabled={busy} onClick={() => update("done")} className={btn}><Check className="size-3" />Done</button>
      <button disabled={busy} onClick={() => update("dismissed")} className={btn}><X className="size-3" />Dismiss</button>
    </span>
  );
}

/** Full action controls: done / dismiss / snooze / add remark (inline panel). */
export function ActionControls({ actionKey, status, target, links }: { actionKey: string; status: string; target: RemarkTarget; links?: React.ReactNode }) {
  const router = useRouter();
  const [s, setS] = useState(status);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!snoozeMenu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setSnoozeMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [snoozeMenu]);

  async function update(next: string) {
    setBusy(true);
    const res = await fetch("/api/actions/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: actionKey, status: next }) });
    setBusy(false);
    if (res.ok) { setS(next); router.refresh(); }
  }
  async function snooze(days: number, label: string) {
    setSnoozeMenu(false); setBusy(true);
    const res = await fetch("/api/remarks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "action", scope_id: actionKey, action_key: actionKey, kind: "snooze", until: plusDays(days), text: `Snoozed for ${label}`, category: target.category ?? null }) });
    setBusy(false);
    if (res.ok) { setMsg(`Snoozed for ${label}`); router.refresh(); } else setMsg("Could not snooze");
  }

  return (
    <div className="mt-3 border-t border-zinc-100 pt-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {links}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {msg && <span className="text-[11px] text-emerald-700">{msg}</span>}
          {s !== "open" ? (
            <button disabled={busy} onClick={() => update("open")} className={btn}><RotateCcw className="size-3" />{s === "done" ? "Done" : "Dismissed"} · reopen</button>
          ) : (
            <>
              <button disabled={busy} onClick={() => update("done")} className={cn(btn, "hover:border-emerald-300 hover:text-emerald-800")}><Check className="size-3" />Done</button>
              <div className="relative" ref={menuRef}>
                <button disabled={busy} onClick={() => setSnoozeMenu((x) => !x)} className={btn}><AlarmClock className="size-3" />Snooze<ChevronDown className="size-3" /></button>
                {snoozeMenu && (
                  <div className="absolute right-0 top-8 z-30 w-36 rounded-lg border border-line bg-white p-1 shadow-lg">
                    {([[3, "3 days"], [7, "1 week"], [14, "2 weeks"], [30, "30 days"]] as const).map(([d, l]) => (
                      <button key={d} onClick={() => snooze(d, l)} className="block w-full rounded-md px-2 py-1 text-left text-[12px] text-zinc-700 hover:bg-brand-50">{l}</button>
                    ))}
                  </div>
                )}
              </div>
              <button disabled={busy} onClick={() => update("dismissed")} className={btn}><X className="size-3" />Dismiss</button>
            </>
          )}
          <button onClick={() => setOpen((x) => !x)} className={cn(btn, open ? "border-brand-500 bg-brand-50 text-brand-800" : "border-brand-200 text-brand-700")}><MessageSquarePlus className="size-3" />Add remark</button>
        </span>
      </div>
      {open && <div className="mt-2.5"><RemarkForm target={{ ...target, actionKey }} compact onDone={() => setOpen(false)} /></div>}
    </div>
  );
}
