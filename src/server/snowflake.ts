import "server-only";
import snowflake from "snowflake-sdk";
import { createPrivateKey } from "node:crypto";
import { cached } from "@/lib/cache";

snowflake.configure({ logLevel: "ERROR" });

type Pool = ReturnType<typeof snowflake.createPool>;
const g = globalThis as unknown as { __sfPool?: Pool };

function connectionOptions(): snowflake.ConnectionOptions {
  const e = process.env;
  const base = {
    account: req("SNOWFLAKE_ACCOUNT"),
    username: req("SNOWFLAKE_USERNAME"),
    role: e.SNOWFLAKE_ROLE,
    warehouse: e.SNOWFLAKE_WAREHOUSE,
    database: e.SNOWFLAKE_DATABASE,
    schema: e.SNOWFLAKE_SCHEMA,
    clientSessionKeepAlive: true,
  };
  if (e.SNOWFLAKE_PAT) {
    return { ...base, authenticator: "PROGRAMMATIC_ACCESS_TOKEN", token: e.SNOWFLAKE_PAT } as snowflake.ConnectionOptions;
  }
  if (e.SNOWFLAKE_PRIVATE_KEY) {
    const body = e.SNOWFLAKE_PRIVATE_KEY.replace(/-----[^-]+-----|\s/g, "");
    const pem = `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END ENCRYPTED PRIVATE KEY-----\n`;
    const privateKey = createPrivateKey({ key: pem, format: "pem", passphrase: e.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE })
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    return { ...base, authenticator: "SNOWFLAKE_JWT", privateKey };
  }
  throw new Error("Snowflake credentials missing: set SNOWFLAKE_PAT or SNOWFLAKE_PRIVATE_KEY");
}

function req(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}

function pool(): Pool {
  return (g.__sfPool ??= snowflake.createPool(connectionOptions(), { max: 6, min: 0, evictionRunIntervalMillis: 60_000, idleTimeoutMillis: 300_000 }));
}

export type Bind = string | number | null;

/** Run a query. Column names are lower-cased. Dates should be cast to VARCHAR in SQL. */
export async function sfQuery<T = Record<string, unknown>>(sqlText: string, binds: Bind[] = []): Promise<T[]> {
  const started = Date.now();
  const rows = await pool().use(
    (conn) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        conn.execute({
          sqlText,
          binds: binds as snowflake.Binds,
          complete: (err, _stmt, rows) => (err ? reject(err) : resolve((rows ?? []) as Record<string, unknown>[])),
        });
      }),
  );
  if (process.env.NODE_ENV !== "production" || Date.now() - started > 5000) {
    console.log(`[snowflake] ${Date.now() - started}ms ${rows.length} rows :: ${sqlText.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const k in r) o[k.toLowerCase()] = r[k];
    return o as T;
  });
}

export function sfCached<T = Record<string, unknown>>(key: string, sqlText: string, binds: Bind[] = [], ttl?: number) {
  const t = ttl ?? Number(process.env.SNOWFLAKE_CACHE_TTL ?? 600);
  return cached(`sf:${key}:${JSON.stringify(binds)}`, t, () => sfQuery<T>(sqlText, binds));
}
