"use client";
import { useState } from "react";
import { TrendChart, type Series } from "./TrendChart";
import { cn } from "@/lib/cn";

/** One chart with a metric switch (e.g. Revenue / Units) instead of two near-identical charts side by side. */
export function SwitchTrend({ data, views, height = 240, name }: {
  data: Record<string, unknown>[]; height?: number; name: string;
  views: { key: string; label: string; series: Series[]; yFormat?: "inr" | "num" | "pct"; total?: string }[];
}) {
  const [k, setK] = useState(views[0]?.key);
  const v = views.find((x) => x.key === k) ?? views[0];
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <div className="flex w-fit gap-0.5 rounded-lg border border-line bg-paper p-0.5">
          {views.map((x) => <button key={x.key} onClick={() => setK(x.key)} className={cn("rounded-md px-2.5 py-0.5 text-[11.5px]", x.key === v.key ? "bg-brand-900 font-medium text-canvas" : "text-zinc-600 hover:bg-brand-50")}>{x.label}</button>)}
        </div>
        {v.total && <span className="text-[11.5px] text-zinc-500">{v.total}</span>}
      </div>
      <TrendChart name={`${name}-${v.key}`} data={data} height={height} yFormat={v.yFormat} series={v.series} />
    </div>
  );
}
