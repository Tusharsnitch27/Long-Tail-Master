"use client";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr, num, pct } from "@/lib/format";
import { fmtDate, weekday } from "@/lib/dates";

export interface Series { key: string; label: string; color: string; type?: "bar" | "line"; stack?: string; dashed?: boolean; axis?: "left" | "right" }
type Fmt = "inr" | "num" | "pct";
const F: Record<Fmt, (v: number) => string> = { inr: (v) => inr(v, { decimals: 1 }), num: (v) => num(v), pct: (v) => pct(v, 0) };

export function TrendChart({ data, series, xKey = "date", yFormat = "inr", rightFormat = "pct", height = 260, xIsDate = true }: {
  data: Record<string, unknown>[]; series: Series[]; xKey?: string; yFormat?: Fmt; rightFormat?: Fmt; height?: number; xIsDate?: boolean;
}) {
  if (!data.length) return <div className="flex items-center justify-center text-[13px] text-zinc-500" style={{ height }}>No data for this period</div>;
  const hasRight = series.some((s) => s.axis === "right");
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 4 : 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="#efe6da" vertical={false} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: "#e6dbcc" }} tick={{ fontSize: 11, fill: "#7a6c5d" }} minTickGap={16}
            tickFormatter={(v) => (xIsDate ? fmtDate(String(v)) : String(v))} />
          <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#7a6c5d" }} width={56} tickFormatter={(v) => F[yFormat](v)} />
          {hasRight && <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#7a6c5d" }} width={44} tickFormatter={(v) => F[rightFormat](v)} />}
          <Tooltip
            cursor={{ fill: "rgba(168,112,63,0.06)" }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e6dbcc" }}
            labelFormatter={(v) => (xIsDate ? `${weekday(String(v))}, ${fmtDate(String(v), true)}` : String(v))}
            formatter={(v, name, item) => {
              const s = series.find((x) => x.label === name || x.key === item.dataKey);
              return [v == null ? "—" : F[s?.axis === "right" ? rightFormat : yFormat](Number(v)), name];
            }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) =>
            s.type === "line" ? (
              <Line key={s.key} yAxisId={s.axis ?? "left"} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
                strokeDasharray={s.dashed ? "4 3" : undefined} dot={false} connectNulls />
            ) : (
              <Bar key={s.key} yAxisId={s.axis ?? "left"} dataKey={s.key} name={s.label} fill={s.color} stackId={s.stack} radius={s.stack ? 0 : [3, 3, 0, 0]} maxBarSize={28} />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
