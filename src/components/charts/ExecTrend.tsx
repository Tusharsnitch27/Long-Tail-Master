"use client";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr, num, pct } from "@/lib/format";
import { cn } from "@/lib/cn";

type Row = { day: string; revenue: number | null; units: number | null; prevRevenue: number | null; prevUnits: number | null; targetPace: number | null; targetBasis: number | null; achievement: number | null };

/** Cumulative month curves: current vs previous month (same day-of-month) vs target pace. */
export function ExecTrend({ data, prevLabel, basisLabel }: { data: Row[]; prevLabel: string; basisLabel: string | null }) {
  const [m, setM] = useState<"revenue" | "units" | "achievement">("revenue");
  const hasTarget = data.some((d) => d.targetPace != null);
  const f = (v: number) => (m === "revenue" ? inr(v, { decimals: 1 }) : m === "units" ? num(v) : pct(v, 0));
  const series = m === "revenue"
    ? [{ k: "revenue", l: basisLabel ? "This month · all channels" : "This month", c: "#0e8a96" }, { k: "prevRevenue", l: prevLabel, c: "#a1a1aa" },
       ...(hasTarget && basisLabel ? [{ k: "targetBasis", l: `This month · ${basisLabel}`, c: "#14a3ae" }] : []),
       ...(hasTarget ? [{ k: "targetPace", l: basisLabel ? `Target pace · ${basisLabel}` : "Target pace", c: "#0b3b44", dash: true }] : [])]
    : m === "units" ? [{ k: "units", l: "This month", c: "#0e8a96" }, { k: "prevUnits", l: prevLabel, c: "#a1a1aa" }]
    : [{ k: "achievement", l: basisLabel ? `Achievement · ${basisLabel}` : "Achievement (cumulative)", c: "#0e8a96" }];
  return (
    <div>
      <div className="mb-2 flex gap-0.5 rounded-lg border border-line bg-white p-0.5 w-fit">
        {(["revenue", "units", ...(hasTarget ? ["achievement"] : [])] as const).map((k) => (
          <button key={k} onClick={() => setM(k as typeof m)} className={cn("rounded-md px-2.5 py-1 text-[12px] capitalize", m === k ? "bg-ink text-white" : "text-zinc-600 hover:bg-zinc-100")}>{k}</button>
        ))}
      </div>
      <div style={{ height: 250 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#e6f0f1" vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: "#e8e8ec" }} tick={{ fontSize: 11, fill: "#71717a" }} minTickGap={14} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#71717a" }} width={58} tickFormatter={(v) => f(v)} domain={m === "achievement" ? [0, "auto"] : undefined} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e8e8ec" }} labelFormatter={(d) => `Day ${d}`} formatter={(v, n) => [v == null ? "—" : f(Number(v)), n]} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => <Line key={s.k} dataKey={s.k} name={s.l} stroke={s.c} strokeWidth={["revenue", "units", "achievement", "targetBasis"].includes(s.k) ? 2.2 : 1.6} strokeDasharray={"dash" in s && s.dash ? "5 4" : undefined} dot={false} connectNulls={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
