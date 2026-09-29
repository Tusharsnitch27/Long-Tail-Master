"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import Papa from "papaparse";
import { ArrowDown, ArrowUp, Download, Columns3, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { inr, num, pct, signedPct } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { STATUS_META, type TargetStatus } from "@/lib/metrics";

export type ColType = "text" | "inr" | "inrFull" | "num" | "dec" | "pct" | "delta" | "ach" | "status" | "date" | "image" | "code" | "split";
export interface Col {
  key: string;
  label: string;
  type?: ColType;
  tip?: string;
  group?: string;
  hidden?: boolean;
  /** render as a data bar relative to column max */
  bar?: boolean;
  /** for delta: lower is better */
  invert?: boolean;
  width?: number;
  /** show a secondary field next to / under the value (e.g. store city, SKU code) */
  sub?: string;
  /** field holding an image URL shown as a thumbnail before the value */
  image?: string;
}
type Row = Record<string, unknown>;

const RIGHT: ColType[] = ["inr", "inrFull", "num", "dec", "pct", "delta", "ach"];

function fmt(v: unknown, t: ColType = "text"): string {
  if (v == null || v === "") return "—";
  switch (t) {
    case "inr": return inr(v as number);
    case "inrFull": return inr(v as number, { compact: false });
    case "num": return num(v as number);
    case "dec": return num(v as number, 2);
    case "pct": case "ach": return pct(v as number);
    case "delta": return signedPct(v as number);
    case "date": return fmtDate(String(v), true);
    case "status": return STATUS_META[v as TargetStatus]?.label ?? String(v);
    default: return String(v);
  }
}

export function DataTable({
  rows, columns, rowHref, searchKeys, defaultSort, csvName = "export", height = 620, totals, title, toolbar, dense = true, emptyText = "No rows match the current filters.",
}: {
  rows: Row[];
  columns: Col[];
  /** e.g. "/stores/{branch_code}" — current filters are preserved */
  rowHref?: string;
  searchKeys?: string[];
  defaultSort?: { key: string; desc?: boolean };
  csvName?: string;
  height?: number;
  totals?: Row;
  title?: React.ReactNode;
  toolbar?: React.ReactNode;
  dense?: boolean;
  emptyText?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(defaultSort ? { key: defaultSort.key, desc: defaultSort.desc ?? true } : null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.hidden).map((c) => c.key)));
  const [colMenu, setColMenu] = useState(false);
  const cols = columns.filter((c) => !hidden.has(c.key));

  const data = useMemo(() => {
    let out = rows;
    const s = q.trim().toLowerCase();
    if (s) {
      const keys = searchKeys ?? columns.filter((c) => !c.type || c.type === "text" || c.type === "code").map((c) => c.key);
      out = out.filter((r) => keys.some((k) => String(r[k] ?? "").toLowerCase().includes(s)));
    }
    if (sort) {
      const { key, desc } = sort;
      out = [...out].sort((a, b) => {
        const x = a[key], y = b[key];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return desc ? -c : c;
      });
    }
    return out;
  }, [rows, q, sort, searchKeys, columns]);

  const maxes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of columns) if (c.bar) m[c.key] = Math.max(0, ...rows.map((r) => Math.abs(Number(r[c.key]) || 0)));
    return m;
  }, [rows, columns]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowH = dense ? 34 : 46;
  const virt = useVirtualizer({ count: data.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 12 });
  const items = virt.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virt.getTotalSize() - items[items.length - 1].end : 0;

  const groups = cols.some((c) => c.group) ? cols.reduce<{ label: string; span: number }[]>((acc, c) => {
    const g = c.group ?? "";
    if (acc.length && acc[acc.length - 1].label === g) acc[acc.length - 1].span++;
    else acc.push({ label: g, span: 1 });
    return acc;
  }, []) : null;

  const href = (r: Row) => {
    if (!rowHref) return null;
    const [path, own] = rowHref.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(r[k] ?? ""))).split("?");
    // carry current filters; params in the row link win
    const carry = new URLSearchParams(sp.toString());
    carry.delete("tab");
    for (const [k, v] of new URLSearchParams(own ?? "")) carry.set(k, v);
    const qs = carry.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const exportCsv = () => {
    const csv = Papa.unparse({
      fields: columns.filter((c) => c.type !== "image").map((c) => (c.group ? `${c.group} ${c.label}` : c.label)),
      data: data.map((r) => columns.filter((c) => c.type !== "image").map((c) => {
        const v = r[c.key];
        if (v == null) return "";
        if (c.type === "status") return STATUS_META[v as TargetStatus]?.label ?? v;
        if (typeof v === "number") return c.type === "pct" || c.type === "ach" || c.type === "delta" ? +(v * 100).toFixed(2) : +v.toFixed(2);
        return v;
      })),
    });
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${csvName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onSort = (k: string) => setSort((s) => (s?.key === k ? (s.desc ? { key: k, desc: false } : null) : { key: k, desc: true }));

  return (
    <div className="rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(17,17,20,.03)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {title && <div className="mr-2 text-[12.5px] font-semibold text-zinc-800">{title}</div>}
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 focus-within:border-zinc-400">
          <Search className="size-3.5 text-zinc-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-40 text-[12.5px] outline-none" />
        </div>
        <span className="text-[11.5px] text-zinc-400">{data.length.toLocaleString("en-IN")} rows</span>
        {toolbar}
        <div className="relative ml-auto">
          <button onClick={() => setColMenu((v) => !v)} className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-zinc-600 hover:bg-zinc-100">
            <Columns3 className="size-3.5" /> Columns
          </button>
          {colMenu && (
            <div className="absolute right-0 top-9 z-40 max-h-80 w-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg scroll-thin" onMouseLeave={() => setColMenu(false)}>
              {columns.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 px-3 py-1 text-[12.5px] hover:bg-zinc-50">
                  <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />
                  {c.group ? `${c.group} · ` : ""}{c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button onClick={exportCsv} className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50">
          <Download className="size-3.5" /> CSV
        </button>
      </div>
      <div ref={scrollRef} className="overflow-auto scroll-thin" style={{ maxHeight: height }}>
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead className="sticky top-0 z-20 bg-white">
            {groups && (
              <tr>
                {groups.map((g, i) => (
                  <th key={i} colSpan={g.span} className={cn("border-b border-zinc-200 px-2 py-1 text-center text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500", g.label && "border-x border-x-white bg-zinc-100")}>{g.label}</th>
                ))}
              </tr>
            )}
            <tr>
              {cols.map((c, i) => (
                <th key={c.key} onClick={() => onSort(c.key)} style={{ minWidth: c.width }}
                  className={cn("cursor-pointer select-none whitespace-nowrap border-b border-line bg-white px-3 py-2 text-[11px] font-medium text-zinc-500 hover:text-ink",
                    RIGHT.includes(c.type ?? "text") ? "text-right" : "text-left", i === 0 && "sticky left-0 z-10")}>
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {c.tip && <span data-tip={c.tip} className="cursor-help text-zinc-400">ⓘ</span>}
                    {sort?.key === c.key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && <tr><td style={{ height: padTop }} colSpan={cols.length} /></tr>}
            {items.map((vi) => {
              const r = data[vi.index];
              const h = href(r);
              return (
                <tr key={vi.key} onClick={h ? () => router.push(h) : undefined} style={{ height: rowH }}
                  className={cn("group bg-white transition-colors", h && "cursor-pointer", "hover:bg-zinc-50")}>
                  {cols.map((c, i) => <Cell key={c.key} c={c} r={r} first={i === 0} max={maxes[c.key]} />)}
                </tr>
              );
            })}
            {padBottom > 0 && <tr><td style={{ height: padBottom }} colSpan={cols.length} /></tr>}
            {data.length === 0 && (
              <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-[13px] text-zinc-500">{emptyText}</td></tr>
            )}
          </tbody>
          {totals && data.length > 0 && (
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-zinc-50 font-semibold">
                {cols.map((c, i) => (
                  <td key={c.key} className={cn("tabular whitespace-nowrap border-t border-line bg-zinc-50 px-3 py-2", RIGHT.includes(c.type ?? "text") ? "text-right" : "text-left", i === 0 && "sticky left-0")}>
                    {i === 0 ? String(totals[c.key] ?? "Total") : totals[c.key] == null ? "" : fmt(totals[c.key], c.type)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Cell({ c, r, first, max }: { c: Col; r: Row; first: boolean; max?: number }) {
  const v = r[c.key];
  const t = c.type ?? "text";
  const base = cn("tabular whitespace-nowrap border-b border-zinc-100 px-3 py-1", RIGHT.includes(t) ? "text-right" : "text-left",
    first && "sticky left-0 z-[1] bg-inherit font-medium group-hover:bg-zinc-50");
  if (t === "image") {
    return <td className={base}>{v ? <img src={String(v)} alt="" loading="lazy" className="size-8 rounded object-cover" /> : <div className="size-8 rounded bg-zinc-100" />}</td>;
  }
  if (t === "split") {
    // [stores, online, marketplace] shares → compact stacked bar
    const parts = (Array.isArray(v) ? v : []) as (number | null)[];
    const colors = ["#5046e5", "#8f89ee", "#cbc8f6"], names = ["Stores", "Online", "Marketplace"];
    const tip = parts.map((x, i) => `${names[i]} ${x == null ? "—" : Math.round(x * 100) + "%"}`).join(" · ");
    return (
      <td className={base} title={tip}>
        {parts.some((x) => x) ? <span className="flex h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100">{parts.map((x, i) => <span key={i} style={{ width: `${(x ?? 0) * 100}%`, background: colors[i] }} />)}</span> : <span className="text-zinc-400">—</span>}
      </td>
    );
  }
  if (t === "status") {
    const m = STATUS_META[(v as TargetStatus) ?? "no_target"];
    return <td className={base}><span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1", m.cls)}><span aria-hidden>{m.icon}</span>{m.label}</span></td>;
  }
  if (t === "delta") {
    const n = v as number | null;
    const good = n != null && (c.invert ? n < 0 : n > 0);
    return <td className={cn(base, n == null ? "text-zinc-400" : Math.abs(n) < 0.0005 ? "text-zinc-500" : good ? "text-emerald-700" : "text-rose-700")}>{fmt(v, t)}</td>;
  }
  if (t === "ach") {
    const n = v as number | null;
    return (
      <td className={base}>
        {n == null ? <span className="text-zinc-400">—</span> : (
          <span className="inline-flex items-center justify-end gap-1.5">
            <span className="relative h-1.5 w-12 overflow-hidden rounded bg-zinc-100">
              <span className={cn("absolute inset-y-0 left-0", n >= 1 ? "bg-emerald-500" : n >= 0.8 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${Math.min(n / 1.5, 1) * 100}%` }} />
              <span className="absolute inset-y-0 w-px bg-zinc-500" style={{ left: "66.6%" }} />
            </span>
            <span className={cn("w-12", n >= 1 ? "text-emerald-700" : n < 0.8 ? "text-rose-700" : "text-amber-700")}>{pct(n, 0)}</span>
          </span>
        )}
      </td>
    );
  }
  const sub = c.sub ? r[c.sub] : null;
  if (c.image) {
    const img = r[c.image] as string | null;
    return (
      <td className={base}>
        <span className="flex max-w-[280px] items-center gap-2.5">
          {img ? <span className="thumb inline-block size-8 shrink-0"><img src={img} alt="" loading="lazy" className="size-full rounded-md border border-line bg-white object-cover" /><img src={img} alt="" loading="lazy" className="preview" /></span> : <span className="size-8 shrink-0 rounded-md bg-zinc-100" />}
          <span className="min-w-0 leading-tight"><span className="block truncate">{fmt(v, t)}</span>{sub != null && sub !== "" && <span className="block font-mono text-[10.5px] font-normal text-zinc-400">{String(sub)}</span>}</span>
        </span>
      </td>
    );
  }
  const content = (
    <>
      <span className={cn(t === "code" && "font-mono text-[11.5px] text-zinc-600")}>{fmt(v, t)}</span>
      {sub != null && sub !== "" && <span className="ml-1.5 text-[11px] font-normal text-zinc-400">{String(sub)}</span>}
    </>
  );
  if (c.bar && max) {
    const w = (Math.abs(Number(v) || 0) / max) * 100;
    return (
      <td className={cn(base, "relative")}>
        <span className="absolute inset-y-1.5 right-0 rounded-l bg-zinc-100" style={{ width: `${w}%` }} />
        <span className="relative">{content}</span>
      </td>
    );
  }
  return <td className={base}>{content}</td>;
}
