import "server-only";
import { headers } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cached } from "@/lib/cache";
import { dbConfigured, q } from "./db";

export type Role = "viewer" | "editor" | "admin";
export interface User { email: string; name: string; role: Role }
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

const csv = (v?: string) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const g = globalThis as unknown as { __jwks?: ReturnType<typeof createRemoteJWKSet> };

async function identify(): Promise<string | null> {
  const h = await headers();
  const mode = process.env.AUTH_MODE ?? "cloudflare";
  if (mode === "dev") {
    // never allow the dev identity in production unless explicitly forced (e.g. an internal-only preview)
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "true") return null;
    return process.env.DEV_USER_EMAIL?.toLowerCase() ?? "dev@snitch.com";
  }

  const team = process.env.CF_ACCESS_TEAM_DOMAIN;
  const aud = process.env.CF_ACCESS_AUD;
  if (team && aud) {
    const token = h.get("cf-access-jwt-assertion");
    if (!token) return null;
    g.__jwks ??= createRemoteJWKSet(new URL(`${team.replace(/\/$/, "")}/cdn-cgi/access/certs`));
    try {
      const { payload } = await jwtVerify(token, g.__jwks, { issuer: team.replace(/\/$/, ""), audience: aud });
      return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    } catch {
      return null;
    }
  }
  // Without AUD configured we trust the header set by Cloudflare Access (the origin must only be reachable via Access).
  return h.get("cf-access-authenticated-user-email")?.toLowerCase() ?? null;
}

export async function getUser(): Promise<User | null> {
  const email = await identify();
  if (!email) return null;
  const domains = csv(process.env.ALLOWED_EMAIL_DOMAINS);
  if (domains.length && !domains.includes(email.split("@")[1])) return null;
  return cached(`user:${email}`, 60, () => loadUser(email));
}

async function loadUser(email: string): Promise<User> {
  const isBootstrapAdmin = csv(process.env.ADMIN_EMAILS).includes(email);
  const name = email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const fallback: User = { email, name, role: isBootstrapAdmin ? "admin" : "viewer" };
  if (!dbConfigured()) return fallback;
  let rows;
  try {
    rows = await q<{ email: string; name: string; role: Role; active: boolean }>(
      `insert into app_users(email, name, role, last_seen_at) values ($1, $2, $3, now())
       on conflict (email) do update set last_seen_at = now(),
         role = case when $3 = 'admin' then 'admin' else app_users.role end
       returning email, name, role, active`,
      [email, name, isBootstrapAdmin ? "admin" : "viewer"],
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
