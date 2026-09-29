import { requireUser } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { getSettings } from "@/server/settings";
import { getFreshness } from "@/server/data/freshness";
import { CATEGORIES } from "@/lib/categories";
import { PageHeader, Notice, Empty, Section } from "@/components/ui";
import { SettingsForm } from "@/components/AdminForms";

export default async function SettingsPage() {
  try { await requireUser("admin"); } catch { return <Empty title="Admin access required" />; }
  const [s, fresh] = await Promise.all([getSettings(), getFreshness()]);
  const audit = dbConfigured() ? await q<{ actor: string; action: string; entity: string; entity_id: string | null; at: string }>("select actor, action, entity, entity_id, at::text from audit_log order by at desc limit 30") : [];
  return (
    <>
      <PageHeader title="Settings" subtitle="Thresholds and rules are stored in PostgreSQL and apply to every view immediately." />
      {!dbConfigured() && <Notice tone="warn">DATABASE_URL is not configured — showing defaults (read-only).</Notice>}
      <SettingsForm initial={s} categories={CATEGORIES.map((c) => ({ key: c.key, label: c.label, source: c.source }))} readOnly={!dbConfigured()} />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Section title="Source table freshness (Snowflake)">
          <ul className="space-y-1 text-[12.5px]">{Object.entries(fresh.tables).map(([k, v]) => <li key={k} className="flex justify-between"><span className="font-mono">{k}</span><span>{new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span></li>)}</ul>
          <p className="mt-2 text-[11.5px] text-zinc-500">Query results are cached for {process.env.SNOWFLAKE_CACHE_TTL ?? 600}s (past months 6h).</p>
        </Section>
        <Section title="Recent audit log">
          {audit.length === 0 ? <div className="text-[12.5px] text-zinc-500">No entries.</div> : (
            <ul className="space-y-1 text-[12px]">{audit.map((a, i) => <li key={i} className="flex justify-between gap-2"><span>{a.actor} · {a.action} {a.entity} {a.entity_id ?? ""}</span><span className="text-zinc-500">{a.at.slice(0, 16)}</span></li>)}</ul>
          )}
        </Section>
      </div>
    </>
  );
}
