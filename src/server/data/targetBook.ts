import "server-only";
import { cached, invalidate } from "@/lib/cache";
import { eachDay, endOfMonth, startOfMonth } from "@/lib/dates";
import { dbConfigured, q, tx } from "../db";

/**
 * Targets set in the Control Centre (Postgres):
 *  - month_targets: channel × category × month (Stores = "Offline" in the business plan)
 *  - day_splits: daily phasing weights per channel (and per state for Stores); even split when none is set
 *  - store_month_targets: store × category × month, phased with the Stores split of the store's state
 * Rule for Stores: the plan's category target is the Stores target; store targets only spread it across stores/days. A mismatch is flagged as an action.
 */
export type TChannel = "stores" | "online" | "marketplace";
export interface MonthTarget { channel: TChannel; category: string; month: string; target: number; note: string | null; updated_by: string; updated_at: string }
export interface StoreMonthTarget { branch_code: string; category: string; month: string; target: number }

export interface TargetBook {
  months: MonthTarget[];
  stores: StoreMonthTarget[];
  /** month target for a channel over categories; null unless every category has one */
  month(channel: TChannel, cats: string[], month: string): number | null;
  /** per-category month targets that exist (for partial coverage notes) */
  coverage(channel: TChannel, cats: string[], month: string): { have: string[]; missing: string[] };
  /** share of the month on a day for a channel (state for Stores; falls back to all-India, then even) */
  share(channel: TChannel, day: string, state?: string | null): number;
  /** cumulative share of the month from the 1st to `day` inclusive */
  cumShare(channel: TChannel, day: string, state?: string | null): number;
  hasSplit(channel: TChannel, month: string): boolean;
}

type SplitRow = { channel: TChannel; state: string; day: string; weight: number };

export async function getTargetBook(fromMonth: string, toMonth: string = fromMonth): Promise<TargetBook> {
  const [months, splits, stores] = await Promise.all([
    listMonthTargets(fromMonth, toMonth),
    dbConfigured() ? cached(`split:${fromMonth}:${toMonth}`, 60, () => q<SplitRow>("select channel, state, to_char(day,'YYYY-MM-DD') as day, weight::float8 weight from day_splits where day between $1 and $2", [startOfMonth(fromMonth), endOfMonth(toMonth)])).catch(() => []) : Promise.resolve([]),
    listStoreTargets(fromMonth, toMonth),
  ]);
  // month totals of weights per channel/state/month for normalisation
  const w = new Map<string, number>(), tot = new Map<string, number>();
  for (const s of splits) { w.set(`${s.channel}|${s.state}|${s.day}`, s.weight); const k = `${s.channel}|${s.state}|${s.day.slice(0, 7)}`; tot.set(k, (tot.get(k) ?? 0) + s.weight); }
  const share = (channel: TChannel, day: string, state?: string | null) => {
    for (const st of [state?.toUpperCase(), "*"].filter(Boolean) as string[]) {
      const t = tot.get(`${channel}|${st}|${day.slice(0, 7)}`);
      if (t && t > 0) return (w.get(`${channel}|${st}|${day}`) ?? 0) / t;
    }
    return 1 / eachDay(startOfMonth(day), endOfMonth(day)).length;
  };
  const byKey = new Map(months.map((m) => [`${m.channel}|${m.category}|${m.month}`, m.target]));
  return {
    months, stores,
    month: (channel, cats, month) => {
      const v = cats.map((c) => byKey.get(`${channel}|${c}|${startOfMonth(month)}`));
      return v.every((x) => x != null) ? v.reduce((a, x) => a + (x as number), 0) : null;
    },
    coverage: (channel, cats, month) => ({ have: cats.filter((c) => byKey.has(`${channel}|${c}|${startOfMonth(month)}`)), missing: cats.filter((c) => !byKey.has(`${channel}|${c}|${startOfMonth(month)}`)) }),
    share,
    cumShare: (channel, day, state) => eachDay(startOfMonth(day), day).reduce((a, d) => a + share(channel, d, state), 0),
    hasSplit: (channel, month) => [...tot.keys()].some((k) => k.startsWith(`${channel}|`) && k.endsWith(`|${month.slice(0, 7)}`)),
  };
}

export function listMonthTargets(fromMonth: string, toMonth: string): Promise<MonthTarget[]> {
  if (!dbConfigured()) return Promise.resolve([]);
  return cached(`mt:${fromMonth}:${toMonth}`, 60, () =>
    q<Record<string, unknown>>(
      "select channel, category, to_char(month,'YYYY-MM-DD') as month, target::float8 target, note, updated_by, updated_at::text from month_targets where month between $1 and $2 order by month, channel, category",
      [startOfMonth(fromMonth), startOfMonth(toMonth)],
    ).then((r) => r as unknown as MonthTarget[]))
    // a failed read is never cached as "no targets"
    .catch((e) => { console.error("[targets] read failed", e); return []; });
}

export function listStoreTargets(fromMonth: string, toMonth: string): Promise<StoreMonthTarget[]> {
  if (!dbConfigured()) return Promise.resolve([]);
  return cached(`smt:${fromMonth}:${toMonth}`, 60, () =>
    q<Record<string, unknown>>("select branch_code, category, to_char(month,'YYYY-MM-DD') as month, target::float8 target from store_month_targets where month between $1 and $2", [startOfMonth(fromMonth), startOfMonth(toMonth)])
      .then((r) => r as unknown as StoreMonthTarget[]))
    .catch((e) => { console.error("[targets] store read failed", e); return []; });
}

export async function listSplits(month: string) {
  if (!dbConfigured()) return [];
  return q<SplitRow & { source: SplitSource }>("select channel, state, to_char(day,'YYYY-MM-DD') as day, weight::float8 weight, source from day_splits where day between $1 and $2 order by day", [startOfMonth(month), endOfMonth(month)]);
}

/** Which channel × state × month splits exist, and where they came from. */
export async function splitCoverage(fromMonth: string, toMonth: string) {
  if (!dbConfigured()) return [];
  return q<{ channel: TChannel; state: string; month: string; source: SplitSource; days: number }>(
    "select channel, state, to_char(date_trunc('month', day),'YYYY-MM-DD') as month, max(source) as source, count(*)::int as days from day_splits where day between $1 and $2 group by 1, 2, 3",
    [startOfMonth(fromMonth), endOfMonth(toMonth)]).catch(() => []);
}

const log = (c: { query: (s: string, p: unknown[]) => Promise<unknown> }, actor: string, action: string, entity: string, detail: unknown) =>
  c.query("insert into audit_log(actor, action, entity, detail) values ($1,$2,$3,$4)", [actor, action, entity, JSON.stringify(detail)]);

/** Upsert / delete month targets; every change is logged with old → new values. */
export async function saveMonthTargets(rows: { channel: TChannel; category: string; month: string; target: number | null; note?: string | null }[], actor: string, source: "manual" | "upload") {
  const changes: { channel: string; category: string; month: string; from: number | null; to: number | null }[] = [];
  await tx(async (c) => {
    for (const r of rows) {
      const cur = await c.query("select target::float8 t from month_targets where channel=$1 and category=$2 and month=$3", [r.channel, r.category, r.month]);
      const old = (cur.rows[0]?.t as number | undefined) ?? null;
      if (r.target == null) {
        if (old != null) { await c.query("delete from month_targets where channel=$1 and category=$2 and month=$3", [r.channel, r.category, r.month]); changes.push({ ...r, from: old, to: null }); }
        continue;
      }
      if (old != null && Math.abs(old - r.target) < 0.5) continue;
      await c.query(`insert into month_targets(channel, category, month, target, note, updated_by) values ($1,$2,$3,$4,$5,$6)
                     on conflict (channel, category, month) do update set target = excluded.target, note = coalesce(excluded.note, month_targets.note), updated_by = excluded.updated_by, updated_at = now()`,
        [r.channel, r.category, r.month, r.target, r.note ?? null, actor]);
      changes.push({ channel: r.channel, category: r.category, month: r.month, from: old, to: r.target });
    }
    if (changes.length) await log(c, actor, source, "month_targets", { changes });
  });
  invalidate("mt:"); invalidate("facts:"); invalidate("actions:"); invalidate("plan:");
  // read back what is now stored, so the screen shows the database — not what we hoped we wrote
  const keys = rows.map((r) => [r.channel, r.category, r.month] as const);
  const stored = keys.length ? await q<{ channel: string; category: string; month: string; target: number }>(
    "select channel, category, to_char(month,'YYYY-MM-DD') as month, target::float8 target from month_targets where (channel, category, month) in (select * from unnest($1::text[], $2::text[], $3::date[]))",
    [keys.map((k) => k[0]), keys.map((k) => k[1]), keys.map((k) => k[2])]) : [];
  const saved: Record<string, number | null> = {};
  for (const r of rows) saved[`${r.channel}|${r.category}|${r.month}`] = null;
  for (const r of stored) saved[`${r.channel}|${r.category}|${r.month}`] = r.target;
  const mismatched = rows.filter((r) => { const v = saved[`${r.channel}|${r.category}|${r.month}`]; return r.target == null ? v != null : v == null || Math.abs(v - r.target) >= 0.5; }).length;
  return { changed: changes.length, changes, saved, mismatched };
}

/** Replace the daily split for channel × state × month (weights; normalised when used). */
export type SplitSource = "manual" | "upload" | "actual" | "recommended";
export async function saveSplit(channel: TChannel, state: string, month: string, weights: { day: string; weight: number }[] | null, actor: string, source: SplitSource) {
  const ms = startOfMonth(month), me = endOfMonth(month);
  await tx(async (c) => {
    await c.query("delete from day_splits where channel=$1 and state=$2 and day between $3 and $4", [channel, state.toUpperCase(), ms, me]);
    for (const x of weights ?? []) if (x.day >= ms && x.day <= me) await c.query("insert into day_splits(channel, state, day, weight, updated_by, source) values ($1,$2,$3,$4,$5,$6)", [channel, state.toUpperCase(), x.day, x.weight, actor, source]);
    await log(c, actor, source, "day_splits", { channel, state, month: ms, days: weights?.length ?? 0, cleared: !weights });
  });
  invalidate("split:"); invalidate("facts:");
}

export async function saveStoreTargets(rows: { branch_code: string; category: string; month: string; target: number | null }[], actor: string, source: "manual" | "upload") {
  let n = 0;
  await tx(async (c) => {
    for (const r of rows) {
      if (r.target == null) { await c.query("delete from store_month_targets where branch_code=$1 and category=$2 and month=$3", [r.branch_code, r.category, r.month]); n++; continue; }
      await c.query(`insert into store_month_targets(branch_code, category, month, target, updated_by) values ($1,$2,$3,$4,$5)
                     on conflict (branch_code, category, month) do update set target = excluded.target, updated_by = excluded.updated_by, updated_at = now()`, [r.branch_code, r.category, r.month, r.target, actor]);
      n++;
    }
    await log(c, actor, source, "store_month_targets", { rows: n, months: [...new Set(rows.map((r) => r.month))], categories: [...new Set(rows.map((r) => r.category))] });
  });
  invalidate("smt:"); invalidate("facts:");
  return n;
}

export async function changeLog(limit = 100) {
  if (!dbConfigured()) return [];
  return q<{ id: number; actor: string; action: string; entity: string; entity_id: string | null; detail: unknown; at: string }>(
    "select id, actor, action, entity, entity_id, detail, at::text from audit_log order by at desc limit $1", [limit]);
}
