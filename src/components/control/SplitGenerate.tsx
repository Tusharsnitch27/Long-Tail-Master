"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { ConfirmChanges, type Change } from "./ConfirmChanges";
import { cn } from "@/lib/cn";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const L: Record<string, string> = { actual: "actual shape", recommended: "recommendation", manual: "custom", upload: "uploaded", even: "even" };

/** Fill daily splits for the financial year: actual sales shape for past months, the recommendation for upcoming months. */
export function SplitGenerate({ months, readOnly }: { months: string[]; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [pend, setPend] = useState<Change[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const call = async (dryRun: boolean) => {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "split_generate", months, overwrite, dryRun }) });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Failed" }); return null; }
    return j as { plan: { month: string; channel: string; from: string; to: string; skip: boolean }[]; written?: number };
  };
  const preview = async () => {
    const j = await call(true);
    if (!j) return;
    const ch = j.plan.filter((x) => !x.skip).map((x) => ({ label: `${MON[Number(x.month.slice(5, 7)) - 1]} ${x.month.slice(0, 4)} · ${x.channel}`, from: L[x.from] ?? x.from, to: L[x.to] }));
    const kept = j.plan.filter((x) => x.skip).length;
    if (!ch.length) return setMsg({ ok: true, text: `Nothing to generate — ${kept} custom split(s) kept.` });
    setPend(ch);
    if (kept) setMsg({ ok: true, text: `${kept} custom split(s) will be kept (tick “replace custom” to overwrite).` });
  };
  const run = async () => {
    const j = await call(false);
    setPend(null);
    if (j) { setMsg({ ok: true, text: `${j.written} split(s) written and logged.` }); router.refresh(); }
  };
  if (readOnly) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={busy} onClick={preview} className="flex items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-800 disabled:opacity-50"><Sparkles className="size-3.5" />{busy ? "Working…" : "Generate splits for the year"}</button>
      <label className="flex items-center gap-1.5 text-[12px] text-zinc-600"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />replace custom splits</label>
      {msg && <span className={cn("text-[12px]", msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</span>}
      <ConfirmChanges open={!!pend} title="Generate daily splits?" changes={pend ?? []} busy={busy}
        note="Past months take the actual daily shape of gross sales; upcoming months take the recommendation (weekday × salary-week / month pattern × festive uplifts). Everything stays editable."
        onCancel={() => setPend(null)} onConfirm={run} />
    </div>
  );
}
