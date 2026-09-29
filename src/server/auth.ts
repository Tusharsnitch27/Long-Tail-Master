import "server-only";
import { cookies } from "next/headers";
import { cached, invalidate } from "@/lib/cache";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { dbConfigured, q } from "./db";
import { hashPassword, verifyPassword } from "./passwords";

export type Role = "viewer" | "admin";
export interface User { username: string; name: string; role: Role }
const RANK: Record<Role, number> = { viewer: 0, admin: 1 };

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

const envAdmin = () => {
  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  return username && password ? { username, password } : null;
};

async function identify(): Promise<string | null> {
  if (process.env.AUTH_MODE === "dev") {
    // never allow the dev identity in production unless explicitly forced (e.g. an internal-only preview)
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "true") return null;
    return process.env.DEV_USERNAME?.toLowerCase() ?? "dev";
  }
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  return session?.username.toLowerCase() ?? null;
}

/** Current user; re-checked every minute so disabling a user or changing a role takes effect without waiting for session expiry. */
export async function getUser(): Promise<User | null> {
  const username = await identify();
  if (!username) return null;
  return cached(`user:${username}`, 60, () => loadUser(username));
}

async function loadUser(username: string): Promise<User> {
  if (process.env.AUTH_MODE === "dev") return { username, name: "Developer", role: "admin" };
  const boot = envAdmin();
  if (!dbConfigured()) {
    if (boot && boot.username === username) return { username, name: "Admin", role: "admin" };
    throw new AuthError(401, "Unknown user");
  }
  const rows = await q<{ username: string; name: string | null; role: Role; active: boolean }>(
    "update app_users set last_seen_at = now() where username = $1 returning username, name, role, active", [username]);
  const u = rows[0];
  if (!u) throw new AuthError(401, "Your account no longer exists.");
  if (!u.active) throw new AuthError(403, "Your account has been disabled. Contact an admin.");
  return { username: u.username, name: u.name || u.username, role: u.role };
}

/** Creates the ADMIN_USERNAME account on first use if it doesn't exist yet (password from ADMIN_PASSWORD). */
let bootstrapped = false;
export async function ensureBootstrapAdmin() {
  if (bootstrapped) return;
  const boot = envAdmin();
  if (!boot || !dbConfigured()) return;
  const exists = await q("select 1 from app_users where username = $1", [boot.username]);
  if (exists.length && process.env.ADMIN_RESET_PASSWORD === "true") {
    // recovery switch: force the env admin back to an active admin with ADMIN_PASSWORD (remove the flag afterwards)
    await q("update app_users set password_hash = $2, role = 'admin', active = true, password_changed_at = now() where username = $1", [boot.username, await hashPassword(boot.password)]);
    invalidate(`user:${boot.username}`);
    console.log(`[auth] ADMIN_RESET_PASSWORD: password for "${boot.username}" reset from ADMIN_PASSWORD`);
    bootstrapped = true;
    return;
  }
  if (exists.length) { bootstrapped = true; return; }
  await q(
    `insert into app_users(username, name, role, active, password_hash, created_by, password_changed_at) values ($1, 'Admin', 'admin', true, $2, 'bootstrap', now())
     on conflict (username) do nothing`,
    [boot.username, await hashPassword(boot.password)],
  );
  console.log(`[auth] bootstrap admin "${boot.username}" created`);
  bootstrapped = true;
}

/** Returns the user on valid credentials, null otherwise (same response for unknown user / wrong password). */
export async function checkLogin(usernameRaw: string, password: string): Promise<User | null> {
  const username = usernameRaw.trim().toLowerCase();
  const boot = envAdmin();
  if (!dbConfigured()) {
    return boot && boot.username === username && boot.password === password ? { username, name: "Admin", role: "admin" } : null;
  }
  await ensureBootstrapAdmin();
  const rows = await q<{ username: string; name: string | null; role: Role; active: boolean; password_hash: string | null }>(
    "select username, name, role, active, password_hash from app_users where username = $1", [username]);
  const u = rows[0];
  // hash even when the user doesn't exist so timing doesn't reveal valid usernames
  const ok = await verifyPassword(password, u?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA");
  if (!u || !ok || !u.active) return null;
  invalidate(`user:${username}`);
  return { username: u.username, name: u.name || u.username, role: u.role };
}

export async function requireUser(minRole: Role = "viewer"): Promise<User> {
  const u = await getUser();
  if (!u) throw new AuthError(401, "Not signed in");
  if (RANK[u.role] < RANK[minRole]) throw new AuthError(403, `Requires ${minRole} access`);
  return u;
}

export const can = (u: User | null, role: Role) => !!u && RANK[u.role] >= RANK[role];
