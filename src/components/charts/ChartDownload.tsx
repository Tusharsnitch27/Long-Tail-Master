"use client";
import Papa from "papaparse";
import { Download } from "lucide-react";
import { cn } from "@/lib/cn";

export interface DownloadCol { key: string; label: string }

/** Downloads the data behind a chart as CSV (raw values: ₹ and units unformatted, ratios as decimals). */
export function ChartDownload({ data, columns, name, className }: { data: Record<string, unknown>[]; columns?: DownloadCol[]; name: string; className?: string }) {
  if (!data.length) return null;
  const cols = columns ?? Object.keys(data[0]).map((k) => ({ key: k, label: k }));
  const save = () => {
    const csv = Papa.unparse({
      fields: cols.map((c) => c.label),
      data: data.map((r) => cols.map((c) => {
        const v = r[c.key];
        return v == null ? "" : typeof v === "number" ? +v.toFixed(4) : String(v);
      })),
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <button type="button" onClick={save} title="Download the data in this chart (CSV)" aria-label="Download chart data"
      className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-line bg-paper px-1.5 text-[11px] text-zinc-500 transition-colors hover:border-zinc-300 hover:text-ink", className)}>
      <Download className="size-3" />CSV
    </button>
  );
}
