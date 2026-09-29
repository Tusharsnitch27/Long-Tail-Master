import { requireUser } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { PageHeader, Notice, Empty } from "@/components/ui";
import { UsersForm } from "@/components/AdminForms";

export default async function UsersPage() {
  let me;
  try { me = await requireUser("admin"); } catch { return <Empty title="Admin access required" />; }
  const users = dbConfigured()
    ? await q<{ username: string; name: string | null; role: string; active: boolean; has_password: boolean; last_seen_at: string | null; created_by: string | null }>(
        "select username, name, role, active, password_hash is not null has_password, last_seen_at::text, created_by from app_users order by role, username")
    : [];
  return (
    <>
      <PageHeader title="Users & Access" subtitle="Create accounts and set passwords. Viewers can see every dashboard and the AI Bot; admins can also manage targets, settings and users." />
      {!dbConfigured() && <Notice tone="warn">DATABASE_URL is not configured — only the ADMIN_USERNAME / ADMIN_PASSWORD account can sign in, and users can’t be managed.</Notice>}
      <UsersForm users={users} me={me.username} readOnly={!dbConfigured()} />
    </>
  );
}
