import { pageContext, withQs, type SP } from "@/server/context";
import { buildActions, actionStatuses, GROUP_LABEL, type ActionGroup } from "@/server/actions";
import { PageHeader, Tabs, Empty, Notice } from "@/components/ui";
import { ActionCard } from "@/components/ActionCard";
import { fmtDate } from "@/lib/dates";
import Link from "next/link";

const GROUPS: ("urgent" | ActionGroup)[] = ["urgent", "channel", "store", "sku", "merchandising"];

export default async function Actions({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const [{ actions, coverage }, statuses] = await Promise.all([buildActions(ctx), actionStatuses()]);
  const showClosed = ctx.sp.closed === "1";
  const open = actions.filter((a) => showClosed || (statuses.get(a.key) ?? "open") === "open");
  const g = (GROUPS.includes(ctx.sp.group as never) ? ctx.sp.group : "urgent") as (typeof GROUPS)[number];
  const count = (k: (typeof GROUPS)[number]) => (k === "urgent" ? open.filter((a) => a.priority === "urgent").length : open.filter((a) => a.group === k).length);
  const list = g === "urgent" ? open.filter((a) => a.priority === "urgent") : open.filter((a) => a.group === g);
  const closedCount = actions.length - actions.filter((a) => (statuses.get(a.key) ?? "open") === "open").length;
  const types = Array.from(new Set(list.map((a) => a.typeLabel)));
  const type = typeof ctx.sp.type === "string" && types.includes(ctx.sp.type) ? ctx.sp.type : null;
  const shown = type ? list.filter((a) => a.typeLabel === type) : list;
  return (
    <>
      <PageHeader title="Action Centre" subtitle={<>Measurable opportunities and risks · sales to {fmtDate(coverage.asOf, true)} · warehouse live</>}
        right={<Link href={withQs(ctx, "/actions", { closed: showClosed ? null : "1" })} className="text-[12px] text-zinc-500 hover:text-ink">{showClosed ? "Hide" : "Show"} done / dismissed ({closedCount})</Link>} />
      <Tabs active={g} tabs={GROUPS.map((k) => ({ key: k, label: k === "urgent" ? "Urgent" : GROUP_LABEL[k], count: count(k), href: withQs(ctx, "/actions", { group: k === "urgent" ? null : k, type: null }) }))} />
      {(g === "merchandising" || g === "store" || g === "urgent") && <Notice>Store-level stock comes from the store-inventory feed, which covers {coverage.feedStores} stores; allocation and in-store stock actions are limited to those stores.</Notice>}
      {types.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Link href={withQs(ctx, "/actions", { type: null })} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${!type ? "border-ink bg-ink text-white" : "border-line bg-white text-zinc-600 hover:border-zinc-300"}`}>All ({list.length})</Link>
          {types.map((t) => <Link key={t} href={withQs(ctx, "/actions", { type: t })} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${type === t ? "border-ink bg-ink text-white" : "border-line bg-white text-zinc-600 hover:border-zinc-300"}`}>{t} ({list.filter((a) => a.typeLabel === t).length})</Link>)}
        </div>
      )}
      {shown.length === 0 ? <Empty title="Nothing here">No {g === "urgent" ? "urgent" : GROUP_LABEL[g as ActionGroup].toLowerCase()} actions for the current category.</Empty> : (
        <div className="grid gap-2.5 xl:grid-cols-2">{shown.slice(0, 80).map((a) => <ActionCard key={a.key} a={a} qs={ctx.qs} status={statuses.get(a.key) ?? "open"} />)}</div>
      )}
      {shown.length > 80 && <p className="mt-3 text-center text-[12px] text-zinc-500">Showing the 80 highest-impact of {shown.length}.</p>}
    </>
  );
}
