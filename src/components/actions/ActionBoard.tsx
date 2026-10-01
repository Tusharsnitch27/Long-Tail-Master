"use client";
import { useMemo, useState } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Action, ActionGroup, Priority } from "@/server/actions";
import { ActionCard } from "@/components/ActionCard";

type View = "open" | "closed" | "hidden";
const GROUPS: { k: "all" | "urgent" | ActionGroup; label: string }[] = [
  { k: "all", label: "All" }, { k: "urgent", label: "Urgent" }, { k: "channel", label: "Channel" }, { k: "store", label: "Stores" }, { k: "sku", label: "SKU" }, { k: "merchandising", label: "Merchandising" }, { k: "marketing", label: "Marketing" },
];
const PAGE = 30;

/** Client-side filtering over the computed actions (search, group, type, category, priority, status view). */
export function ActionBoard({ actions, hidden, statuses, categories, initialGroup, qs = "" }: {
  actions: Action[];
  hidden: Action[];
  statuses: Record<string, string>;
  categories: { key: string; label: string }[];
  initialGroup?: string;
  qs?: string;
}) {
  const [view, setView] = useState<View>("open");
  const [group, setGroup] = useState<(typeof GROUPS)[number]["k"]>((GROUPS.some((g) => g.k === initialGroup) ? initialGroup : "all") as never);
  const [type, setType] = useState("");
  const [cat, setCat] = useState("");
  const [pri, setPri] = useState<"" | Priority>("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"priority" | "impact">("priority");
  const [limit, setLimit] = useState(PAGE);

  const st = (a: Action) => statuses[a.key] ?? "open";
  const pool = view === "hidden" ? hidden : actions.filter((a) => (view === "open" ? st(a) === "open" : st(a) !== "open"));
  const inGroup = (a: Action, g: (typeof GROUPS)[number]["k"]) => g === "all" || (g === "urgent" ? a.priority === "urgent" : a.group === g);
  const byGroup = pool.filter((a) => inGroup(a, group));
  const types = useMemo(() => Array.from(new Set(byGroup.map((a) => a.typeLabel))).sort(), [byGroup]);
  const needle = q.trim().toLowerCase();
  const shown = byGroup
    .filter((a) => (!type || a.typeLabel === type) && (!cat || a.category === cat) && (!pri || a.priority === pri))
    .filter((a) => !needle || [a.title, a.reason, a.recommendation, a.store?.name, a.product?.name, a.product?.sku, a.typeLabel, ...(a.notes ?? []).map((n) => n.text)].some((s) => s?.toLowerCase().includes(needle)));
  const order: Record<Priority, number> = { urgent: 0, high: 1, medium: 2 };
  const sorted = sort === "impact" ? [...shown].sort((x, y) => y.impact - x.impact) : [...shown].sort((x, y) => order[x.priority] - order[y.priority] || y.impact - x.impact);
  const filtersOn = !!(type || cat || pri || needle);
  const reset = () => { setType(""); setCat(""); setPri(""); setQ(""); setLimit(PAGE); };

  const closedCount = actions.filter((a) => st(a) !== "open").length;
  const sel = "h-8 rounded-lg border border-zinc-300 bg-white px-2 text-[12.5px] font-medium text-ink shadow-[0_1px_2px_rgba(60,40,20,.06)] outline-none hover:border-brand-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg border border-line bg-white p-0.5 scroll-thin">
          {GROUPS.map((g) => {
            const n = pool.filter((a) => inGroup(a, g.k)).length;
            return (
              <button key={g.k} onClick={() => { setGroup(g.k); setType(""); setLimit(PAGE); }}
                className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[12.5px] transition-colors", group === g.k ? "bg-brand-900 font-medium text-white" : "text-zinc-600 hover:bg-brand-50 hover:text-ink")}>
                {g.label}<span className={cn("tabular rounded px-1 text-[10.5px]", group === g.k ? "bg-white/20" : g.k === "urgent" && n ? "bg-rose-50 text-rose-700" : "bg-zinc-100 text-zinc-500")}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-0.5 rounded-lg border border-line bg-white p-0.5 text-[12px]">
          {([["open", `Open`], ["closed", `Done & dismissed (${closedCount})`], ["hidden", `Hidden by remarks (${hidden.length})`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setView(k); setLimit(PAGE); }} className={cn("rounded-md px-2.5 py-1 transition-colors", view === k ? "bg-brand-50 font-medium text-brand-800" : "text-zinc-500 hover:text-ink")}>{l}</button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 card rounded-[18px] p-2 shadow-[0_1px_2px_rgba(60,40,20,.04)]">
        <SlidersHorizontal className="ml-1 size-3.5 text-zinc-400" />
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-zinc-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search store, product, SKU or note…" className="h-8 w-full rounded-lg border border-zinc-300 bg-white pl-8 pr-2 text-[12.5px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
        </label>
        <select value={type} onChange={(e) => setType(e.target.value)} className={sel} aria-label="Type">
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{t} ({byGroup.filter((a) => a.typeLabel === t).length})</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={sel} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select value={pri} onChange={(e) => setPri(e.target.value as Priority | "")} className={sel} aria-label="Priority">
          <option value="">Any priority</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as "priority" | "impact")} className={sel} aria-label="Sort">
          <option value="priority">Sort: priority, then ₹</option><option value="impact">Sort: ₹ impact</option>
        </select>
        {filtersOn && <button onClick={reset} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-zinc-500 hover:bg-zinc-100 hover:text-ink"><X className="size-3" />Clear</button>}
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
          <div className="text-[13px] font-medium text-zinc-700">{view === "hidden" ? "No actions are hidden by remarks" : view === "closed" ? "Nothing marked done or dismissed yet" : "Nothing to act on here"}</div>
          <div className="mt-1 max-w-md text-[12.5px] text-zinc-500">{filtersOn ? "Try clearing the filters." : view === "open" ? "No open actions for this selection — the engine only raises measurable opportunities and risks." : ""}</div>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {sorted.slice(0, limit).map((a) => <ActionCard key={a.key} a={a} qs={qs} status={view === "hidden" ? "open" : st(a)} />)}
        </div>
      )}
      {sorted.length > limit && (
        <div className="mt-4 text-center">
          <button onClick={() => setLimit((l) => l + PAGE)} className="rounded-lg border border-line bg-white px-4 py-1.5 text-[12.5px] text-zinc-700 hover:border-brand-300">Show {Math.min(PAGE, sorted.length - limit)} more · {sorted.length - limit} remaining</button>
        </div>
      )}
    </div>
  );
}
