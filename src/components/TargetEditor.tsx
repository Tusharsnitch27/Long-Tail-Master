"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Save, RotateCcw } from "lucide-react";
import { inr } from "@/lib/format";
import { fmtDate, weekday } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { useQuery } from "./filters/useQuery";

export interface EditorRow {
  branch_code: string; store: string; city: string | null; region: string | null;
  base: number; effective: number; actual: number; override: number | null; note: string | null; updatedBy: string | null; updatedAt: string | null;
}
interface HistoryRow { id: number; category: string; branch_code: string; grain: string; period_start: string; old_target: number | null; new_target: number | null; action: string; note: string | null; changed_by: string; changed_at: string }

export function TargetEditor({ rows, month, months, cat, cats, grain, periods, period, catOverride, history, readOnly }: {
  rows: EditorRow[]; month: string; months: string[]; cat: string; cats: { key: string; label: string }[]; grain: "month" | "week" | "day";
  periods: string[]; period: string; catOverride: { target: number; note: string | null } | null; history: HistoryRow[]; readOnly: boolean;
}) {
  const router = useRouter();
  const { set } = useQuery();
  const [edits, setEdits] = useState<Record<string, { target: string; note: string }>>({});
  const [catEdit, setCatEdit] = useState<string>(catOverride ? String(catOverride.target) : "");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string; errors?: { row: number; message: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ text: string; result: Record<string, unknown> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => rows.filter((r) => !q || `${r.store} ${r.city} ${r.branch_code}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const changed = Object.entries(edits).filter(([b, e]) => {
    const r = rows.find((x) => x.branch_code === b)!;
    const v = e.target.trim() === "" ? null : Number(e.target);
    return v !== r.override || (e.note || null) !== (r.note || null);
  });
  const catChanged = (catEdit.trim() === "" ? null : Number(catEdit)) !== (catOverride?.target ?? null);
  const totals = rows.reduce((a, r) => {
    const e = edits[r.branch_code];
    const v = e ? (e.target.trim() === "" ? null : Number(e.target)) : r.override;
    return { base: a.base + r.base, eff: a.eff + r.effective, next: a.next + (v ?? r.base) };
  }, { base: 0, eff: 0, next: 0 });

  async function save() {
    setBusy(true); setMsg(null);
    const payload = changed.map(([b, e]) => ({ category: cat, branch_code: b, grain, period_start: period, target: e.target.trim() === "" ? null : Number(e.target), note: e.note || null }));
    if (catChanged && grain === "month") payload.push({ category: cat, branch_code: "*", grain: "month", period_start: `${month}-01`, target: catEdit.trim() === "" ? null : Number(catEdit), note: "category-level target" });
    const res = await fetch("/api/targets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: payload }) });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "err", text: j.error ?? "Save failed", errors: j.errors });
    setMsg({ tone: "ok", text: `Saved · ${j.created} created, ${j.updated} updated, ${j.deleted} cleared` });
    setEdits({});
    router.refresh();
  }

  async function upload(commit: boolean, text?: string) {
    const body = text ?? preview?.text;
    if (!body) return;
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/targets/upload${commit ? "?commit=1" : ""}`, { method: "POST", headers: { "content-type": "text/csv" }, body });
    const j = await res.json();
    setBusy(false);
    if (commit && res.ok) { setPreview(null); setMsg({ tone: "ok", text: `Upload applied · ${j.created} created, ${j.updated} updated, ${j.deleted} cleared, ${j.unchanged} unchanged` }); router.refresh(); return; }
    if (!res.ok) { setPreview(null); return setMsg({ tone: "err", text: j.error ?? "Upload has errors — nothing was saved", errors: j.errors }); }
    setPreview({ text: body, result: j });
  }

  const periodLabel = (p: string) => (grain === "month" ? month : grain === "week" ? `Week of ${fmtDate(p)}` : `${weekday(p)} ${fmtDate(p)}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3">
        <select aria-label="Month" value={month} onChange={(e) => set({ m: e.target.value, ps: null })} className="h-8 rounded-md border border-zinc-300 px-2 text-[13px]">
          {months.map((m) => <option key={m} value={m}>{new Date(m + "-01T00:00:00Z").toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</option>)}
        </select>
        <div className="flex rounded-md bg-zinc-100 p-0.5">
          {cats.map((c) => <button key={c.key} onClick={() => set({ tc: c.key })} className={cn("rounded px-2.5 py-1 text-[12.5px] font-medium", c.key === cat ? "bg-white shadow-sm" : "text-zinc-600")}>{c.label}</button>)}
        </div>
        <div className="flex rounded-md bg-zinc-100 p-0.5">
          {(["month", "week", "day"] as const).map((g) => <button key={g} onClick={() => set({ g: g === "month" ? null : g, ps: null })} className={cn("rounded px-2.5 py-1 text-[12.5px] font-medium capitalize", g === grain ? "bg-white shadow-sm" : "text-zinc-600")}>{g}</button>)}
        </div>
        {grain !== "month" && (
          <select aria-label="Period" value={period} onChange={(e) => set({ ps: e.target.value })} className="h-8 rounded-md border border-zinc-300 px-2 text-[13px]">
            {periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
          </select>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter stores…" className="h-8 rounded-md border border-zinc-300 px-2 text-[13px]" />
        <div className="ml-auto flex gap-2">
          <a href={`/api/targets/template?m=${month}&cat=${cat}`} className="flex h-8 items-center gap-1 rounded-md border border-zinc-300 px-2.5 text-[12.5px]"><Download className="size-3.5" />Template CSV</a>
          <button disabled={readOnly || busy} onClick={() => fileRef.current?.click()} className="flex h-8 items-center gap-1 rounded-md border border-zinc-300 px-2.5 text-[12.5px] disabled:opacity-50"><Upload className="size-3.5" />Upload CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await upload(false, await f.text()); }} />
        </div>
      </div>

      {msg && (
        <div className={cn("rounded-lg border px-3 py-2 text-[12.5px]", msg.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900")}>
          {msg.text}
          {msg.errors && <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5">{msg.errors.slice(0, 50).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>}
        </div>
      )}
      {preview && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900">
          <span>Upload preview: <b>{String(preview.result.valid)}</b> valid rows · total {inr(Number(preview.result.total))} · {String(preview.result.clears)} clears. Nothing saved yet.</span>
          <button disabled={busy} onClick={() => upload(true)} className="rounded-md bg-sky-700 px-3 py-1 font-medium text-white">Apply upload</button>
          <button onClick={() => setPreview(null)} className="text-sky-800 underline">Cancel</button>
        </div>
      )}

      {grain === "month" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[13px]">
          <div><b>Category target</b> · {cats.find((c) => c.key === cat)?.label} · {month}</div>
          <span className="text-zinc-600">Store targets sum to {inr(totals.next)} after edits</span>
          <input disabled={readOnly} inputMode="decimal" value={catEdit} onChange={(e) => setCatEdit(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Optional — scales all stores"
            className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-2 text-right tabular" />
          {catOverride && <span className="text-[12px] text-amber-800">Active: {inr(catOverride.target)}</span>}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="max-h-[560px] overflow-auto scroll-thin">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Store</th><th className="px-2 text-right">Snowflake base</th><th className="px-2 text-right">Current effective</th>
                <th className="px-2 text-right">Actual to date</th><th className="px-2 text-right">Override ({grain})</th><th className="px-2 text-left">Note</th><th className="px-3 text-left">Last change</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const e = edits[r.branch_code];
                const val = e ? e.target : r.override == null ? "" : String(r.override);
                const dirty = changed.some(([b]) => b === r.branch_code);
                return (
                  <tr key={r.branch_code} className={cn("border-t border-zinc-100", dirty && "bg-amber-50")}>
                    <td className="px-3 py-1"><div className="font-medium">{r.store}</div><div className="text-[11px] text-zinc-400">#{r.branch_code} · {r.city}</div></td>
                    <td className="tabular px-2 text-right">{inr(r.base, { compact: false })}</td>
                    <td className={cn("tabular px-2 text-right", Math.abs(r.effective - r.base) > 1 && "font-semibold text-amber-700")}>{inr(r.effective, { compact: false })}</td>
                    <td className="tabular px-2 text-right text-zinc-600">{inr(r.actual, { compact: false })}</td>
                    <td className="px-2 text-right">
                      <input disabled={readOnly} inputMode="decimal" aria-label={`Override for ${r.store}`} value={val} placeholder="—"
                        onChange={(ev) => setEdits((x) => ({ ...x, [r.branch_code]: { target: ev.target.value.replace(/[^\d.]/g, ""), note: x[r.branch_code]?.note ?? r.note ?? "" } }))}
                        className="h-7 w-32 rounded border border-zinc-300 px-2 text-right tabular" />
                    </td>
                    <td className="px-2">
                      <input disabled={readOnly} aria-label={`Note for ${r.store}`} value={e ? e.note : r.note ?? ""} placeholder="Reason"
                        onChange={(ev) => setEdits((x) => ({ ...x, [r.branch_code]: { target: x[r.branch_code]?.target ?? (r.override == null ? "" : String(r.override)), note: ev.target.value } }))}
                        className="h-7 w-44 rounded border border-zinc-300 px-2" />
                    </td>
                    <td className="px-3 text-[11px] text-zinc-500">{r.updatedBy ? `${r.updatedBy.split("@")[0]} · ${r.updatedAt?.slice(0, 16)}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 bg-brand-50 font-semibold">
              <tr><td className="px-3 py-2">Total ({rows.length} stores)</td><td className="tabular px-2 text-right">{inr(totals.base)}</td><td className="tabular px-2 text-right">{inr(totals.eff)}</td><td /><td className="tabular px-2 text-right">{inr(totals.next)}</td><td colSpan={2} /></tr>
            </tfoot>
          </table>
        </div>
        <div className="flex items-center gap-2 border-t border-zinc-100 p-3">
          <span className="text-[12.5px] text-zinc-600">{changed.length + (catChanged ? 1 : 0)} unsaved change(s). Clear a value to remove the override.</span>
          <button onClick={() => { setEdits({}); setCatEdit(catOverride ? String(catOverride.target) : ""); }} className="ml-auto flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-zinc-600 hover:bg-zinc-100"><RotateCcw className="size-3.5" />Discard</button>
          <button disabled={readOnly || busy || (changed.length === 0 && !catChanged)} onClick={save} className="flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"><Save className="size-3.5" />Save changes</button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-2.5 text-[13.5px] font-semibold">Target history · {cats.find((c) => c.key === cat)?.label}</div>
        <div className="max-h-80 overflow-auto scroll-thin">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-zinc-50 text-[11px] uppercase text-zinc-500"><tr>{["When", "Who", "Action", "Store", "Grain", "Period", "Old", "New", "Note"].map((h) => <th key={h} className="px-3 py-1.5 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-zinc-500">No changes recorded yet.</td></tr>}
              {history.map((h) => (
                <tr key={h.id} className="border-t border-zinc-100">
                  <td className="px-3 py-1">{h.changed_at.slice(0, 16)}</td><td className="px-3">{h.changed_by}</td><td className="px-3 capitalize">{h.action}</td>
                  <td className="px-3">{h.branch_code === "*" ? "All (category)" : rows.find((r) => r.branch_code === h.branch_code)?.store ?? h.branch_code}</td>
                  <td className="px-3">{h.grain}</td><td className="px-3">{h.period_start}</td>
                  <td className="tabular px-3">{h.old_target == null ? "—" : inr(h.old_target, { compact: false })}</td><td className="tabular px-3">{h.new_target == null ? "cleared" : inr(h.new_target, { compact: false })}</td><td className="px-3">{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
