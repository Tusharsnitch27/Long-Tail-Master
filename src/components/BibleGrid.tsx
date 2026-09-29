"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LayoutGrid, List, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { inr, num, pct } from "@/lib/format";

export interface BibleItem {
  sku: string; name: string | null; category: string; type: string | null; colour: string | null; image: string | null;
  mrp: number | null; status: string | null; lifecycle: string | null; allocation: string | null; liveDate: string | null;
  inBible: boolean; invTotal: number | null; invOffline: number | null; storesStocked: number | null; qtyTd: number | null; returnPct: number | null;
  l30q: number; l30: number; stores: number; material: string | null; vendor: string | null;
}

const SORTS = [
  { key: "l30q", label: "L30 units · high to low" },
  { key: "l30", label: "L30 revenue · high to low" },
  { key: "qtyTd", label: "Lifetime units · high to low" },
  { key: "invOffline", label: "Store inventory · high to low" },
  { key: "mrp", label: "MRP · high to low" },
  { key: "liveDate", label: "Newest first" },
] as const;

export function BibleGrid({ items }: { items: BibleItem[] }) {
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("l30q");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [facet, setFacet] = useState<Record<string, Set<string>>>({});
  const facets = useMemo(() => {
    const keys = ["category", "type", "colour", "lifecycle", "status", "allocation"] as const;
    return keys.map((k) => ({ key: k, values: Object.entries(items.reduce<Record<string, number>>((a, i) => { const v = (i[k] as string) ?? "—"; a[v] = (a[v] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]) }))
      .filter((f) => f.values.length > 1);
  }, [items]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items
      .filter((i) => !s || i.sku.toLowerCase().includes(s) || (i.name ?? "").toLowerCase().includes(s))
      .filter((i) => Object.entries(facet).every(([k, set]) => !set.size || set.has(((i as unknown as Record<string, string>)[k]) ?? "—")))
      .sort((a, b) => {
        const x = a[sort] as number | string | null, y = b[sort] as number | string | null;
        if (x == null) return 1; if (y == null) return -1;
        return typeof x === "number" ? (y as number) - x : String(y).localeCompare(String(x));
      });
  }, [items, q, sort, facet]);
  const toggle = (k: string, v: string) => setFacet((f) => { const s = new Set(f[k] ?? []); if (s.has(v)) s.delete(v); else s.add(v); return { ...f, [k]: s }; });
  const qs = sp.toString();

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-4">
        {facets.map((f) => (
          <div key={f.key}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{f.key === "type" ? "Sub-type" : f.key}</div>
            <div className="max-h-48 space-y-0.5 overflow-y-auto scroll-thin">
              {f.values.map(([v, n]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={facet[f.key]?.has(v) ?? false} onChange={() => toggle(f.key, v)} />
                  <span className="truncate">{v}</span><span className="ml-auto text-[11px] text-zinc-400">{n}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
        {Object.values(facet).some((s) => s.size) && <button onClick={() => setFacet({})} className="w-full rounded-md border border-zinc-300 py-1.5 text-[12.5px]">Clear attribute filters</button>}
      </aside>
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3">
            <Search className="size-4 text-zinc-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU or product name…" className="w-full text-[13px] outline-none" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-[13px]">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <div className="flex rounded-md border border-zinc-300 bg-white">
            <button aria-label="Grid" onClick={() => setView("grid")} className={cn("p-2", view === "grid" && "bg-zinc-900 text-white")}><LayoutGrid className="size-4" /></button>
            <button aria-label="List" onClick={() => setView("list")} className={cn("p-2", view === "list" && "bg-zinc-900 text-white")}><List className="size-4" /></button>
          </div>
          <span className="text-[12px] text-zinc-500">{shown.length} SKUs</span>
        </div>
        {view === "grid" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            {shown.map((i) => (
              <Link key={i.sku} href={`/products/skus/${encodeURIComponent(i.sku)}${qs ? `?${qs}` : ""}`} className="group overflow-hidden rounded-xl border border-zinc-200 bg-white hover:border-zinc-400">
                <div className="relative aspect-[4/3] bg-zinc-100">
                  {i.image && <img src={i.image} alt="" loading="lazy" className="size-full object-contain p-2" />}
                  <span className={cn("absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10.5px] font-semibold", (i.lifecycle ?? i.status) === "LIVE" || i.status === "ACTIVE" ? "bg-zinc-900 text-white" : "bg-zinc-300 text-zinc-700")}>{i.lifecycle ?? i.status ?? "—"}</span>
                  {i.l30q > 0 && <span className="absolute right-2 top-2 rounded bg-white/90 px-1.5 py-0.5 text-[10.5px] font-semibold">{i.stores} stores · L30</span>}
                </div>
                <div className="p-3">
                  <div className="flex justify-between text-[11px] text-zinc-500"><span className="font-mono">{i.sku}</span><span>{inr(i.mrp, { compact: false })}</span></div>
                  <div className="mt-1 line-clamp-2 min-h-[2.5em] text-[13px] font-medium leading-snug">{i.name ?? "Unnamed SKU"}</div>
                  <div className="mt-1 truncate text-[11px] uppercase tracking-wide text-zinc-500">{[i.category, i.type, i.colour].filter(Boolean).join(" · ")}</div>
                  <dl className="mt-2 grid grid-cols-2 gap-y-1.5 border-t border-zinc-100 pt-2 text-[11px]">
                    <div><dt className="text-zinc-500">L30 UNITS</dt><dd className="tabular text-[13px] font-medium">{num(i.l30q)}</dd></div>
                    <div><dt className="text-zinc-500">L30 REVENUE</dt><dd className="tabular text-[13px] font-medium">{inr(i.l30)}</dd></div>
                    <div><dt className="text-zinc-500">STORE INV</dt><dd className="tabular text-[13px] font-medium">{i.inBible ? num(i.invOffline) : "n/a"}</dd></div>
                    <div><dt className="text-zinc-500">{i.inBible ? "RETURN % (LTD)" : "LIFETIME UNITS"}</dt><dd className="tabular text-[13px] font-medium">{i.inBible ? pct(i.returnPct) : "n/a"}</dd></div>
                  </dl>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white scroll-thin">
            <table className="w-full text-[12.5px]">
              <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500"><tr>{["", "SKU", "Product", "Category", "Sub-type", "Colour", "MRP", "Status", "L30 units", "L30 rev", "Stores", "Store inv", "Total inv", "Lifetime units"].map((h) => <th key={h} className="px-2 py-2 text-left">{h}</th>)}</tr></thead>
              <tbody>{shown.map((i) => (
                <tr key={i.sku} className="border-t border-zinc-100 hover:bg-zinc-50">
                  <td className="px-2 py-1">{i.image ? <img src={i.image} alt="" loading="lazy" className="size-8 rounded object-cover" /> : null}</td>
                  <td className="px-2 font-mono text-[11.5px]"><Link className="text-brand-600 hover:underline" href={`/products/skus/${encodeURIComponent(i.sku)}${qs ? `?${qs}` : ""}`}>{i.sku}</Link></td>
                  <td className="px-2">{i.name}</td><td className="px-2">{i.category}</td><td className="px-2">{i.type ?? "—"}</td><td className="px-2">{i.colour ?? "—"}</td>
                  <td className="tabular px-2">{inr(i.mrp, { compact: false })}</td><td className="px-2">{i.lifecycle ?? i.status ?? "—"}</td>
                  <td className="tabular px-2">{num(i.l30q)}</td><td className="tabular px-2">{inr(i.l30)}</td><td className="tabular px-2">{i.stores}</td>
                  <td className="tabular px-2">{i.inBible ? num(i.invOffline) : "n/a"}</td><td className="tabular px-2">{i.inBible ? num(i.invTotal) : "n/a"}</td><td className="tabular px-2">{i.inBible ? num(i.qtyTd) : "n/a"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
