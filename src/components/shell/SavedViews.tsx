"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bookmark, Plus, X } from "lucide-react";

interface View { id: number; name: string; path: string; query: string; shared: boolean }

export function SavedViews() {
  const path = usePathname();
  const sp = useSearchParams();
  const [views, setViews] = useState<View[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/views").then((r) => r.json()).then((j) => setViews(j.rows ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  async function save() {
    const name = window.prompt("Name this view (current page + filters)");
    if (!name) return;
    const res = await fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, path, query: sp.toString() }) });
    if (!res.ok) setErr((await res.json()).error); else { setErr(null); load(); }
  }
  async function remove(id: number) {
    await fetch(`/api/views?id=${id}`, { method: "DELETE" });
    load();
  }
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between px-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
        Saved views
        <button aria-label="Save current view" title="Save current page + filters" onClick={save} className="rounded p-0.5 hover:bg-zinc-100 hover:text-zinc-700"><Plus className="size-3.5" /></button>
      </div>
      {views.length === 0 && <div className="px-2 text-[11.5px] text-zinc-400">Save a page with its filters to reopen it later.</div>}
      {views.map((v) => (
        <div key={v.id} className="group flex items-center rounded-md hover:bg-zinc-100">
          <Link href={v.query ? `${v.path}?${v.query}` : v.path} className="flex flex-1 items-center gap-1.5 truncate px-2 py-1 text-[12.5px] text-zinc-700">
            <Bookmark className="size-3 shrink-0 text-zinc-400" /><span className="truncate">{v.name}</span>
          </Link>
          <button aria-label={`Delete ${v.name}`} onClick={() => remove(v.id)} className="mr-1 hidden rounded p-0.5 text-zinc-400 hover:text-zinc-700 group-hover:block"><X className="size-3" /></button>
        </div>
      ))}
      {err && <div className="px-2 text-[11px] text-rose-600">{err}</div>}
    </div>
  );
}
