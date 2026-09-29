import "server-only";
import { cookies } from "next/headers";
import { cached } from "@/lib/cache";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { dbConfigured, q } from "./db";
import { isAllowed, isBootstrapAdmin } from "./access";

export type Role = "viewer" | "editor" | "admin";
export interface User { email: string; name: string; role: Role }
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

async function identify(): Promise<string | null> {
  if ((process.env.AUTH_MODE ?? "google") === "dev") {
    // never allow the dev identity in production unless explicitly forced (e.g. an internal-only preview)
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "true") return null;
    return process.env.DEV_USER_EMAIL?.toLowerCase() ?? "dev@snitch.com";
  }
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  return session?.email.toLowerCase() ?? null;
}

export async function getUser(): Promise<User | null> {
  const email = await identify();
  if (!email) return null;
  // re-checked every minute so removing someone from the allowlist takes effect without waiting for session expiry
  return cached(`user:${email}`, 60, async () => {
    if (process.env.AUTH_MODE !== "dev" && !(await isAllowed(email))) throw new AuthError(403, `${email} is not on the allowed list.`);
    return loadUser(email);
  });
}

async function loadUser(email: string): Promise<User> {
  const admin = isBootstrapAdmin(email);
  const name = email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const fallback: User = { email, name, role: admin ? "admin" : "viewer" };
  if (!dbConfigured()) return fallback;
  let rows;
  try {
    rows = await q<{ email: string; name: string; role: Role; active: boolean }>(
      `insert into app_users(email, name, role, last_seen_at) values ($1, $2, $3, now())
       on conflict (email) do update set last_seen_at = now(),
         role = case when $3 = 'admin' then 'admin' else app_users.role end
       returning email, name, role, active`,
      [email, name, admin ? "admin" : "viewer"],
    );
  } catch (e) {
    // Postgres unavailable: keep dashboards readable (Snowflake-only) rather than locking everyone out
    console.error("[auth] user lookup failed, using fallback role", e);
    return fallback;
  }
  const u = rows[0];
  if (!u.active) throw new AuthError(403, "Your access has been disabled. Contact an admin.");
  return { email: u.email, name: u.name ?? name, role: u.role };
}

export async function requireUser(minRole: Role = "viewer"): Promise<User> {
  const u = await getUser();
  if (!u) throw new AuthError(401, "Not signed in");
  if (RANK[u.role] < RANK[minRole]) throw new AuthError(403, `Requires ${minRole} access`);
  return u;
}

export const can = (u: User | null, role: Role) => !!u && RANK[u.role] >= RANK[role];
