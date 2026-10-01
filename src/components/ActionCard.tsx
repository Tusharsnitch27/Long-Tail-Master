import Link from "next/link";
import { Store, TrendingDown, Boxes, Truck, Target, MessageSquareText, EyeOff, CalendarDays, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { catByKey } from "@/lib/categories";
import type { Action } from "@/server/actions";
import { Thumb } from "@/components/ui";
import { ActionControls } from "./ActionStatus";
import { RemarkRemove } from "./actions/RemarkRemove";

const PRI = {
  urgent: "bg-rose-50 text-rose-700 ring-rose-200",
  high: "bg-amber-50 text-amber-800 ring-amber-200",
  medium: "bg-zinc-100 text-zinc-600 ring-zinc-200",
} as const;
const STRIPE = { urgent: "bg-rose-500", high: "bg-amber-400", medium: "bg-brand-200" } as const;
const GROUP_ICON = { channel: TrendingDown, store: Store, sku: Boxes, merchandising: Truck } as const;
const CONF = { high: "●●●", medium: "●●○", low: "●○○" } as const;

const fmt = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** One action: what · why (evidence) · recommended action · impact · confidence · links · team notes · controls. */
export function ActionCard({ a, compact, qs = "", status }: { a: Action; compact?: boolean; qs?: string; status?: string | null }) {
  const withQs = (h: string) => (qs ? `${h}${h.includes("?") ? "&" : "?"}${qs}` : h);
  const Icon = a.type === "target_mismatch" || a.type === "target_not_live" ? Target : a.type === "category_expansion" ? Sparkles : GROUP_ICON[a.group];
  const cat = a.category ? catByKey(a.category) : null;
  const closed = !!status && status !== "open";
  const links = (
    <span className="flex flex-wrap items-center gap-3 text-[11.5px]">
      {a.links.map((l) => <Link key={l.href} href={withQs(l.href)} className="font-medium text-brand-700 hover:underline">{l.label} →</Link>)}
      {!compact && <Link href={`/harvey?q=${encodeURIComponent(`Explain this action and what I should do: ${a.title}`)}`} className="text-zinc-500 hover:text-brand-700">Ask Harvey</Link>}
    </span>
  );

  if (compact) {
    return (
      <div className={cn("relative overflow-hidden rounded-lg border border-line bg-white p-3 pl-3.5 transition-colors hover:border-brand-200", closed && "opacity-60")}>
        <span className={cn("absolute inset-y-0 left-0 w-[3px]", STRIPE[a.priority])} />
        <div className="flex items-start gap-2.5">
          {a.product ? <Thumb src={a.product.image} size={44} /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600"><Icon className="size-4" /></span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn("rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1", PRI[a.priority])}>{a.priority}</span>
              <span className="text-[11px] text-zinc-500">{a.typeLabel}</span>
            </div>
            <div className="mt-0.5 text-[12.5px] font-medium leading-snug text-ink">{a.title}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {a.evidence.slice(0, 3).map((e) => <span key={e.label} className="tabular rounded-md bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600 ring-1 ring-zinc-100">{e.label} <b className="font-semibold text-zinc-800">{e.value}</b></span>)}
            </div>
            {a.notes?.[0] && <div className="mt-1 truncate text-[11px] text-brand-800"><MessageSquareText className="mr-1 inline size-3" />Team note: {a.notes[0].text}</div>}
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px]"><span className="tabular font-semibold text-zinc-800">{a.impactLabel}</span>{links}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <article className={cn("relative overflow-hidden rounded-xl border border-line bg-white p-4 pl-5 shadow-[0_1px_2px_rgba(60,40,20,.04)] transition-colors hover:border-brand-200", closed && "opacity-70")}>
      <span className={cn("absolute inset-y-0 left-0 w-1", STRIPE[a.priority])} />
      <div className="flex items-start gap-3">
        {a.product ? <Thumb src={a.product.image} size={56} /> : <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Icon className="size-5" /></span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide ring-1", PRI[a.priority])}>{a.priority}</span>
            <span className="text-[11.5px] font-medium text-zinc-600">{a.typeLabel}</span>
            {cat && <span className="flex items-center gap-1 rounded-full bg-zinc-50 px-1.5 py-px text-[10.5px] text-zinc-600 ring-1 ring-zinc-100"><span className="size-1.5 rounded-full" style={{ background: cat.color }} />{cat.label}</span>}
            {a.store && <span className="truncate text-[11px] text-zinc-500">· {a.store.name}</span>}
            <span className="ml-auto whitespace-nowrap text-[10.5px] text-zinc-400" title={`${a.confidence} confidence`}><span className="tracking-[-0.1em] text-brand-500">{CONF[a.confidence]}</span> {a.confidence} confidence</span>
          </div>
          <h3 className="mt-1 text-[14px] font-semibold leading-snug text-ink">{a.title}</h3>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Why</div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-600">{a.reason}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {a.evidence.slice(0, 7).map((e) => <span key={e.label} className="tabular rounded-md bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600 ring-1 ring-zinc-100">{e.label} <b className="font-semibold text-zinc-800">{e.value}</b></span>)}
          </div>
        </div>
        <div className="rounded-lg bg-brand-50/70 px-3 py-2 lg:w-44 lg:text-right">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-brand-700/70">Impact</div>
          <div className="tabular text-[13px] font-semibold text-brand-900">{a.impactLabel}</div>
          {a.period && <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-brand-800/60 lg:justify-end"><CalendarDays className="size-3" />{fmt(a.period.from)} – {fmt(a.period.to)}</div>}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-brand-100 bg-white px-3 py-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-brand-700">Recommended action</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-800">{a.recommendation}</p>
      </div>

      {a.hiddenBy && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-zinc-50 px-3 py-1.5 text-[11.5px] text-zinc-600">
          <EyeOff className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">Hidden by a {a.hiddenBy.kind === "snooze" ? `snooze until ${a.hiddenBy.until ? fmt(a.hiddenBy.until) : "—"}` : "“not applicable” remark"}: “{a.hiddenBy.text}” — {a.hiddenBy.by}, {fmt(a.hiddenBy.at)}</span>
          <RemarkRemove id={a.hiddenBy.id} label="Unhide" confirmText="Remove this remark? Every action it hides will come back." />
        </div>
      )}
      {!!a.notes?.length && (
        <ul className="mt-2 space-y-1">
          {a.notes.slice(0, 3).map((n) => (
            <li key={n.id} className="flex items-start gap-1.5 rounded-lg bg-amber-50/70 px-3 py-1.5 text-[11.5px] text-amber-950 ring-1 ring-amber-100">
              {n.scope === "date" ? <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-amber-700" /> : <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-amber-700" />}
              <span><b className="font-semibold">{n.scope === "date" && n.day ? `Anomaly day ${fmt(n.day)}:` : "Team note:"}</b> {n.text} <span className="text-amber-800/60">— {n.by}, {fmt(n.at)}</span></span>
            </li>
          ))}
        </ul>
      )}

      <ActionControls actionKey={a.key} status={status ?? "open"} links={links}
        target={{ actionTitle: a.title, store: a.store ?? null, category: a.category, product: a.product ? { sku: a.product.sku, name: a.product.name } : null, period: a.period ?? null }} />
    </article>
  );
}
