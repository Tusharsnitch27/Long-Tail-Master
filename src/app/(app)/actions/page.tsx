import Link from "next/link";
import { CalendarDays, MessageSquareText, Ban, AlarmClockOff } from "lucide-react";
import { pageContext, withQs, type SP } from "@/server/context";
import { buildActions, actionStatusDetails, type Action, type ActionGroup } from "@/server/actions";
import { listRemarks, type Remark } from "@/server/data/remarks";
import { dbConfigured } from "@/server/db";
import { PageHeader, Tabs, Kpi, KpiGrid, Section, Notice, Empty, Pill } from "@/components/ui";
import { ActionBoard } from "@/components/actions/ActionBoard";
import { RemarkForm } from "@/components/actions/RemarkForm";
import { RemarkRemove } from "@/components/actions/RemarkRemove";
import { fmtDate } from "@/lib/dates";
import { inr } from "@/lib/format";
import { catByKey, sortCats } from "@/lib/categories";
import { can } from "@/server/auth";

export const metadata = { title: "Action Centre" };

const KIND_META = {
  context: { label: "Context", icon: MessageSquareText, tone: "info" as const },
  not_applicable: { label: "Not applicable", icon: Ban, tone: "muted" as const },
  snooze: { label: "Snooze", icon: AlarmClockOff, tone: "warn" as const },
};

export default async function Actions({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const [{ actions, suppressed, coverage }, details, remarks] = await Promise.all([buildActions(ctx), actionStatusDetails(), listRemarks()]);
  const tab = ctx.sp.tab === "remarks" ? "remarks" : "actions";
  const statuses: Record<string, string> = {};
  for (const [k, v] of details) statuses[k] = v.status;
  const open = actions.filter((a) => (statuses[a.key] ?? "open") === "open");
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const doneWeek = [...details.values()].filter((d) => d.status === "done" && new Date(d.at).toISOString() >= weekAgo).length;
  const pc = (k: Action["priority"]) => open.filter((a) => a.priority === k).length;
  const stake = open.reduce((s, a) => s + a.impact, 0);
  const urgentStake = open.filter((a) => a.priority !== "medium").reduce((s, a) => s + a.impact, 0);
  const groupCount = (g: ActionGroup) => open.filter((a) => a.group === g).length;
  const cats = sortCats(ctx.filters.cats).map((k) => ({ key: k, label: catByKey(k)?.label ?? k }));
  const stores = ctx.stores.filter((s) => s.last_seen && s.last_seen >= "2000").map((s) => ({ code: s.branch_code, name: s.short_name })).sort((a, b) => a.name.localeCompare(b.name));

  // Keep the client payload bounded: all open (≤ 500 by priority/impact) + everything the team closed
  const raw = [...open.slice(0, 500), ...actions.filter((a) => (statuses[a.key] ?? "open") !== "open")];
  // roles without revenue access see the actions, never the ₹ amounts in them
  const hideMoney = (t: string) => t.replace(/[≈~]?\s*₹\s?[\d.,]+\s?(Cr|L|K)?(\/(day|month))?/g, "₹ —");
  const scrub = (a: Action): Action => ctx.access.revenue ? a : { ...a, title: hideMoney(a.title), reason: hideMoney(a.reason), recommendation: hideMoney(a.recommendation), impactLabel: "Impact in ₹ hidden for your access",
    evidence: a.evidence.map((e) => ({ ...e, value: hideMoney(e.value) })), notes: a.notes };
  const payload = raw.map(scrub);

  return (
    <>
      <PageHeader title="Action Centre"
        subtitle={<>What to act on next, with the evidence · sales to {fmtDate(coverage.asOf, true)} · store report {coverage.storeReportDate ? fmtDate(coverage.storeReportDate, true) : "—"} ({coverage.feedStores} stores) · warehouse live</>} />
      <Tabs active={tab} tabs={[
        { key: "actions", label: "Actions", count: open.length, href: withQs(ctx, "/actions", { tab: null }) },
        { key: "remarks", label: "Team remarks", count: remarks.length, href: withQs(ctx, "/actions", { tab: "remarks" }) },
      ]} />

      {tab === "actions" ? (
        <>
          <KpiGrid cols={5}>
            <Kpi label="Open actions" value={open.length.toLocaleString("en-IN")} tone={pc("urgent") ? "bad" : "info"}
              sub={<span><b className="text-rose-600">{pc("urgent")}</b> urgent · <b className="text-amber-700">{pc("high")}</b> high · {pc("medium")} medium</span>} />
            <Kpi label="₹ at stake (open)" value={inr(stake)} tip="Sum of each open action's estimated opportunity or risk. Estimates overlap across actions — use it to size, not to add to a plan."
              sub={<span>{inr(urgentStake)} in urgent + high</span>} />
            <Kpi label="By area" value={<span className="text-[15px]">{groupCount("store")} stores · {groupCount("sku")} SKU</span>}
              sub={<span>{groupCount("marketing")} marketing · {groupCount("merchandising")} merchandising · {groupCount("channel")} channel</span>} />
            <Kpi label="Done this week" value={doneWeek} tone={doneWeek ? "good" : "muted"} sub={<span>marked done in the last 7 days</span>} />
            <Kpi label="Team remarks" value={remarks.length} href={withQs(ctx, "/actions", { tab: "remarks" })}
              sub={<span>{suppressed.length} action{suppressed.length === 1 ? "" : "s"} hidden · {actions.filter((a) => a.notes?.length).length} annotated</span>} />
          </KpiGrid>
          <div className="mt-3">
            <Notice>
              <b>How to read this.</b> Every action is a measurable opportunity or risk with its evidence. Store actions only target stores where the category is <b>live</b> (stock on the latest store report, or a sale in the last 60 days); where it isn’t, you’ll see expansion or distribution suggestions instead of “push sales”. Something doesn’t apply? Use <b>Add remark</b> on the card — the engine and Harvey take it into account.
              {coverage.anomalyDays.length > 0 && (
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5"><CalendarDays className="size-3.5" />Anomaly days excluded from baselines:
                  {coverage.anomalyDays.map((d) => <Pill key={`${d.day}${d.category}`} tone="warn">{fmtDate(d.day)} · {d.text.slice(0, 40)}{d.category ? ` (${catByKey(d.category)?.label})` : ""}</Pill>)}
                </span>
              )}
            </Notice>
          </div>
          <ActionBoard actions={payload} hidden={suppressed.slice(0, 200).map(scrub)} statuses={statuses} categories={cats} qs={ctx.qs} initialGroup={typeof ctx.sp.group === "string" ? ctx.sp.group : undefined} />
        </>
      ) : (
        <RemarksTab remarks={remarks} actions={[...actions, ...suppressed]} ctx={{ byCode: ctx.byCode, canAdmin: can(ctx.user, "admin"), username: ctx.user?.username ?? null }} stores={stores} cats={cats} db={dbConfigured()} />
      )}
    </>
  );
}

function RemarksTab({ remarks, actions, ctx, stores, cats, db }: {
  remarks: Remark[]; actions: Action[]; ctx: { byCode: Map<string, { short_name: string }>; canAdmin: boolean; username: string | null };
  stores: { code: string; name: string }[]; cats: { key: string; label: string }[]; db: boolean;
}) {
  const byKey = new Map(actions.map((a) => [a.key, a]));
  const affected = new Map<number, number>();
  for (const a of actions) {
    for (const n of a.notes ?? []) affected.set(n.id, (affected.get(n.id) ?? 0) + 1);
    if (a.hiddenBy) affected.set(a.hiddenBy.id, (affected.get(a.hiddenBy.id) ?? 0) + 1);
  }
  const cl = (k: string | null) => (k ? catByKey(k)?.label ?? k : "");
  const scopeText = (r: Remark) => {
    const store = r.scope_id ? ctx.byCode.get(r.scope_id)?.short_name ?? r.scope_id : "";
    switch (r.scope) {
      case "action": return <>Action · <span className="text-zinc-700">{byKey.get(r.scope_id ?? "")?.title ?? r.scope_id}</span></>;
      case "store": return <>Store · <span className="text-zinc-700">{store}</span></>;
      case "store_category": return <>Store × category · <span className="text-zinc-700">{store} × {cl(r.category)}</span></>;
      case "product": return <>Product · <Link href={`/products/${encodeURIComponent(r.scope_id ?? "")}`} className="text-brand-700 hover:underline">{r.scope_id}</Link></>;
      case "category": return <>Category · <span className="text-zinc-700">{cl(r.category ?? r.scope_id)}</span></>;
      case "date": return <>Date · <span className="text-zinc-700">{r.day ? fmtDate(r.day, true) : "—"}{r.category ? ` · ${cl(r.category)}` : ""}</span></>;
      default: return <>General</>;
    }
  };
  const expired = (r: Remark) => r.kind === "snooze" && r.until != null && r.until < new Date().toISOString().slice(0, 10);
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
      <Section title="Active team remarks" tip="Remarks the Action Centre and Harvey take into account. Remove a remark when it no longer applies — nothing is deleted, it is kept in the audit log.">
        {!db ? <Empty title="Database not configured">Remarks need DATABASE_URL.</Empty> : remarks.length === 0 ? (
          <Empty title="No remarks yet">Add context the numbers can’t see — a store that doesn’t carry a category, a festival spike, a VM revamp, stock in transit. Use <b>Add remark</b> on any action, or the form on the right.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {remarks.map((r) => {
              const K = KIND_META[r.kind];
              return (
                <li key={r.id} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><K.icon className="size-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={K.tone}>{K.label}{r.kind === "snooze" && r.until ? ` until ${fmtDate(r.until)}` : ""}</Pill>
                      {expired(r) && <Pill tone="muted">expired</Pill>}
                      <span className="text-[11.5px] text-zinc-500">{scopeText(r)}</span>
                    </div>
                    <div className="mt-0.5 text-[13px] text-ink">{r.text}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">{r.created_by} · {new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{affected.get(r.id) ? ` · affects ${affected.get(r.id)} action${affected.get(r.id) === 1 ? "" : "s"}` : ""}{r.scope === "store_category" && r.kind === "not_applicable" ? " · category treated as not live in this store" : ""}</div>
                  </div>
                  {(ctx.canAdmin || ctx.username === r.created_by) && <RemarkRemove id={r.id} label="Deactivate" />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <div className="space-y-3">
        <Section title="Add a team remark" tip="Not tied to a specific action — e.g. an anomaly day, a store closure, a category a store doesn't carry.">
          <RemarkForm stores={stores} categories={cats} />
        </Section>
        <Section title="How remarks work">
          <ul className="space-y-1.5 text-[12px] text-zinc-600">
            <li><b className="text-zinc-800">Context</b> keeps the action and shows your note on it (“Team note”). On a <b>date</b>, it marks an anomaly day: left out of week-on-week and best-run baselines, and flagged on actions whose window includes it.</li>
            <li><b className="text-zinc-800">Not applicable</b> hides matching actions. On a <b>store × category</b> it also makes the category not live there, so no push-sales or expansion nudges appear.</li>
            <li><b className="text-zinc-800">Snooze</b> hides matching actions until the date, then they return if still true.</li>
            <li>Harvey reads active remarks, so its answers respect the same context.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

