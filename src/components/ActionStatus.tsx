"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, RotateCcw } from "lucide-react";

/** Track what the team did with an action (open → done / dismissed). */
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
  const btn = "flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] text-zinc-600 hover:border-zinc-300 hover:text-ink disabled:opacity-40";
  if (s !== "open") return <button disabled={busy} onClick={() => update("open")} className={btn}><RotateCcw className="size-3" />{s === "done" ? "Done" : "Dismissed"} · reopen</button>;
  return (
    <span className="flex gap-1.5">
      <button disabled={busy} onClick={() => update("done")} className={btn}><Check className="size-3" />Done</button>
      <button disabled={busy} onClick={() => update("dismissed")} className={btn}><X className="size-3" />Dismiss</button>
    </span>
  );
}
