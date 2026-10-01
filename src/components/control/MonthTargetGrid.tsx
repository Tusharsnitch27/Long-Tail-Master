"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Save, RotateCcw } from "lucide-react";
import { parseCsv, downloadCsv, parseMonth } from "@/lib/csv";
import { cn } from "@/lib/cn";
import { ConfirmChanges, type Change } from "./ConfirmChanges";

type Ch = "stores" | "online" | "marketplace";
const CH: { key: Ch | "overall"; label: string }[] = [{ key: "overall", label: "Overall" }, { key: "stores", label: "Stores (Offline)" }, { key: "online", label: "Online" }, { key: "marketplace", label: "Marketplace" }];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const L = 1e5;
const achCls = (a: number) => (a >= 0.95 ? "text-emerald-700" : a >= 0.8 ? "text-amber-700" : "text-rose-600");
const fmtL = (v: number | null | undefined) => (v == null ? "" : Number((v / L).toFixed(2)).toString());

/**
 * Month × category targets per channel, in ₹ lakhs (as in the business plan). Past months show the actual and
 * achievement; empty future cells are flagged as pending. Save writes only changed cells; every change is logged.
 */
export function MonthTargetGrid({ months, cats, values: serverValues, actuals, current, readOnly }: {
  months: string[]; cats: { key: string; label: string; color: string }[]; values: Record<string, number | null>; actuals: Record<string, number>; current: string; readOnly: boolean;
}) {
  const router = useRouter();
  const [ch, setCh] = useState<Ch | "overall">("overall");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // values confirmed by the database after a save (shown until the page data refreshes)
  const [confirmed, setConfirmed] = useState<Record<string, number | null>>({});
  const values = useMemo(() => ({ ...serverValues, ...confirmed }), [serverValues, confirmed]);
  useEffect(() => setConfirmed({}), [serverValues]);
  const file = useRef<HTMLInputElement>(null);
  type Row = { channel: Ch; category: string; month: string; target: number | null };
  const [pendingRows, setPendingRows] = useState<{ rows: Row[]; source: "manual" | "upload"; changes: Change[] } | null>(null);
  const CHL: Record<Ch, string> = { stores: "Stores", online: "Online", marketplace: "Marketplace" };
  const lbl = (v: number | null | undefined) => (v == null ? "—" : `${fmtL(v)} L`);
  const ask = (rows: Row[], source: "manual" | "upload") => {
    const changes = rows.map((r) => ({ r, old: values[key(r.channel, r.category, r.month)] ?? null }))
      .filter(({ r, old }) => !(r.target === old || (r.target != null && old != null && Math.abs(r.target - old) < 1)))
      .map(({ r, old }) => ({ label: `${CHL[r.channel]} · ${cats.find((c) => c.key === r.category)?.label ?? r.category} · ${MON[Number(r.month.slice(5, 7)) - 1]} ${r.month.slice(0, 4)}`, from: lbl(old), to: lbl(r.target) }));
    if (!changes.length) return setMsg({ ok: true, text: "Nothing to change — the targets already match." });
    setPendingRows({ rows, source, changes });
  };
  const key = (c: Ch, cat: string, m: string) => `${c}|${cat}|${m}`;
  const val = (c: Ch, cat: string, m: string): number | null => {
    const k = key(c, cat, m);
    if (k in edit) { const t = edit[k].trim(); return t === "" ? null : Number(t) * L; }
    return values[k] ?? null;
  };
  const cell = (cat: string, m: string) => (ch === "overall" ? (["stores", "online", "marketplace"] as Ch[]).reduce<number | null>((a, c) => { const v = val(c, cat, m); return v == null ? a : (a ?? 0) + v; }, null) : val(ch, cat, m));
  const act = (cat: string, m: string) => (ch === "overall" ? (["stores", "online", "marketplace"] as Ch[]).reduce((a, c) => a + (actuals[key(c, cat, m)] ?? 0), 0) : actuals[key(ch, cat, m)] ?? 0);
  const dirty = useMemo(() => Object.entries(edit).filter(([k, v]) => { const o = values[k]; const n = v.trim() === "" ? null : Number(v) * L; return n !== o && !(n != null && o != null && Math.abs(n - o) < 1); }), [edit, values]);
  const invalid = dirty.some(([, v]) => v.trim() !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0));
  const pending = months.filter((m) => m >= current).reduce((a, m) => a + cats.filter((c) => (["stores", "online", "marketplace"] as Ch[]).some((x) => val(x, c.key, m) == null)).length, 0);

  async function post(rows: { channel: Ch; category: string; month: string; target: number | null }[], source: "manual" | "upload") {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "month_targets", source, rows }) });
    const j = await res.json();
    setBusy(false);
    setPendingRows(null);
    if (!res.ok) return setMsg({ ok: false, text: j.error ?? "Save failed" });
    if (j.saved) setConfirmed((c) => ({ ...c, ...j.saved }));
    setMsg(j.mismatched ? { ok: false, text: `${j.mismatched} target(s) did not save as entered — please check and retry.` } : { ok: true, text: `${j.changed} target${j.changed === 1 ? "" : "s"} saved, logged and verified against the database.` });
    setEdit({}); router.refresh();
  }
  const save = () => ask(dirty.map(([k, v]) => { const [c, category, month] = k.split("|"); return { channel: c as Ch, category, month, target: v.trim() === "" ? null : Math.round(Number(v) * L) }; }), "manual");
  async function upload(f: File) {
    const rows = parseCsv(await f.text());
    const out: { channel: Ch; category: string; month: string; target: number | null }[] = [];
    const errs: string[] = [];
    rows.forEach((r, i) => {
      const c = (r.channel ?? "").toLowerCase().replace("offline", "stores").replace("marketplaces", "marketplace") as Ch;
      const cat = cats.find((x) => x.key === (r.category ?? "").toLowerCase() || x.label.toLowerCase() === (r.category ?? "").toLowerCase())?.key;
      const m = parseMonth(r.month ?? "");
      const t = r.target_lakhs ?? r.target_in_lakhs ?? r.target;
      if (!["stores", "online", "marketplace"].includes(c) || !cat || !m || t == null || !Number.isFinite(Number(t))) { errs.push(`row ${i + 2}`); return; }
      out.push({ channel: c, category: cat, month: m, target: t === "" ? null : Math.round(Number(t) * (r.target != null && r.target_lakhs == null && r.target_in_lakhs == null ? 1 : L)) });
    });
    if (errs.length) return setMsg({ ok: false, text: `Couldn't read ${errs.length} row(s): ${errs.slice(0, 6).join(", ")}. Expected columns: channel, category, month, target_lakhs.` });
    if (!out.length) return setMsg({ ok: false, text: "No rows found." });
    ask(out, "upload");
  }
  const template = () => downloadCsv("targets-template.csv", [["channel", "category", "month", "target_lakhs"], ...(["stores", "online", "marketplace"] as Ch[]).flatMap((c) => cats.flatMap((x) => months.map((m) => [c, x.label, m.slice(0, 7), fmtL(values[key(c, x.key, m)])])))]);

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="flex gap-0.5 rounded-lg border border-line p-0.5">
          {CH.map((c) => <button key={c.key} onClick={() => setCh(c.key)} className={cn("rounded-md px-2.5 py-1 text-[12.5px]", ch === c.key ? "bg-brand-900 font-medium text-white" : "text-zinc-600 hover:bg-brand-50")}>{c.label}</button>)}
        </div>
        <span className={cn("rounded-md px-2 py-0.5 text-[11.5px]", ch === "overall" ? "text-zinc-500" : "bg-brand-50 font-medium text-brand-800 ring-1 ring-brand-200")}>₹ lakhs · {ch === "overall" ? "sum of the three channels (read-only) — pick a channel to edit" : "white cells are editable · bronze = unsaved change"}</span>
        {pending > 0 && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-800 ring-1 ring-amber-200">{pending} upcoming category-months missing a channel target</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={template} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-zinc-600 hover:border-brand-300"><Download className="size-3.5" />Template / export</button>
          {!readOnly && <button onClick={() => file.current?.click()} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-zinc-600 hover:border-brand-300"><Upload className="size-3.5" />Upload CSV</button>}
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      </div>
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full whitespace-nowrap text-[12.5px]">
          <thead><tr className="border-b border-line bg-brand-50/50 text-[11px] text-zinc-500">
            <th className="sticky left-0 bg-[#faf6f0] px-3 py-2 text-left font-medium">Category</th>
            {months.map((m) => <th key={m} className={cn("px-2 py-2 text-right font-medium", m === current && "text-brand-700")}>{MON[Number(m.slice(5, 7)) - 1]} {m.slice(2, 4)}{m === current ? " · now" : m < current ? "" : ""}</th>)}
            <th className="px-3 py-2 text-right font-medium">FY total</th>
          </tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.key} className="border-b border-brand-50">
                <td className="sticky left-0 bg-white px-3 py-1.5 font-medium"><span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c.color }} />{c.label}</span></td>
                {months.map((m) => {
                  const v = cell(c.key, m), a = act(c.key, m), past = m <= current;
                  const k = ch !== "overall" ? key(ch, c.key, m) : null;
                  const isDirty = k != null && dirty.some(([d]) => d === k);
                  const ach = v ? a / v : null;
                  return (
                    <td key={m} className={cn("px-1 py-1 text-right align-top", m === current && "bg-brand-50/40")}>
                      {k && !readOnly ? (
                        <input value={k in edit ? edit[k] : fmtL(v)} onChange={(e) => setEdit((s) => ({ ...s, [k]: e.target.value }))} inputMode="decimal" placeholder={m >= current ? "pending" : "—"}
                          className={cn("tabular h-7 w-16 rounded-md border px-1.5 text-right shadow-[inset_0_1px_1px_rgba(60,40,20,.06)] outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20", isDirty ? "border-brand-600 bg-brand-100 font-semibold text-brand-900" : v == null && m >= current ? "border-dashed border-amber-400 bg-amber-50 placeholder:text-amber-600/80" : "border-zinc-300 bg-white hover:border-brand-400")} />
                      ) : <span className={cn("tabular inline-block h-7 w-16 px-1.5 leading-7", v == null && "text-zinc-300")}>{v == null ? "—" : fmtL(v)}</span>}
                      {past && v != null && <span className={cn("block pr-1.5 text-[10px] tabular", ach == null ? "text-zinc-400" : ach >= 0.95 ? "text-emerald-700" : ach >= 0.8 ? "text-amber-700" : "text-rose-600")}>{fmtL(a)} · {ach != null ? `${Math.round(ach * 100)}%` : "—"}</span>}
                    </td>
                  );
                })}
                <td className="tabular px-3 py-1.5 text-right align-top font-semibold">{fmtL(months.reduce((s, m) => s + (cell(c.key, m) ?? 0), 0))}{(() => { const done = months.filter((m) => m <= current); const t = done.reduce((s, m) => s + (cell(c.key, m) ?? 0), 0); const a = done.reduce((s, m) => s + (cell(c.key, m) != null ? act(c.key, m) : 0), 0); return t > 0 ? <span className={cn("block text-[10px] font-medium", achCls(a / t))} title="Actual ÷ target for months to date">{Math.round((100 * a) / t)}% YTD</span> : null; })()}</td>
              </tr>
            ))}
            <tr className="bg-brand-50/50 font-semibold">
              <td className="sticky left-0 bg-[#faf6f0] px-3 py-2">Total</td>
              {months.map((m) => {
                const t = cats.reduce((s, c) => s + (cell(c.key, m) ?? 0), 0);
                const a = cats.reduce((s, c) => s + (cell(c.key, m) != null ? act(c.key, m) : 0), 0);
                return <td key={m} className="tabular px-2 py-1.5 text-right align-top">{fmtL(t)}{m <= current && t > 0 && <span className={cn("block text-[10px] font-medium", achCls(a / t))}>{fmtL(a)} · {Math.round((100 * a) / t)}%</span>}</td>;
              })}
              {(() => {
                const t = months.reduce((s, m) => s + cats.reduce((u, c) => u + (cell(c.key, m) ?? 0), 0), 0);
                const tDone = months.filter((m) => m <= current).reduce((s, m) => s + cats.reduce((u, c) => u + (cell(c.key, m) ?? 0), 0), 0);
                const a = months.filter((m) => m <= current).reduce((s, m) => s + cats.reduce((u, c) => u + (cell(c.key, m) != null ? act(c.key, m) : 0), 0), 0);
                return <td className="tabular px-3 py-1.5 text-right align-top">{fmtL(t)}{tDone > 0 && <span className={cn("block text-[10px] font-medium", achCls(a / tDone))} title="Actual ÷ target for months to date">{Math.round((100 * a) / tDone)}% YTD</span>}</td>;
              })()}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {!readOnly && ch !== "overall" && <>
          <button disabled={!dirty.length || invalid || busy} onClick={save} className="flex items-center gap-1.5 rounded-lg bg-brand-900 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-800 disabled:opacity-40"><Save className="size-3.5" />Save {dirty.length ? `${dirty.length} change${dirty.length > 1 ? "s" : ""}` : "changes"}</button>
          {dirty.length > 0 && <button onClick={() => setEdit({})} className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-ink"><RotateCcw className="size-3.5" />Discard</button>}
        </>}
        {invalid && <span className="text-[12px] text-rose-600">Enter numbers in lakhs (e.g. 12.5).</span>}
        {msg && <span className={cn("text-[12px]", msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</span>}
        <span className="ml-auto text-[11px] text-zinc-500">Past months show actual · achievement under the target. Clear a cell to remove a target.</span>
      </div>
      <ConfirmChanges open={!!pendingRows} title={pendingRows?.source === "upload" ? "Apply uploaded targets?" : "Save target changes?"} changes={pendingRows?.changes ?? []} busy={busy}
        note="Targets drive achievement, projections and store actions across the tool."
        onCancel={() => setPendingRows(null)} onConfirm={() => pendingRows && post(pendingRows.rows, pendingRows.source)} />
    </div>
  );
}
