"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Plus, ListFilter, ArrowUpDown } from "lucide-react";
import { MixBar } from "@/components/ui/MixBar";
import { useAccess } from "@/components/shell/Permissions";
import { NUM_OPS, TEXT_OPS, needsValue, passRule, encodeRules, decodeRules, type Rule, type Op } from "./rules";
import { facetOptions, matchTerms, normText, passFacets, queryTerms, type FacetDef } from "@/components/products/search";
import { useListState, LOCAL_PARAMS } from "@/components/products/useListState";
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
  /** thumbnail size in px for `image` columns (default 32) */
  imageSize?: number;
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
  searchText, facets, urlState = false, searchPlaceholder = "Search", rules: allowRules = true,
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
  /** row key holding a hidden search string (e.g. name + metafields); enables multi-word AND matching */
  searchText?: string;
  /** dropdown filters over row keys (options = distinct values present, faceted by the other filters) */
  facets?: FacetDef[];
  /** mirror search / filters / sort to page-local URL params (q, facet keys, sort) */
  urlState?: boolean;
  searchPlaceholder?: string;
  /** show the "Add filter" rule builder (column · operator · value) */
  rules?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const access = useAccess();
  const canDownload = access.download;
  // roles without revenue access never see ₹ columns or gross profit
  columns = access.revenue ? columns : columns.filter((c) => c.type !== "inr" && c.type !== "inrFull" && !/^gp/i.test(c.key));
  const fs = useMemo(() => facets ?? [], [facets]);
  const { q, setQ, sel, setFacet, clear, sort, setSort } = useListState({ facets: fs.map((f) => f.key), defaultSort, url: urlState });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.hidden).map((c) => c.key)));
  const [colMenu, setColMenu] = useState(false);
  const cols = columns.filter((c) => !hidden.has(c.key));
  // rule filters (column · operator · value), mirrored to ?f= when urlState
  const [rules, setRules] = useState<Rule[]>(() => (urlState ? decodeRules(sp.get("f")) : []));
  useEffect(() => {
    if (!urlState) return;
    const p = new URLSearchParams(window.location.search);
    const enc = encodeRules(rules);
    if (enc) p.set("f", enc); else p.delete("f");
    const s = p.toString();
    window.history.replaceState(null, "", s ? `${window.location.pathname}?${s}` : window.location.pathname);
  }, [rules, urlState]);
  const ruleCols = columns.filter((c) => c.type !== "image" && c.type !== "split");
  const isNum = (c?: Col) => !!c && RIGHT.includes(c.type ?? "text");
  const isRatio = (c?: Col) => !!c && ["pct", "ach", "delta"].includes(c.type ?? "");
  const colLabel = (c: Col) => (c.group ? `${c.group} · ${c.label}` : c.label);
  const addRule = () => { const c = ruleCols.find((x) => isNum(x)) ?? ruleCols[0]; if (c) setRules((r) => [...r, { key: c.key, op: isNum(c) ? "gt" : "contains", value: "" }]); };
  const setRule = (i: number, patch: Partial<Rule>) => setRules((rs) => rs.map((r, j) => {
    if (j !== i) return r;
    const n = { ...r, ...patch };
    if (patch.key && patch.key !== r.key) { const c = columns.find((x) => x.key === patch.key); n.op = isNum(c) ? "gt" : "contains"; n.value = ""; }
    return n;
  }));

  const data = useMemo(() => {
    let out = fs.length ? rows.filter((r) => passFacets(r, fs, sel)) : rows;
    if (rules.length) {
      const rc = rules.map((r) => { const c = columns.find((x) => x.key === r.key); return { r, num: isNum(c), ratio: isRatio(c) }; });
      out = out.filter((row) => rc.every(({ r, num, ratio }) => passRule(row[r.key], r, num, ratio)));
    }
    const s = q.trim().toLowerCase();
    if (s && searchText) {
      const terms = queryTerms(s);
      out = out.filter((r) => matchTerms(normText(String(r[searchText] ?? "")), terms));
    } else if (s) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, searchKeys, columns, searchText, fs, sel, rules]);
  const opts = useMemo(() => (fs.length ? facetOptions(rows, fs, sel) : {}), [rows, fs, sel]);
  const active = !!q.trim() || Object.keys(sel).length > 0 || rules.length > 0;

  const maxes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of columns) if (c.bar) m[c.key] = Math.max(0, ...rows.map((r) => Math.abs(Number(r[c.key]) || 0)));
    return m;
  }, [rows, columns]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const maxImg = Math.max(0, ...columns.filter((c) => c.image && !hidden.has(c.key)).map((c) => c.imageSize ?? 44));
  const rowH = Math.max(dense ? 34 : 46, maxImg + 10);
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
    if (urlState) for (const k of [...LOCAL_PARAMS, ...fs.map((f) => f.key)]) carry.delete(k);
    for (const [k, v] of new URLSearchParams(own ?? "")) carry.set(k, v);
    const qs = carry.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const exportCsv = () => {
    // every column (hidden ones too) plus the fields shown under a value (SKU group, item code, city …) and image links
    const SUB_LABEL: Record<string, string> = { sku: "SKU group", item: "Item code", city: "City", b: "Branch code" };
    type F = { label: string; get: (r: Row) => unknown; c?: Col };
    const fields: F[] = [];
    const subKeys = new Set(columns.map((c) => c.sub).filter(Boolean) as string[]);
    if (!subKeys.has("sku") && rows.some((r) => r.sku != null) && !columns.some((c) => c.key === "sku")) fields.push({ label: "SKU group", get: (r) => r.sku });
    for (const c of columns) {
      if (c.type === "image") { fields.push({ label: c.label || "Image URL", get: (r) => r[c.key] }); continue; }
      if (c.type === "split") { (["Stores", "Online", "Marketplace"] as const).forEach((n, i) => fields.push({ label: `${c.label} · ${n} %`, get: (r) => { const v = (r[c.key] as (number | null)[] | null)?.[i]; return v == null ? null : +(v * 100).toFixed(2); } })); continue; }
      fields.push({ label: c.group ? `${c.group} ${c.label}` : c.label, get: (r) => r[c.key], c });
      if (c.sub) fields.push({ label: SUB_LABEL[c.sub] ?? c.sub, get: (r) => r[c.sub!] });
      if (c.image) fields.push({ label: "Image URL", get: (r) => r[c.image!] });
    }
    const csv = Papa.unparse({
      fields: fields.map((f) => f.label),
      data: data.map((r) => fields.map(({ get, c }) => {
        const v = get(r);
        if (v == null) return "";
        if (c?.type === "status") return STATUS_META[v as TargetStatus]?.label ?? v;
        if (typeof v === "number") return c && (c.type === "pct" || c.type === "ach" || c.type === "delta") ? +(v * 100).toFixed(2) : +v.toFixed(2);
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

  const onSort = (k: string) => setSort((s: { key: string; desc: boolean } | null) => (s?.key === k ? (s.desc ? { key: k, desc: false } : null) : { key: k, desc: true }));

  return (
    <div className="card rounded-[18px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        {title && <div className="mr-2 font-serif text-[15px] text-ink">{title}</div>}
        <div className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 shadow-[inset_0_1px_1px_rgba(60,40,20,.05)] focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15">
          <Search className="size-3.5 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className={cn("bg-transparent text-[12.5px] outline-none placeholder:text-zinc-400", searchText ? "w-56" : "w-40")} />
          {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-zinc-400 hover:text-ink"><X className="size-3" /></button>}
        </div>
        {fs.map((f) => (opts[f.key]?.length || sel[f.key]) ? (
          <label key={f.key} className={cn("flex h-8 items-center gap-1 rounded-lg border pl-2.5 pr-1 text-[12px] transition-colors", sel[f.key] ? "border-brand-900 bg-brand-900 text-canvas" : "border-zinc-300 bg-white text-zinc-600 hover:border-brand-400")}>
            <span className={cn("text-[10px] font-semibold uppercase tracking-[0.12em]", sel[f.key] ? "text-brand-300" : "text-zinc-400")}>{f.label}</span>
            <select value={sel[f.key] ?? ""} onChange={(e) => setFacet(f.key, e.target.value)} aria-label={f.label}
              className={cn("h-7 max-w-40 cursor-pointer bg-transparent pr-1 text-[12px] font-medium outline-none", sel[f.key] ? "text-canvas" : "text-ink")}>
              <option value="" className="text-ink">All</option>
              {(opts[f.key] ?? []).map((o) => <option key={o.v} value={o.v} className="text-ink">{o.v} ({o.n})</option>)}
              {sel[f.key] && !(opts[f.key] ?? []).some((o) => o.v === sel[f.key]) && <option value={sel[f.key]} className="text-ink">{sel[f.key]} (0)</option>}
            </select>
          </label>
        ) : null)}
        {allowRules && ruleCols.length > 0 && (
          <button onClick={addRule} className="flex h-8 items-center gap-1 rounded-lg border border-dashed border-brand-500 bg-brand-50 px-2.5 text-[12px] font-medium text-brand-800 transition-colors hover:bg-brand-100">
            <Plus className="size-3.5" />Add filter
          </button>
        )}
        <label className="flex h-8 items-center gap-1 rounded-lg border border-zinc-300 bg-white pl-2.5 pr-1 text-[12px] text-zinc-600 hover:border-brand-400">
          <ArrowUpDown className="size-3.5 text-zinc-400" />
          <select value={sort?.key ?? ""} onChange={(e) => setSort(e.target.value ? { key: e.target.value, desc: sort?.key === e.target.value ? sort.desc : true } : null)} aria-label="Sort by" className="h-7 max-w-44 cursor-pointer bg-transparent text-[12px] font-medium text-ink outline-none">
            <option value="">Sort: none</option>
            {ruleCols.map((c) => <option key={c.key} value={c.key}>Sort: {colLabel(c)}</option>)}
          </select>
          {sort && <button onClick={() => setSort({ key: sort.key, desc: !sort.desc })} title={sort.desc ? "Highest first — click for lowest first" : "Lowest first — click for highest first"} className="rounded px-1 text-zinc-500 hover:bg-zinc-100 hover:text-ink">{sort.desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}</button>}
        </label>
        {active && (fs.length > 0 || urlState || rules.length > 0) && <button onClick={() => { clear(); setRules([]); }} className="flex h-8 items-center gap-0.5 rounded-lg px-2 text-[12px] font-medium text-rose-700 hover:bg-rose-50"><X className="size-3.5" />Clear all</button>}
        <span className="text-[11.5px] text-zinc-500"><b className="tabular font-semibold text-ink">{data.length.toLocaleString("en-IN")}</b>{data.length !== rows.length ? ` of ${rows.length.toLocaleString("en-IN")}` : ""} rows</span>
        {toolbar}
        <div className="relative ml-auto">
          <button onClick={() => setColMenu((v) => !v)} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-zinc-600 hover:bg-zinc-100">
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
        {canDownload && <button onClick={exportCsv} className="flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[12px] text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50">
          <Download className="size-3.5" /> CSV
        </button>}
      </div>
      {rules.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-50/60 px-3 py-2">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-700"><ListFilter className="size-3.5" />Show rows where</span>
          {rules.map((r, i) => {
            const c = columns.find((x) => x.key === r.key);
            const ops: { op: Op; label: string }[] = isNum(c) ? NUM_OPS : TEXT_OPS;
            return (
              <span key={i} className="flex items-center gap-1 rounded-lg border border-brand-300 bg-white p-0.5 pl-1 shadow-sm">
                {i > 0 && <span className="px-1 text-[10.5px] font-semibold text-brand-700">AND</span>}
                <select value={r.key} onChange={(e) => setRule(i, { key: e.target.value })} aria-label="Column" className="h-7 max-w-48 rounded-md bg-brand-50 px-1.5 text-[12px] font-medium text-ink outline-none">
                  {ruleCols.map((x) => <option key={x.key} value={x.key}>{colLabel(x)}</option>)}
                </select>
                <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value as Op })} aria-label="Operator" className="h-7 rounded-md px-1 text-[12px] font-semibold text-brand-800 outline-none">
                  {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {needsValue(r.op) && (
                  <input value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} autoFocus={!r.value}
                    placeholder={isNum(c) ? (r.op === "between" ? (isRatio(c) ? "10 - 40 (%)" : "e.g. 10 - 50") : isRatio(c) ? "e.g. 20 (%)" : c?.type === "inr" || c?.type === "inrFull" ? "e.g. 50k, 1.5L" : "e.g. 100") : "text"}
                    className="h-7 w-28 rounded-md border border-zinc-300 bg-white px-2 text-[12px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
                )}
                <button onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove filter" className="rounded-md p-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-700"><X className="size-3.5" /></button>
              </span>
            );
          })}
          <button onClick={addRule} className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-brand-800 hover:bg-white"><Plus className="size-3.5" />And</button>
        </div>
      )}
      <div ref={scrollRef} className="overflow-auto scroll-thin" style={{ maxHeight: height }}>
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead className="sticky top-0 z-20 bg-[#fbf7f1]">
            {groups && (
              <tr>
                {groups.map((g, i) => (
                  <th key={i} colSpan={g.span} className={cn("border-b border-zinc-200 px-2 py-1 text-center text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500", g.label && "border-x border-x-white bg-gradient-to-b from-brand-50 to-brand-100/70 text-brand-800")}>{g.label}</th>
                ))}
              </tr>
            )}
            <tr>
              {cols.map((c, i) => (
                <th key={c.key} onClick={() => onSort(c.key)} style={{ minWidth: c.width }}
                  className={cn("cursor-pointer select-none whitespace-nowrap border-b border-brand-200/70 bg-gradient-to-b from-[#fdfaf5] to-[#f7f0e6] px-3 py-2 text-[11px] font-semibold text-zinc-500 hover:text-brand-800",
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
                  className={cn("group bg-white transition-colors", h && "cursor-pointer", "hover:bg-brand-50/70")}>
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
              <tr className="font-semibold">
                {cols.map((c, i) => (
                  <td key={c.key} className={cn("tabular whitespace-nowrap border-t border-brand-200 bg-gradient-to-b from-[#f7efe4] to-[#f1e6d6] px-3 py-2 text-brand-900", RIGHT.includes(c.type ?? "text") ? "text-right" : "text-left", i === 0 && "sticky left-0")}>
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
    first && "sticky left-0 z-[1] bg-inherit font-medium group-hover:bg-brand-50");
  if (t === "image") {
    return <td className={base}>{v ? <img src={String(v)} alt="" loading="lazy" className="size-8 rounded object-cover" /> : <div className="size-8 rounded bg-zinc-100" />}</td>;
  }
  if (t === "split") {
    // [stores, online, marketplace] shares → compact stacked bar
    const parts = (Array.isArray(v) ? v : []) as (number | null)[];
    const colors = ["#6e4526", "#c08f60", "#e2c9a6"], names = ["Stores", "Online", "Marketplace"];
    return (
      <td className={base}>
        {parts.some((x) => x) ? <MixBar className="w-24" barClass="h-2" title="Lifetime channel mix" format="none" parts={parts.map((x, i) => ({ label: names[i], value: (x ?? 0) * 100, color: colors[i] }))} /> : <span className="text-zinc-400">—</span>}
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
          {img ? <span className="thumb inline-block shrink-0" style={{ width: c.imageSize ?? 44, height: c.imageSize ?? 44 }}><img src={img} alt="" loading="lazy" className="size-full rounded-md border border-line bg-white object-cover" /><img src={img} alt="" loading="lazy" className="preview" /></span> : <span className="shrink-0 rounded-md bg-zinc-100" style={{ width: c.imageSize ?? 44, height: c.imageSize ?? 44 }} />}
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
        <span className="absolute inset-y-1.5 right-0 rounded-l bg-gradient-to-l from-brand-200/70 to-brand-100/30" style={{ width: `${w}%` }} />
        <span className="relative">{content}</span>
      </td>
    );
  }
  return <td className={base}>{content}</td>;
}
