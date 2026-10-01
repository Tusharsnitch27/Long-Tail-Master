"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { inr, num, pct, signedPct } from "@/lib/format";
import { facetOptions, matchTerms, normText, passFacets, queryTerms, type FacetDef } from "./search";
import { useListState } from "./useListState";

export interface GridRow {
  sku: string; name: string; image: string | null; catName: string; l1: string | null; l2: string | null; colour: string | null; collection: string | null; lifecycle: string | null;
  mrp: number | null; search: string; attrs: string[];
  ltSales: number | null; ltUnits: number | null; inward: number | null; ltStr: number | null; returnPct: number | null; split: [number, number, number] | null;
  l30: number; mom: number | null; l30Units: number; str30: number | null;
  storeInv: number; storesStocked: number | null; git: number; whInv: number; whSouth: number; whNorth: number; doi: number | null; daysLive: number | null; flag: string | null;
}

const SORTS: { key: string; label: string; asc?: boolean }[] = [
  { key: "ltSales", label: "Lifetime sales" }, { key: "l30", label: "L30 sales" }, { key: "mom", label: "L30 growth" }, { key: "ltUnits", label: "Units sold" },
  { key: "ltStr", label: "Lifetime STR" }, { key: "str30", label: "STR (L30)" }, { key: "returnPct", label: "Return %" }, { key: "stock", label: "Total stock" },
  { key: "doi", label: "Days of cover" }, { key: "daysLive", label: "Newest", asc: true }, { key: "name", label: "Name", asc: true },
];
const CH = ["#6e4526", "#c08f60", "#e2c9a6"], CHN = ["Stores", "Online", "Marketplace"];
const PAGE = 48;

export function ProductGrid({ rows, facets, qs, defs }: { rows: GridRow[]; facets: FacetDef[]; qs: string; defs: Record<string, string> }) {
  const { q, setQ, sel, setFacet, clear, sort, setSort } = useListState({ facets: facets.map((f) => f.key), defaultSort: { key: "ltSales" }, url: true });
  const [n, setN] = useState(PAGE);
  const opts = useMemo(() => facetOptions(rows as unknown as Record<string, unknown>[], facets, sel), [rows, facets, sel]);
  const data = useMemo(() => {
    const terms = queryTerms(q);
    let out = rows.filter((r) => passFacets(r as unknown as Record<string, unknown>, facets, sel) && (!terms.length || matchTerms(normText(r.search), terms)));
    if (sort) {
      const val = (r: GridRow): number | string | null => (sort.key === "stock" ? r.storeInv + r.git + r.whInv : sort.key === "name" ? r.name : (r[sort.key as keyof GridRow] as number | null));
      out = [...out].sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return sort.desc ? -c : c;
      });
    }
    return out;
  }, [rows, q, sel, sort, facets]);
  const active = !!q.trim() || Object.keys(sel).length > 0;
  const href = (sku: string) => `/products/${encodeURIComponent(sku)}${qs ? `?${qs}` : ""}`;
  const sortVal = sort ? `${sort.key}${sort.desc ? "" : ".asc"}` : "";

  return (
    <div>
      <div className="sticky top-0 z-30 -mx-1 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2 focus-within:border-brand-400">
          <Search className="size-3.5 text-zinc-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setN(PAGE); }} placeholder='Search e.g. "black sneakers", SKU, collection' className="w-64 text-[12.5px] outline-none" />
        </div>
        {facets.map((f) => (opts[f.key]?.length || sel[f.key]) ? (
          <select key={f.key} value={sel[f.key] ?? ""} onChange={(e) => { setFacet(f.key, e.target.value); setN(PAGE); }} aria-label={f.label}
            className={cn("h-8 max-w-44 rounded-lg border px-2 text-[12px] outline-none", sel[f.key] ? "border-brand-500 bg-brand-50 text-brand-800" : "border-line text-zinc-600")}>
            <option value="">{f.label}: all</option>
            {(opts[f.key] ?? []).map((o) => <option key={o.v} value={o.v}>{o.v} ({o.n})</option>)}
          </select>
        ) : null)}
        <select value={sortVal} onChange={(e) => { const [key, dir] = e.target.value.split("."); setSort({ key, desc: dir !== "asc" }); }} aria-label="Sort"
          className="h-8 rounded-lg border border-line px-2 text-[12px] text-zinc-600 outline-none">
          {SORTS.map((s) => <option key={s.key} value={s.asc ? `${s.key}.asc` : s.key}>Sort: {s.label}</option>)}
          {sort && !SORTS.some((s) => (s.asc ? `${s.key}.asc` : s.key) === sortVal) && <option value={sortVal}>Sort: {sort.key}{sort.desc ? " ↓" : " ↑"}</option>}
        </select>
        {active && <button onClick={() => { clear(); setN(PAGE); }} className="flex h-8 items-center gap-0.5 rounded-lg px-2 text-[11.5px] text-zinc-500 hover:bg-zinc-100 hover:text-ink"><X className="size-3" />Clear</button>}
        <span className="ml-auto text-[11.5px] text-zinc-500">{num(data.length)} of {num(rows.length)} products</span>
      </div>

      {data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center text-[13px] text-zinc-500">No products match. Search looks at name, SKU, type, sub-type, colour, collection and other metafields.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.slice(0, n).map((r) => <Card key={r.sku} r={r} href={href(r.sku)} defs={defs} />)}
        </div>
      )}
      {data.length > n && (
        <div className="mt-4 text-center">
          <button onClick={() => setN((x) => x + PAGE)} className="rounded-lg border border-line bg-white px-4 py-1.5 text-[12.5px] font-medium text-brand-800 hover:border-brand-300 hover:bg-brand-50">
            Show {num(Math.min(PAGE, data.length - n))} more · {num(data.length - n)} remaining
          </button>
        </div>
      )}
    </div>
  );
}

function Card({ r, href, defs }: { r: GridRow; href: string; defs: Record<string, string> }) {
  const stock = r.storeInv + r.git + r.whInv;
  const coverTone = r.doi == null ? (stock > 0 ? "text-amber-700" : "text-zinc-400") : r.doi < 21 ? "text-rose-600" : r.doi > 180 ? "text-amber-700" : "text-emerald-700";
  return (
    <Link href={href} className="card card-lift group flex gap-3 rounded-[18px] p-3">
      <div className="relative size-[132px] shrink-0 overflow-hidden rounded-lg border border-line bg-brand-50/40">
        {r.image ? <img src={r.image} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" /> : <div className="flex size-full items-center justify-center text-[11px] text-brand-400">no image</div>}
        {r.flag && <span className={cn("absolute bottom-1.5 left-1.5 rounded px-1.5 py-px text-[10px] font-semibold", r.flag === "Low cover" ? "bg-rose-600 text-white" : r.flag === "Slow" ? "bg-amber-500 text-white" : "bg-brand-900 text-white")}>{r.flag}</span>}
        {r.lifecycle && <span className="absolute left-1.5 top-1.5 rounded bg-white/90 px-1 text-[9.5px] font-medium uppercase tracking-wide text-zinc-600">{r.lifecycle.toLowerCase()}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight">{r.name}</div>
        <div className="mt-0.5 font-mono text-[10.5px] text-zinc-400">{r.sku}{r.mrp ? <span className="ml-1.5 font-sans text-zinc-500">MRP {inr(r.mrp, { compact: false })}</span> : null}</div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {[r.catName, r.l1, r.l2, r.colour].filter(Boolean).map((t, i) => <span key={i} className={cn("rounded px-1.5 py-px text-[10.5px]", i === 0 ? "bg-brand-900 text-white" : "bg-brand-50 text-brand-800")}>{t}</span>)}
          {r.attrs.slice(0, 2).map((t) => <span key={t} className="rounded bg-zinc-100 px-1.5 py-px text-[10.5px] text-zinc-600">{t}</span>)}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5 text-[11px]">
          <M label="Lifetime" v={inr(r.ltSales)} tip="Lifetime sales, all channels (Product Master)" />
          <M label="L30" v={<>{inr(r.l30)} {r.mom != null && <span className={r.mom >= 0 ? "text-emerald-700" : "text-rose-600"}>{signedPct(r.mom, 0)}</span>}</>} tip={`${defs.l30}; change ${defs.mom}`} />
          <M label="Sold / inward" v={`${num(r.ltUnits)} / ${num(r.inward)}`} tip={defs.inward} />
          <M label="STR" v={<>{pct(r.ltStr, 0)} <span className="text-zinc-400">· {pct(r.str30, 0)} L30</span></>} tip={`${defs.ltStr}. L30: ${defs.str30}`} />
          <M label="Return %" v={pct(r.returnPct, 1)} tip={defs.ret} />
          <M label="Cover" v={<span className={coverTone}>{r.doi != null ? `${num(r.doi)} days` : stock > 0 ? "no sales" : "—"}</span>} tip={defs.doi} />
          <M label="Stores" v={<>{num(r.storeInv)} <span className="text-zinc-400">· {num(r.storesStocked)} st</span></>} tip={defs.storeInv} />
          {r.git > 0 && <M label="In transit" v={<span className="text-brand-700">{num(r.git)}</span>} tip={defs.git} />}
          <M label="Warehouse" v={<>{num(r.whInv)} {r.whInv > 0 && <span className="text-zinc-400">· N {num(r.whNorth)}</span>}</>} tip={defs.wh} />
          <div className="min-w-0" title={r.split ? r.split.map((x, i) => `${CHN[i]} ${Math.round(x * 100)}%`).join(" · ") : undefined}>
            <div className="text-[10px] text-zinc-400">Channel mix</div>
            {r.split ? <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-zinc-100">{r.split.map((x, i) => <span key={i} style={{ width: `${x * 100}%`, background: CH[i] }} />)}</span> : <span className="text-zinc-400">—</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}

function M({ label, v, tip }: { label: string; v: React.ReactNode; tip?: string }) {
  return (
    <div className="min-w-0" title={tip}>
      <div className="text-[10px] text-zinc-400">{label}</div>
      <div className="tabular truncate font-medium text-zinc-800">{v}</div>
    </div>
  );
}
