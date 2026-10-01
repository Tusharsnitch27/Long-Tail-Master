"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendChart } from "@/components/charts/TrendChart";
import { DataTable, type Col, type ColType } from "@/components/table/DataTable";
import { inr, num, pct, signedPct } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

/** Trusted renderers for model-specified views. Data always comes from server-side tool results. */
export interface ViewData {
  type: "kpi" | "table" | "bar" | "line" | "area" | "comparison" | "heatmap";
  title: string;
  x: string | null;
  y: string[] | null;
  group: string | null;
  columns: string[] | null;
  rows: Record<string, unknown>[];
  formats: Record<string, string>;
  labels: Record<string, string>;
  kpiValues?: { label: string; value: unknown; format: string | null }[];
}

export function fmtValue(v: unknown, f?: string | null): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    switch (f) {
      case "inr": return inr(v);
      case "pct": return pct(v);
      case "delta": return signedPct(v);
      case "dec": return num(v, 2);
      default: return num(v, Number.isInteger(v) ? 0 : 1);
    }
  }
  const s = String(v);
  if (f === "datetime" || /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }
  if (f === "date" && /^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s, true);
  return s;
}

const COL: Record<string, ColType> = { inr: "inr", num: "num", dec: "dec", pct: "pct", delta: "delta", date: "date", datetime: "text", text: "text" };
const COLORS = ["#a8703f", "#2e6f73", "#1b1712", "#d3b089", "#a8506a", "#7d7340"]; // Atelier series palette
const isDateField = (rows: Record<string, unknown>[], x: string) => rows.every((r) => typeof r[x] === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(String(r[x])));

const VIEW_LABEL: Record<string, string> = { kpi: "KPIs", table: "Table", bar: "Chart", line: "Trend", area: "Trend", comparison: "Comparison", heatmap: "Heatmap" };

export function View({ v }: { v: ViewData }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(60,40,20,.04)]">
      <div className="flex items-center gap-2 border-b border-line bg-brand-50/40 px-3.5 py-2">
        <span className="rounded bg-brand-100 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider text-brand-800">{VIEW_LABEL[v.type] ?? v.type}</span>
        <span className="text-[12.5px] font-semibold text-ink">{v.title}</span>
      </div>
      <div className="p-3.5"><Body v={v} /></div>
    </div>
  );
}

function Body({ v }: { v: ViewData }) {
  if (v.type === "kpi") {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {(v.kpiValues ?? []).map((k) => (
          <div key={k.label} className="rounded-lg bg-brand-50/50 px-3 py-2 ring-1 ring-brand-100">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">{k.label}</div>
            <div className="tabular mt-0.5 text-[18px] font-semibold">{fmtValue(k.value, k.format)}</div>
          </div>
        ))}
      </div>
    );
  }
  if (v.type === "comparison") {
    const items = v.kpiValues ?? [];
    return (
      <table className="w-full text-[12.5px]">
        <tbody>
          {items.map((k) => (
            <tr key={k.label} className="border-b border-zinc-100 last:border-0">
              <td className="py-1.5 text-zinc-600">{k.label}</td>
              <td className={cn("tabular py-1.5 text-right font-medium", k.format === "delta" && typeof k.value === "number" && (k.value < 0 ? "text-rose-700" : "text-emerald-700"))}>{fmtValue(k.value, k.format)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (v.type === "table") {
    const cols: Col[] = (v.columns ?? []).map((k) => ({ key: k, label: v.labels[k] ?? k, type: COL[v.formats[k]] ?? "text" }));
    return <DataTable rows={v.rows} columns={cols} csvName={v.title.replace(/\W+/g, "-").toLowerCase()} height={360} />;
  }
  if (v.type === "heatmap" && v.x && v.group && v.y?.[0]) {
    const cols = Array.from(new Set(v.rows.map((r) => String(r[v.x!]))));
    const rowsK = Array.from(new Set(v.rows.map((r) => String(r[v.group!]))));
    const val = new Map(v.rows.map((r) => [`${r[v.group!]}|${r[v.x!]}`, r[v.y![0]] as number]));
    const vals = [...val.values()].filter((n) => typeof n === "number");
    const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
    const f = v.formats[v.y[0]];
    return (
      <div className="overflow-auto scroll-thin">
        <table className="text-[11px]"><thead><tr><th />{cols.map((c) => <th key={c} className="px-1 font-medium text-zinc-500">{fmtValue(c, "date")}</th>)}</tr></thead>
          <tbody>{rowsK.map((rk) => (
            <tr key={rk}><td className="whitespace-nowrap pr-2">{rk}</td>{cols.map((c) => {
              const n = val.get(`${rk}|${c}`);
              const t = typeof n === "number" ? (n - min) / (max - min || 1) : null;
              return <td key={c} title={fmtValue(n, f)} className="h-6 min-w-8 border border-white text-center" style={{ background: t == null ? "#faf6f0" : `rgba(168,112,63,${0.08 + t * 0.8})`, color: t != null && t > 0.55 ? "white" : undefined }}>{t == null ? "" : fmtValue(n, f)}</td>;
            })}</tr>
          ))}</tbody></table>
      </div>
    );
  }
  if ((v.type === "bar" || v.type === "line" || v.type === "area") && v.x && v.y?.length) {
    const yFmt = (v.formats[v.y[0]] === "pct" ? "pct" : v.formats[v.y[0]] === "inr" ? "inr" : "num") as "inr" | "pct" | "num";
    const dateX = isDateField(v.rows, v.x);
    if (v.type === "bar" && !dateX) {
      // ranking: horizontal bars read better with long store/product names
      const data = v.rows.slice(0, 25).map((r) => ({ ...r, __label: String(r[v.x!]).replace(/^(COCO|COFO|FOCO)\s*-\s*/, "") }));
      return (
        <div style={{ height: Math.max(160, data.length * 26 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid stroke="#efe6da" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#7a6c5d" }} tickFormatter={(n) => fmtValue(n, yFmt)} />
              <YAxis type="category" dataKey="__label" width={170} tick={{ fontSize: 11, fill: "#453b32" }} />
              <Tooltip formatter={(n, name) => [fmtValue(Number(n), v.formats[String(name)] ?? yFmt), v.labels[String(name)] ?? name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              {v.y.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} formatter={(n) => v.labels[n] ?? n} />}
              {v.y.map((k, i) => <Bar key={k} dataKey={k} name={k} fill={COLORS[i % COLORS.length]} radius={[0, 3, 3, 0]} maxBarSize={18} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }
    return (
      <TrendChart data={v.rows} xKey={v.x} xIsDate={dateX && v.rows.every((r) => String(r[v.x!]).length === 10)} yFormat={yFmt} height={240}
        series={v.y.map((k, i) => ({ key: k, label: v.labels[k] ?? k, color: COLORS[i % COLORS.length], type: v.type === "bar" ? "bar" as const : "line" as const }))} />
    );
  }
  return <div className="text-[12px] text-zinc-500">View unavailable.</div>;
}
