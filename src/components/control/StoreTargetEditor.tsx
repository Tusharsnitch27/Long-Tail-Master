"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Save, Search } from "lucide-react";
import { parseCsv, downloadCsv, parseMonth } from "@/lib/csv";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ConfirmChanges, type Change } from "./ConfirmChanges";

export interface StoreTargetRow { branch_code: string; store: string; city: string | null; state: string | null; uploaded: number | null; snowflake: number; mtd: number; live: boolean }

/**
 * Store × category month targets. When any store has an uploaded target for the month, uploaded targets replace the
 * Snowflake store targets for store-level views. The Stores category target is always the plan; store targets only spread it.
 */
export function StoreTargetEditor({ month, cat, catLabel, cats, rows, categoryTarget, readOnly }: {
  month: string; cat: string; catLabel: string; cats: { key: string; label: string }[]; rows: StoreTargetRow[]; categoryTarget: number | null; readOnly: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  type R = { branch_code: string; category: string; month: string; target: number | null };
  const [pend, setPend] = useState<{ list: R[]; source: "manual" | "upload"; changes: Change[] } | null>(null);
  const ask = (list: R[], source: "manual" | "upload") => {
    const changes = list.map((r) => {
      const row = rows.find((x) => x.branch_code === r.branch_code || x.store.toUpperCase() === r.branch_code.toUpperCase());
      const old = r.category === cat ? row?.uploaded ?? null : null;
      return { r, old, label: `${row?.store ?? r.branch_code} · ${cats.find((c) => c.key === r.category)?.label ?? r.category} · ${r.month.slice(0, 7)}` };
    }).filter((x) => x.old !== x.r.target).map((x) => ({ label: x.label, from: x.old == null ? "—" : inr(x.old), to: x.r.target == null ? "—" : inr(x.r.target) }));
    if (!changes.length) return setMsg({ ok: true, text: "No change — the targets already match." });
    setPend({ list, source, changes });
  };
  const val = (r: StoreTargetRow) => (r.branch_code in edit ? (edit[r.branch_code].trim() === "" ? null : Number(edit[r.branch_code])) : r.uploaded);
  const uploadedAny = rows.some((r) => r.uploaded != null) || Object.keys(edit).length > 0;
  const sum = rows.reduce((a, r) => a + (uploadedAny ? val(r) ?? 0 : r.snowflake), 0);
  const effective = categoryTarget ?? sum;
  const mismatch = categoryTarget != null && sum > categoryTarget * 1.005;
  const short = categoryTarget != null && sum > 0 && sum < categoryTarget * 0.995;
  const shown = useMemo(() => rows.filter((r) => !q || `${r.store} ${r.city} ${r.state} ${r.branch_code}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const dirty = Object.entries(edit).filter(([b, v]) => { const r = rows.find((x) => x.branch_code === b); const n = v.trim() === "" ? null : Number(v); return r && n !== r.uploaded; });

  async function post(list: { branch_code: string; category: string; month: string; target: number | null }[], source: "manual" | "upload") {
    setMsg(null);
    const res = await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "store_targets", source, rows: list }) });
    const j = await res.json();
    setPend(null);
    if (!res.ok) return setMsg({ ok: false, text: j.error ?? "Save failed" });
    setMsg({ ok: true, text: `${j.rows} store target${j.rows === 1 ? "" : "s"} saved and logged.` });
    setEdit({}); router.refresh();
  }
  async function upload(f: File) {
    const data = parseCsv(await f.text());
    const out: { branch_code: string; category: string; month: string; target: number | null }[] = [];
    const bad: number[] = [];
    data.forEach((r, i) => {
      const c = cats.find((x) => x.key === (r.category ?? "").toLowerCase() || x.label.toLowerCase() === (r.category ?? "").toLowerCase())?.key ?? (r.category ? null : cat);
      const m = r.month ? parseMonth(r.month) : month;
      const b = r.branch_code ?? r.store ?? r.store_name;
      const t = Number((r.target ?? "").replace(/[₹,]/g, ""));
      if (!c || !m || !b || !Number.isFinite(t)) { bad.push(i + 2); return; }
      out.push({ branch_code: b, category: c, month: m, target: t });
    });
    if (bad.length) return setMsg({ ok: false, text: `Couldn't read rows ${bad.slice(0, 8).join(", ")}. Expected columns: branch_code (or store), category, month, target (₹).` });
    ask(out, "upload");
  }
  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-4">
        <div><div className="text-[11px] text-zinc-500">Category Stores target</div><div className="tabular text-[16px] font-semibold">{categoryTarget != null ? inr(categoryTarget) : "Not set"}</div></div>
        <div><div className="text-[11px] text-zinc-500">Σ store targets {uploadedAny ? "(uploaded)" : "(Snowflake)"}</div><div className="tabular text-[16px] font-semibold">{inr(sum)}</div></div>
        <div><div className="text-[11px] text-zinc-500">Stores target used (plan)</div><div className="tabular text-[16px] font-semibold text-brand-700">{inr(effective)}</div></div>
        <div className={cn("rounded-lg px-3 py-2 text-[11.5px]", mismatch || short ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800")}>
          {mismatch ? `Store targets add up to ${inr(sum - (categoryTarget ?? 0))} more than the plan. The plan is used; trim store targets so they add up.` : categoryTarget != null && sum < categoryTarget * 0.995 ? `Store targets add up to ${inr(categoryTarget - sum)} less than the plan. The plan is used; allocate the rest to stores.` : categoryTarget == null ? "No plan target — store targets are used until one is set." : "Store targets add up to the plan."}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2"><Search className="size-3.5 text-zinc-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search store, city, state" className="w-48 text-[12.5px] outline-none" /></span>
        <span className="text-[11.5px] text-zinc-500">{rows.filter((r) => r.live).length} stores where {catLabel} is live · targets in ₹</span>
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => downloadCsv(`store-targets-${cat}-${month.slice(0, 7)}.csv`, [["branch_code", "store", "state", "category", "month", "target"], ...rows.map((r) => [r.branch_code, r.store, r.state, catLabel, month.slice(0, 7), val(r) ?? (uploadedAny ? "" : Math.round(r.snowflake))])])} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-zinc-600 hover:border-brand-300"><Download className="size-3.5" />Template / export</button>
          {!readOnly && <button onClick={() => file.current?.click()} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-zinc-600 hover:border-brand-300"><Upload className="size-3.5" />Upload CSV</button>}
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      </div>
      <div className="max-h-[520px] overflow-y-auto scroll-thin">
        <table className="w-full whitespace-nowrap text-[12.5px]">
          <thead className="sticky top-0 bg-white"><tr className="border-b border-line text-[11px] text-zinc-500">{["Store", "State", "Live", "Snowflake target", "Uploaded target", "MTD sales"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i > 2 ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.branch_code} className="border-b border-brand-50 hover:bg-brand-50/30">
              <td className="px-4 py-1.5"><span className="font-medium">{r.store}</span> <span className="text-[11px] text-zinc-400">{r.city} · {r.branch_code}</span></td>
              <td className="px-4 text-zinc-600">{r.state ?? "—"}</td>
              <td className="px-4">{r.live ? <span className="text-emerald-700">●</span> : <span className="text-zinc-300" title="No stock or sales of this category in the last 60 days">○</span>}</td>
              <td className="tabular px-4 text-right text-zinc-500">{r.snowflake ? inr(r.snowflake) : "—"}</td>
              <td className="px-4 text-right">{readOnly ? inr(val(r)) : <input value={r.branch_code in edit ? edit[r.branch_code] : r.uploaded ?? ""} onChange={(e) => setEdit((s) => ({ ...s, [r.branch_code]: e.target.value }))} placeholder="—" inputMode="numeric" className={cn("tabular h-7 w-28 rounded-md border px-2 text-right outline-none focus:border-brand-500", r.branch_code in edit ? "border-brand-500 bg-brand-50" : "border-line")} />}</td>
              <td className="tabular px-4 text-right">{inr(r.mtd)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-3">
        {!readOnly && <button disabled={!dirty.length} onClick={() => ask(dirty.map(([b, v]) => ({ branch_code: b, category: cat, month, target: v.trim() === "" ? null : Math.round(Number(v)) })), "manual")} className="flex items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-800 disabled:opacity-40"><Save className="size-3.5" />Save {dirty.length || ""} change{dirty.length === 1 ? "" : "s"}</button>}
        {msg && <span className={cn("text-[12px]", msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</span>}
      </div>
      <ConfirmChanges open={!!pend} title={pend?.source === "upload" ? "Apply uploaded store targets?" : "Save store target changes?"} changes={pend?.changes ?? []}
        note="Uploaded store targets replace the Snowflake store targets for that category and month. The Stores category target stays the plan figure; store targets spread it across stores."
        onCancel={() => setPend(null)} onConfirm={() => pend && post(pend.list, pend.source)} />
    </div>
  );
}
