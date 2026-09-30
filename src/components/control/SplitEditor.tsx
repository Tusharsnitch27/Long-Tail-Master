"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Save, Wand2, Equal } from "lucide-react";
import { parseCsv } from "@/lib/csv";
import { cn } from "@/lib/cn";
import { ConfirmChanges, type Change } from "./ConfirmChanges";

type Ch = "stores" | "online" | "marketplace";
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Daily phasing of a month target, as % of the month per day. One split per channel (and per state for Stores;
 * "All India" applies wherever a state has none). No split = even phasing. Saved weights are normalised when used.
 */
export function SplitEditor({ month, days, states, saved, suggested, recommended, sources, events, readOnly }: {
  month: string; days: string[]; states: string[];
  /** model recommendation per channel (weekday × day-of-month × festive uplift), % of month per day */
  recommended: Record<Ch, { day: string; weight: number }[]>;
  /** where each saved split came from: `${channel}|${state}` → actual | recommended | manual | upload */
  sources: Record<string, string>;
  /** festive / sale events per day */
  events: Record<string, string[]>;
  /** saved weights: `${channel}|${state}` → day → weight */
  saved: Record<string, Record<string, number>>;
  /** weekday pattern from the last 8 weeks of actual sales: channel → Mon..Sun share */
  suggested: Record<Ch, number[]>;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [ch, setCh] = useState<Ch>("stores");
  const [state, setState] = useState("*");
  const k = `${ch}|${state}`;
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [pend, setPend] = useState<{ weights: { day: string; weight: number }[] | null; source: "manual" | "upload"; changes: Change[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = (weights: { day: string; weight: number }[] | null, source: "manual" | "upload" = "manual") => {
    const oldPct = (d: string) => (base ? (100 * (base[d] ?? 0)) / (baseTot || 1) : 100 / days.length);
    const t = weights ? weights.reduce((a, x) => a + x.weight, 0) || 1 : 0;
    const changes = weights == null
      ? [{ label: "All days", from: "custom split", to: "even phasing" }]
      : days.map((d) => ({ d, n: (100 * (weights.find((x) => x.day === d)?.weight ?? 0)) / t })).filter((x) => Math.abs(x.n - oldPct(x.d)) >= 0.01)
          .map((x) => ({ label: `${Number(x.d.slice(8))} ${new Date(x.d + "T00:00:00Z").toLocaleString("en-IN", { month: "short", timeZone: "UTC" })}`, from: `${oldPct(x.d).toFixed(2)}%`, to: `${x.n.toFixed(2)}%` }));
    if (!changes.length) return setMsg({ ok: true, text: "No change — the split already matches." });
    setPend({ weights, source, changes });
  };
  const base = saved[k];
  const baseTot = base ? Object.values(base).reduce((a, x) => a + x, 0) : 0;
  const pctOf = (d: string) => (draft[k]?.[d] != null ? draft[k][d] : base ? ((100 * (base[d] ?? 0)) / (baseTot || 1)).toFixed(2) : (100 / days.length).toFixed(2));
  const sum = useMemo(() => days.reduce((a, d) => a + (Number(pctOf(d)) || 0), 0), [draft, k, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const offset = (new Date(days[0] + "T00:00:00Z").getUTCDay() + 6) % 7;
  const setAll = (f: (d: string, i: number) => number) => setDraft((s) => ({ ...s, [k]: Object.fromEntries(days.map((d, i) => [d, f(d, i).toFixed(2)])) }));
  const even = () => setAll(() => 100 / days.length);
  const useRec = () => { const r = recommended[ch]; const t = r.reduce((a, x) => a + x.weight, 0) || 1; setAll((d) => (100 * (r.find((x) => x.day === d)?.weight ?? 0)) / t); };
  const pattern = () => {
    const w = suggested[ch];
    const raw = days.map((d) => w[(new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7] || 1 / 7);
    const t = raw.reduce((a, x) => a + x, 0);
    setAll((_, i) => (100 * raw[i]) / t);
  };
  async function save(weights: { day: string; weight: number }[] | null, source: "manual" | "upload" = "manual") {
    setMsg(null); setBusy(true);
    const res = await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "splits", source, channel: ch, state, month, weights }) });
    const j = await res.json();
    setBusy(false); setPend(null);
    if (!res.ok) return setMsg({ ok: false, text: j.error ?? "Save failed" });
    setMsg({ ok: true, text: weights ? "Split saved and logged." : "Split cleared — even phasing applies." });
    setDraft((s) => { const n = { ...s }; delete n[k]; return n; });
    router.refresh();
  }
  async function upload(f: File) {
    const rows = parseCsv(await f.text());
    const w = rows.map((r) => ({ day: (r.date ?? r.day ?? "").slice(0, 10), weight: Number((r.weight_pct ?? r.pct ?? r.weight ?? "").replace("%", "")) })).filter((x) => days.includes(x.day) && Number.isFinite(x.weight));
    if (!w.length) return setMsg({ ok: false, text: `No rows for ${month.slice(0, 7)}. Expected columns: date (YYYY-MM-DD), weight_pct.` });
    ask(w, "upload");
  }
  const has = Boolean(base);
  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="flex gap-0.5 rounded-lg border border-line p-0.5">
          {(["stores", "online", "marketplace"] as Ch[]).map((c) => <button key={c} onClick={() => { setCh(c); if (c !== "stores") setState("*"); }} className={cn("rounded-md px-2.5 py-1 text-[12.5px] capitalize", ch === c ? "bg-brand-700 font-medium text-white" : "text-zinc-600 hover:bg-brand-50")}>{c}</button>)}
        </div>
        {ch === "stores" && (
          <select value={state} onChange={(e) => setState(e.target.value)} className="h-8 rounded-lg border border-line bg-white px-2 text-[12.5px]">
            <option value="*">All India (default)</option>
            {states.map((s) => <option key={s} value={s.toUpperCase()}>{s}{saved[`stores|${s.toUpperCase()}`] ? " · custom" : ""}</option>)}
          </select>
        )}
        <span className={cn("rounded-md px-2 py-0.5 text-[11.5px] ring-1", !has ? "bg-zinc-100 text-zinc-600 ring-zinc-200" : sources[k] === "actual" ? "bg-brand-50 text-brand-800 ring-brand-200" : sources[k] === "recommended" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200")}>
          {!has ? (ch === "stores" && state !== "*" ? "Uses All India split" : "Even phasing (no split saved)") : sources[k] === "actual" ? "Actual shape of sales" : sources[k] === "recommended" ? "Recommended — edit freely" : "Custom split saved"}</span>
        <div className="ml-auto flex gap-1.5">
          <button onClick={even} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-zinc-600 hover:border-brand-300"><Equal className="size-3.5" />Even</button>
          <button onClick={useRec} className="flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2 py-1 text-[12px] font-medium text-brand-800 hover:border-brand-500" title="Weekday pattern (last 12 weeks) × day-of-month pattern incl. salary days (last 6 months) × festive / sale uplifts"><Wand2 className="size-3.5" />Use recommendation</button>
          <button onClick={pattern} className="rounded-md border border-line px-2 py-1 text-[12px] text-zinc-600 hover:border-brand-300" title="Weekday pattern of actual sales in the last 8 weeks">Weekday only</button>
          {!readOnly && <button onClick={() => file.current?.click()} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-zinc-600 hover:border-brand-300"><Upload className="size-3.5" />Upload CSV</button>}
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5 p-4">
        {WD.map((w) => <div key={w} className="text-center text-[10.5px] font-medium uppercase tracking-wider text-zinc-400">{w}</div>)}
        {Array.from({ length: offset }, (_, i) => <div key={`x${i}`} />)}
        {days.map((d) => {
          const v = pctOf(d), wk = (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7 >= 5, ev = events[d];
          return (
            <label key={d} title={ev?.join(" · ")} className={cn("rounded-lg border px-2 py-1.5", ev ? "border-amber-300 bg-amber-50/70" : wk ? "border-brand-200 bg-brand-50/50" : "border-line")}>
              <span className="flex items-center justify-between text-[10.5px] text-zinc-500"><span>{Number(d.slice(8))}</span>{ev && <span className="truncate pl-1 text-[9.5px] font-medium text-amber-800">{ev[0]}</span>}</span>
              <input disabled={readOnly} value={v} onChange={(e) => setDraft((s) => ({ ...s, [k]: { ...Object.fromEntries(days.map((x) => [x, pctOf(x)])), [d]: e.target.value } }))}
                className="tabular w-full bg-transparent text-[13px] font-semibold outline-none" inputMode="decimal" />
              <span className="text-[10px] text-zinc-400">% of month</span>
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
        <span className={cn("tabular text-[12.5px] font-semibold", Math.abs(sum - 100) < 0.5 ? "text-emerald-700" : "text-amber-700")}>Total {sum.toFixed(1)}%</span>
        {Math.abs(sum - 100) >= 0.5 && <span className="text-[11.5px] text-zinc-500">Weights are normalised to 100% when saved.</span>}
        {!readOnly && <button disabled={!draft[k]} onClick={() => ask(days.map((d) => ({ day: d, weight: Number(pctOf(d)) || 0 })))} className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-800 disabled:opacity-40"><Save className="size-3.5" />Save split</button>}
        {!readOnly && has && <button onClick={() => ask(null)} className="text-[12px] text-zinc-500 hover:text-rose-600">Clear split</button>}
        {msg && <span className={cn("text-[12px]", msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</span>}
      </div>
      <ConfirmChanges open={!!pend} title={`Change the ${ch} daily split${ch === "stores" ? ` (${state === "*" ? "All India" : state})` : ""} for ${month.slice(0, 7)}?`} changes={pend?.changes ?? []} busy={busy}
        note="Shares are % of the month target per day; they are normalised to 100%." onCancel={() => setPend(null)} onConfirm={() => pend && save(pend.weights, pend.source)} />
    </div>
  );
}
