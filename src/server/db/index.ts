import "server-only";
import { Pool, type PoolClient } from "pg";
import { MIGRATIONS } from "./migrations";

const g = globalThis as unknown as { __pg?: Pool; __pgMigrated?: Promise<void> };

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

function pool() {
  if (!g.__pg) {
    g.__pg = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 8),
      ssl: /sslmode=require/.test(process.env.DATABASE_URL ?? "") ? { rejectUnauthorized: false } : undefined,
    });
    // an idle client dropping (db restart, network blip) must not crash the process
    g.__pg.on("error", (e) => console.error("[db] idle client error", e.message));
  }
  return g.__pg;
}

export async function migrate() {
  if (!dbConfigured()) return;
  g.__pgMigrated ??= (async () => {
    let c: PoolClient;
    try {
      c = await pool().connect();
    } catch (e) {
      g.__pgMigrated = undefined; // retry on the next request instead of caching the failure
      throw e;
    }
    try {
      await c.query("select pg_advisory_lock(424242)");
      await c.query("create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())");
      const { rows } = await c.query<{ version: number }>("select version from schema_migrations");
      const done = new Set(rows.map((r) => r.version));
      for (const m of MIGRATIONS) {
        if (done.has(m.version)) continue;
        await c.query("begin");
        await c.query(m.sql);
        await c.query("insert into schema_migrations(version) values ($1)", [m.version]);
        await c.query("commit");
        console.log(`[db] applied migration ${m.version} ${m.name}`);
      }
    } catch (e) {
      await c.query("rollback").catch(() => {});
      g.__pgMigrated = undefined;
      throw e;
    } finally {
      await c.query("select pg_advisory_unlock(424242)").catch(() => {});
      c.release();
    }
  })();
  return g.__pgMigrated;
}

export async function q<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []) {
  await migrate();
  const r = await pool().query<T>(text, params);
  return r.rows;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await migrate();
  const c = await pool().connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
