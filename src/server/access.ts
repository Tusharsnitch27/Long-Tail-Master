import "server-only";
import { dbConfigured, q } from "./db";

const csv = (v?: string) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Who may sign in: ADMIN_EMAILS, ALLOWED_EMAILS, any domain in ALLOWED_EMAIL_DOMAINS (optional),
 * or an active user added by an admin in Users & Access (app_users).
 */
export async function isAllowed(email: string): Promise<boolean> {
  const e = email.toLowerCase();
  if (csv(process.env.ADMIN_EMAILS).includes(e) || csv(process.env.ALLOWED_EMAILS).includes(e)) return true;
  if (csv(process.env.ALLOWED_EMAIL_DOMAINS).includes(e.split("@")[1])) return true;
  if (!dbConfigured()) return false;
  try {
    const rows = await q<{ active: boolean }>("select active from app_users where email = $1", [e]);
    return rows[0]?.active === true;
  } catch (err) {
    console.error("[access] app_users lookup failed", err);
    return false;
  }
}

export const isBootstrapAdmin = (email: string) => csv(process.env.ADMIN_EMAILS).includes(email.toLowerCase());
