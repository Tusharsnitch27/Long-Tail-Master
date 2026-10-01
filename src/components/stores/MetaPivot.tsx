"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { compactNum, inr, num, pct } from "@/lib/format";
import { ChartDownload } from "@/components/charts/ChartDownload";

type Cells = Record<string, Record<string, Record<string, [number, number, number, number]>>>;
const METRICS = [{ k: 0, label: "Revenue" }, { k: 1, label: "Units" }, { k: 2, label: "Stock now" }, { k: 4, label: "In transit" }, { k: 3, label: "Share of store" }] as const;
const MAXCOLS = 12;

/** Store × metafield heat map: which types / colours / attributes sell (or sit) in which store. */
export function MetaPivot({ attrs, stores, cells, qs }: { attrs: { key: string; label: string }[]; stores: { b: string; store: string; city: string | null }[]; cells: Cells; qs: string }) {
  const [attr, setAttr] = useState(attrs[0]?.key ?? "l1");
  const [metric, setMetric] = useState<(typeof METRICS)[number]["k"]>(0);
  const [q, setQ] = useState("");
  const data = cells[attr] ?? {};
  const base = metric === 3 ? 0 : metric === 4 ? 3 : metric; // share uses revenue; in transit = slot 3
  const { values, rows, colTot } = useMemo(() => {
    const vt = new Map<string, number>();
    for (const s of Object.values(data)) for (const [v, x] of Object.entries(s)) vt.set(v, (vt.get(v) ?? 0) + x[base]);
    const values = [...vt.entries()].filter(([, t]) => t > 0).sort((a, b) => b[1] - a[1]).slice(0, MAXCOLS).map(([v]) => v);
    const needle = q.trim().toLowerCase();
    const rows = stores.filter((s) => !needle || `${s.store} ${s.city ?? ""}`.toLowerCase().includes(needle)).map((s) => {
      const c = data[s.b] ?? {};
      const tot = Object.values(c).reduce((a, x) => a + x[base], 0);
      return { ...s, tot, v: values.map((v) => { const x = c[v]?.[base] ?? 0; return metric === 3 ? (tot ? x / tot : 0) : x; }) };
    }).filter((r) => r.tot > 0).sort((a, b) => b.tot - a.tot);
    return { values, rows, colTot: values.map((v) => vt.get(v) ?? 0) };
  }, [data, base, metric, q, stores]);
  const max = Math.max(...rows.flatMap((r) => r.v), 0) || 1;
  const fmt = (v: number) => (metric === 0 ? inr(v) : metric === 3 ? pct(v, 0) : compactNum(v));
  const label = attrs.find((a) => a.key === attr)?.label ?? attr;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Cut by</span>
        <div className="flex flex-wrap gap-1">
          {attrs.map((a) => <button key={a.key} onClick={() => setAttr(a.key)} className={cn("rounded-full border px-2.5 py-1 text-[12px] transition-colors", attr === a.key ? "border-brand-900 bg-brand-900 font-medium text-canvas" : "border-zinc-300 bg-white text-zinc-700 hover:border-brand-400")}>{a.label}</button>)}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-300 bg-white p-0.5">
            {METRICS.map((m) => <button key={m.k} onClick={() => setMetric(m.k)} className={cn("rounded-md px-2.5 py-1 text-[12px]", metric === m.k ? "bg-brand-900 font-medium text-canvas" : "text-zinc-600 hover:bg-brand-50")}>{m.label}</button>)}
          </div>
          <div className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15">
            <Search className="size-3.5 text-zinc-500" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a store" className="w-32 bg-transparent text-[12.5px] outline-none" />
          </div>
          <ChartDownload name={`stores-by-${label}-${(METRICS.find((m) => m.k === metric) ?? METRICS[0]).label}`} data={rows.map((r) => ({ store: r.store, city: r.city, ...Object.fromEntries(values.map((v, i) => [v, r.v[i]])), total: metric === 3 ? 1 : r.tot }))}
            columns={[{ key: "store", label: "Store" }, { key: "city", label: "City" }, ...values.map((v) => ({ key: v, label: v })), { key: "total", label: "Total" }]} />
        </div>
      </div>
      {!values.length ? <div className="px-4 py-10 text-center text-[12.5px] text-zinc-500">No {label.toLowerCase()} values for this scope — add metafields in the Control Centre (Products).</div> : (
        <div className="max-h-[560px] overflow-auto scroll-thin">
          <table className="w-full border-separate border-spacing-0 text-[12px]">
            <thead className="sticky top-0 z-10 bg-paper">
              <tr>
                <th className="sticky left-0 z-20 border-b border-line bg-paper px-3 py-2 text-left text-[11px] font-medium text-zinc-500">Store · {rows.length}</th>
                {values.map((v, i) => <th key={v} className="border-b border-line px-2 py-2 text-right text-[11px] font-medium text-zinc-600" title={`Network: ${fmt(metric === 3 ? colTot[i] / (colTot.reduce((a, x) => a + x, 0) || 1) : colTot[i])}`}><span className="block max-w-28 truncate">{v}</span></th>)}
                <th className="border-b border-line px-3 py-2 text-right text-[11px] font-medium text-zinc-500">{metric === 3 ? "" : "Total"}</th>
              </tr>
            </thead>
            <tbody>{rows.map((r) => (
              <tr key={r.b} className="group">
                <td className="sticky left-0 z-[1] border-b border-zinc-100 bg-white px-3 py-1.5 group-hover:bg-brand-50"><Link href={`/stores/${encodeURIComponent(r.b)}${qs ? `?${qs}` : ""}`} className="font-medium hover:underline">{r.store}</Link>{r.city && <span className="ml-1.5 text-[11px] text-zinc-400">{r.city}</span>}</td>
                {r.v.map((x, i) => {
                  const t = x / max;
                  return <td key={i} className="border-b border-white px-2 py-1.5 text-right tabular" style={{ background: x > 0 ? `rgba(168,112,63,${0.07 + t * 0.75})` : "#faf6f0", color: t > 0.55 ? "#fff" : undefined }} title={`${r.store} · ${values[i]}: ${fmt(x)}`}>{x > 0 ? fmt(x) : ""}</td>;
                })}
                <td className="border-b border-zinc-100 px-3 py-1.5 text-right font-semibold tabular">{metric === 3 ? "" : metric === 0 ? inr(r.tot) : num(r.tot)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="px-3 py-2 text-[11px] text-zinc-500">Top {MAXCOLS} {label.toLowerCase()} values by network {(METRICS.find((m) => m.k === metric) ?? METRICS[0]).label.toLowerCase()}. Revenue / units = store sales lines in the selected period; stock = latest store report; in transit = allocated to the store, not yet in its stock. Darker = more.</div>
    </div>
  );
}
