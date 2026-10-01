"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { VM_STAGES, VM_STATUSES, stageIndex } from "./vmStages";

async function post(body: unknown): Promise<{ ok: boolean; error?: string; id?: number }> {
  const res = await fetch("/api/vm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, id: j.id } : { ok: false, error: j.error ?? "Failed" };
}
const input = "rounded-md border border-line bg-white px-2 py-1 text-[12px]";

/** Admin: start a revamp for a store × category. */
export function VmCreateForm({ stores, cats, defaultCat }: { stores: { code: string; name: string; city: string | null }[]; cats: { key: string; label: string }[]; defaultCat?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ branch_code: "", category: defaultCat ?? cats[0]?.key ?? "", owner: "", target_date: "", note: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true); setMsg(null);
    const r = await post({ op: "create", ...f, owner: f.owner || null, target_date: f.target_date || null, note: f.note || null });
    setBusy(false);
    if (!r.ok) return setMsg(r.error ?? "Failed");
    setOpen(false); setF((x) => ({ ...x, branch_code: "", note: "" })); router.refresh();
  }
  if (!open) return <button onClick={() => setOpen(true)} className="flex items-center gap-1 rounded-md bg-brand-900 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-brand-800"><Plus className="size-3.5" />New revamp</button>;
  return (
    <div className="w-full rounded-xl border border-brand-200 bg-brand-50/40 p-3">
      <div className="mb-2 flex items-center justify-between text-[12.5px] font-semibold">Start a VM revamp<button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600"><X className="size-4" /></button></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <label className="col-span-2 flex flex-col gap-0.5 text-[11px] text-zinc-500">Store
          <select className={input} value={f.branch_code} onChange={(e) => set("branch_code", e.target.value)}>
            <option value="">Select a store…</option>
            {stores.map((s) => <option key={s.code} value={s.code}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Category<select className={input} value={f.category} onChange={(e) => set("category", e.target.value)}>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Owner<input className={input} value={f.owner} onChange={(e) => set("owner", e.target.value)} placeholder="Name" /></label>
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Target go-live<input type="date" className={input} value={f.target_date} onChange={(e) => set("target_date", e.target.value)} /></label>
        <div className="flex items-end"><button disabled={busy || !f.branch_code} onClick={save} className="w-full rounded-md bg-brand-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? "Saving…" : "Create"}</button></div>
        <label className="col-span-2 flex flex-col gap-0.5 text-[11px] text-zinc-500 md:col-span-6">Why this store? (first note)<input className={input} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. top-20 store by footfall, shoes at 40% of peer share, wall space available" /></label>
      </div>
      {msg && <div className="mt-2 text-[12px] text-rose-600">{msg}</div>}
    </div>
  );
}

/** Admin: one-click shortlist a suggested candidate. */
export function VmShortlistButton({ branch_code, category, reason }: { branch_code: string; category: string; reason: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  return (
    <button disabled={state === "busy" || state === "done"} title={state === "err" ? "Failed — try the New revamp form" : undefined}
      onClick={async () => { setState("busy"); const r = await post({ op: "create", branch_code, category, note: `Shortlisted from suggestions: ${reason}` }); setState(r.ok ? "done" : "err"); if (r.ok) router.refresh(); }}
      className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium", state === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : state === "err" ? "border-rose-200 text-rose-600" : "border-brand-300 text-brand-700 hover:bg-brand-50")}>
      {state === "done" ? <><Check className="size-3" />Shortlisted</> : state === "busy" ? "…" : <><Plus className="size-3" />Shortlist</>}
    </button>
  );
}

/** Move a card one stage forward (any signed-in user). */
export function VmAdvanceButton({ id, stage }: { id: number; stage: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = VM_STAGES[stageIndex(stage) + 1];
  if (!next) return null;
  return (
    <button disabled={busy} onClick={async () => { setBusy(true); const r = await post({ op: "update", id, stage: next.key }); setBusy(false); if (r.ok) router.refresh(); else alert(r.error); }}
      className="rounded px-1.5 py-0.5 text-[10.5px] font-medium text-brand-700 hover:bg-brand-50" title={`Move to ${next.label}`}>{busy ? "…" : `→ ${next.label}`}</button>
  );
}

/** Detail page: update stage / status / dates / owner and append a note. */
export function VmUpdateForm({ r, admin }: { r: { id: number; stage: string; status: string; owner: string | null; target_date: string | null; live_date: string | null; start_date: string | null }; admin: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ stage: r.stage, status: r.status, owner: r.owner ?? "", target_date: r.target_date ?? "", live_date: r.live_date ?? "", start_date: r.start_date ?? "", note: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true);
    const patch: Record<string, unknown> = { op: "update", id: r.id };
    if (f.stage !== r.stage) patch.stage = f.stage;
    if (f.status !== r.status) patch.status = f.status;
    if (f.owner !== (r.owner ?? "")) patch.owner = f.owner || null;
    if (f.target_date !== (r.target_date ?? "")) patch.target_date = f.target_date || null;
    if (f.live_date !== (r.live_date ?? "")) patch.live_date = f.live_date || null;
    if (f.start_date !== (r.start_date ?? "")) patch.start_date = f.start_date || null;
    if (f.note.trim()) patch.note = f.note.trim();
    if (Object.keys(patch).length === 2) { setBusy(false); return setMsg({ ok: false, text: "Nothing changed." }); }
    const res = await post(patch);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "Saved and logged." } : { ok: false, text: res.error ?? "Failed" });
    if (res.ok) { setF((x) => ({ ...x, note: "" })); router.refresh(); }
  }
  async function del() {
    if (!confirm("Delete this revamp and its note trail? This is logged.")) return;
    const res = await post({ op: "delete", id: r.id });
    if (res.ok) { router.push("/vm"); router.refresh(); } else setMsg({ ok: false, text: res.error ?? "Failed" });
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Stage<select className={input} value={f.stage} onChange={(e) => set("stage", e.target.value)}>{VM_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Status<select className={input} value={f.status} onChange={(e) => set("status", e.target.value)}>{VM_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Owner<input className={input} value={f.owner} onChange={(e) => set("owner", e.target.value)} /></label>
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Start<input type="date" className={input} value={f.start_date} onChange={(e) => set("start_date", e.target.value)} /></label>
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Target go-live<input type="date" className={input} value={f.target_date} onChange={(e) => set("target_date", e.target.value)} /></label>
        <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Live date<input type="date" className={input} value={f.live_date} onChange={(e) => set("live_date", e.target.value)} /></label>
      </div>
      <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Add a note<textarea rows={2} className={input} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Progress, blockers, what changed on the floor…" /></label>
      <div className="flex items-center gap-2">
        <button disabled={busy} onClick={save} className="rounded-md bg-brand-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? "Saving…" : "Save update"}</button>
        {msg && <span className={cn("text-[12px]", msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</span>}
        {admin && <button onClick={del} className="ml-auto flex items-center gap-1 text-[11.5px] text-zinc-400 hover:text-rose-600"><Trash2 className="size-3.5" />Delete</button>}
      </div>
      <p className="text-[11px] text-zinc-400">Moving to Live without a live date stamps today; the 28-day before / after read-out starts from the live date.</p>
    </div>
  );
}
