import { pageContext, withQs, type SP } from "@/server/context";
import { can } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { getFreshness } from "@/server/data/freshness";
import { channelFreshness } from "@/server/data/channels";
import { CATEGORIES } from "@/lib/categories";
import { PageHeader, Tabs, Empty, Notice, Section } from "@/components/ui";
import { SettingsForm, UsersForm } from "@/components/AdminForms";
import { TargetsPanel } from "@/components/TargetsPanel";

export const metadata = { title: "Settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  if (!can(ctx.user, "admin")) return <Empty title="Admin access required">Settings, targets and users are managed by admins.</Empty>;
  const tab = ["users", "rules"].includes(String(ctx.sp.tab)) ? String(ctx.sp.tab) : "targets";
  const tabs = [
    { key: "targets", label: "Targets", href: withQs(ctx, "/settings", { tab: null }) },
    { key: "users", label: "Users & access", href: "/settings?tab=users" },
    { key: "rules", label: "Rules & data", href: "/settings?tab=rules" },
  ];
  let body: React.ReactNode;
  if (tab === "targets") body = <TargetsPanel ctx={ctx} />;
  else if (tab === "users") {
    const users = dbConfigured()
      ? await q<{ username: string; name: string | null; role: string; active: boolean; has_password: boolean; last_seen_at: string | null; created_by: string | null }>(
          "select username, name, role, active, password_hash is not null has_password, last_seen_at::text, created_by from app_users order by role, username")
      : [];
    body = (
      <>
        {!dbConfigured() && <Notice tone="warn">DATABASE_URL is not configured — users can’t be managed.</Notice>}
        <UsersForm users={users} me={ctx.user!.username} readOnly={!dbConfigured()} />
      </>
    );
  } else {
    const [fresh, uc] = await Promise.all([getFreshness(), channelFreshness()]);
    const audit = dbConfigured() ? await q<{ actor: string; action: string; entity: string; entity_id: string | null; at: string }>("select actor, action, entity, entity_id, at::text from audit_log order by at desc limit 30") : [];
    body = (
      <>
        <SettingsForm initial={ctx.settings} categories={CATEGORIES.map((c) => ({ key: c.key, label: c.label, source: c.source }))} readOnly={!dbConfigured()} />
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Section title="Source freshness">
            <ul className="space-y-1 text-[12px]">
              {Object.entries(fresh.tables).map(([k, v]) => <li key={k} className="flex justify-between"><span className="font-mono text-zinc-600">{k}</span><span>{new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span></li>)}
              <li className="flex justify-between"><span className="font-mono text-zinc-600">UNICOMMERCE_FACT_ITEMS (latest item)</span><span>{uc ?? "—"}</span></li>
            </ul>
          </Section>
          <Section title="Recent audit log">
            {audit.length === 0 ? <div className="text-[12px] text-zinc-500">No entries.</div> : (
              <ul className="space-y-1 text-[12px]">{audit.map((a, i) => <li key={i} className="flex justify-between gap-2"><span>{a.actor} · {a.action} {a.entity} {a.entity_id ?? ""}</span><span className="text-zinc-500">{a.at.slice(0, 16)}</span></li>)}</ul>
            )}
          </Section>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Settings" subtitle="Targets, access and rules" />
      <Tabs active={tab} tabs={tabs} />
      {body}
    </>
  );
}
