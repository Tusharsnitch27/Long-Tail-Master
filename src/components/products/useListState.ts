"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Search / facet / sort state for a list, optionally mirrored to page-local URL params (q, <facet key>, sort) with
 * history.replaceState — shareable links without a server round trip. sort is "key" (descending) or "key.asc".
 */
export function useListState(o: { facets: string[]; defaultSort?: { key: string; desc?: boolean } | null; url?: boolean }) {
  const sp = useSearchParams();
  const [q, setQ] = useState(() => (o.url ? sp.get("q") ?? "" : ""));
  const [sel, setSel] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    if (o.url) for (const k of o.facets) { const v = sp.get(k); if (v) s[k] = v; }
    return s;
  });
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(() => {
    const s = o.url ? sp.get("sort") : null;
    if (s) { const [key, dir] = s.split("."); return { key, desc: dir !== "asc" }; }
    return o.defaultSort ? { key: o.defaultSort.key, desc: o.defaultSort.desc ?? true } : null;
  });
  const first = useRef(true);
  const facetKey = o.facets.join(",");
  const ds = o.defaultSort ? `${o.defaultSort.key}:${o.defaultSort.desc ?? true}` : "";
  useEffect(() => {
    if (!o.url) return;
    if (first.current) { first.current = false; return; }
    const p = new URLSearchParams(window.location.search);
    if (q.trim()) p.set("q", q.trim()); else p.delete("q");
    for (const k of facetKey.split(",").filter(Boolean)) (sel[k] ? p.set(k, sel[k]) : p.delete(k));
    const isDefault = sort ? `${sort.key}:${sort.desc}` === ds : !ds;
    if (sort && !isDefault) p.set("sort", sort.desc ? sort.key : `${sort.key}.asc`); else p.delete("sort");
    const s = p.toString();
    window.history.replaceState(null, "", s ? `${window.location.pathname}?${s}` : window.location.pathname);
  }, [q, sel, sort, o.url, facetKey, ds]);
  const setFacet = (k: string, v: string) => setSel((s) => { const n = { ...s }; if (v) n[k] = v; else delete n[k]; return n; });
  return { q, setQ, sel, setFacet, clear: () => { setQ(""); setSel({}); }, sort, setSort };
}

/** Page-local params that must not travel to a detail link. */
export const LOCAL_PARAMS = ["q", "sort", "view"];
