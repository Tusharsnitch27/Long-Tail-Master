"use client";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr, pct, num } from "@/lib/format";
import { fmtDate, weekday } from "@/lib/dates";

export interface DailyRow { date: string; actual: number; target: number | null; units?: number; lw?: number | null }

const color = (a: number | null, target: number | null) => (target == null || !target ? "#c08f60" : a == null ? "#b8a894" : a >= 0.95 ? "#15803d" : a >= 0.8 ? "#d97706" : "#dc2626");

/** Daily actual vs target: bars coloured by achievement (green ≥95%, amber ≥80%, red below), target as a dashed line. */
export function DailyTargetChart({ data, height = 260, showLw = true }: { data: DailyRow[]; height?: number; showLw?: boolean }) {
  const rows = data.map((d) => ({ ...d, ach: d.target ? d.actual / d.target : null }));
  const hasT = rows.some((r) => r.target != null);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        {hasT ? (<>
          <span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-[#15803d]" />≥95% of target</span>
          <span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-[#d97706]" />80–95%</span>
          <span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-[#dc2626]" />&lt;80%</span>
          <span className="flex items-center gap-1"><i className="h-0 w-3 border-t-2 border-dashed border-[#1b1712]" />Target</span>
        </>) : <span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-[#c08f60]" />Revenue (no target set)</span>}
        {showLw && rows.some((r) => r.lw != null) && <span className="flex items-center gap-1"><i className="h-0 w-3 border-t-2 border-[#e2c9a6]" />Same day last week</span>}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#efe6da" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: "#e6dbcc" }} tick={{ fontSize: 11, fill: "#7a6c5d" }} minTickGap={14} tickFormatter={(v) => fmtDate(String(v))} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#7a6c5d" }} width={56} tickFormatter={(v) => inr(v, { decimals: 1 })} />
            <Tooltip cursor={{ fill: "rgba(168,112,63,0.06)" }} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e6dbcc" }}
              labelFormatter={(v) => `${weekday(String(v))}, ${fmtDate(String(v), true)}`}
              formatter={(v, n, it) => {
                const r = it.payload as (typeof rows)[number];
                if (n === "Revenue") return [`${inr(Number(v))}${r.ach != null ? ` · ${pct(r.ach, 0)} of target` : ""}${r.units != null ? ` · ${num(r.units)} units` : ""}`, n];
                return [v == null ? "—" : inr(Number(v)), n];
              }} />
            <Bar dataKey="actual" name="Revenue" radius={[3, 3, 0, 0]} maxBarSize={22}>
              {rows.map((r) => <Cell key={r.date} fill={color(r.ach, r.target)} />)}
            </Bar>
            {showLw && <Line dataKey="lw" name="Same day last week" stroke="#e2c9a6" strokeWidth={1.8} dot={false} connectNulls />}
            {hasT && <Line dataKey="target" name="Target" stroke="#1b1712" strokeDasharray="5 4" strokeWidth={1.6} dot={false} connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
