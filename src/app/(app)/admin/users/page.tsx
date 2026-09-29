import { requireUser } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { PageHeader, Notice, Empty } from "@/components/ui";
import { UsersForm } from "@/components/AdminForms";

export default async function UsersPage() {
  let me;
  try { me = await requireUser("admin"); } catch { return <Empty title="Admin access required" />; }
  const users = dbConfigured() ? await q<{ email: string; role: string; active: boolean; last_seen_at: string | null }>("select email, role, active, last_seen_at::text from app_users order by role desc, email") : [];
  return (
    <>
      <PageHeader title="Users & Access" subtitle="People sign in with Google. Only emails listed here (or in ALLOWED_EMAILS / ADMIN_EMAILS) can get in. New users are viewers; grant editor to manage targets, admin to change settings. Disable to revoke access." />
      {!dbConfigured() && <Notice tone="warn">DATABASE_URL is not configured — only ADMIN_EMAILS / ALLOWED_EMAILS can sign in.</Notice>}
      <UsersForm users={users} me={me.email} readOnly={!dbConfigured()} />
    </>
  );
}
