import "server-only";
import { CATEGORIES, catByKey, type CategoryDef } from "@/lib/categories";
import { addDays, eachDay, endOfMonth, istToday, monthsBetween, startOfMonth, startOfWeek, type Range } from "@/lib/dates";
import { cached } from "@/lib/cache";
import { sfQuery } from "../snowflake";
import { getStoreMap } from "./stores";
import { listOverrides, type TargetOverride } from "./targets";
import { getTargetBook, type StoreMonthTarget, type TargetBook } from "./targetBook";
import type { Store } from "./stores";

/** One store × category × day. Includes future days of the month (target only) for projections. */
export interface Fact {
  d: string; // date
  b: string; // branch_code
  c: string; // category key
  s: number; // gross sales (DSR SALES, before returns)
  q: number; // units
  n: number | null; // bills (null when source has no bills)
  m: number; // MRP value
  st: number | null; // Snowflake target
  t: number | null; // effective target (after overrides)
}

const T = (t: string) => `SNITCH_DB.MAPLEMONK.${t}`;

function dsrSql(c: CategoryDef) {
  return `
    select to_varchar(coalesce(d.date, t.date)) d, coalesce(d.branch_code, t.branch_code) b, '${c.key}' c,
           coalesce(d.sales, 0) s, coalesce(d.qty, 0) q, coalesce(d.bills, 0) n, coalesce(d.mrp_sales, 0) m, t.target st
    from (select date, branch_code, sales, qty, bills, mrp_sales from ${T(c.dsrTable!)}
          where date between ? and ?
          qualify row_number() over (partition by date, branch_code order by target desc nulls last) = 1) d
    full outer join (select date, branch_code, max(target) target from ${T(c.targetTable!)} where date between ? and ? group by 1, 2) t
      on t.date = d.date and t.branch_code = d.branch_code`;
}

async function fetchMonth(month: string, catKeys: string[]): Promise<Fact[]> {
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const isCurrent = to >= addDays(istToday(), -1);
  const ttl = isCurrent ? Number(process.env.SNOWFLAKE_CACHE_TTL ?? 600) : 6 * 3600;
  return cached(`facts:raw:v2:${month}:${catKeys.join(",")}`, ttl, async () => {
    const cats = catKeys.map((k) => catByKey(k)!).filter(Boolean);
    const out: Fact[] = [];
    const dsr = cats.filter((c) => c.source === "dsr");
    if (dsr.length) {
      const sql = dsr.map(dsrSql).join(" union all ");
      const binds = dsr.flatMap(() => [from, to, from, to]);
      const rows = await sfQuery<{ d: string; b: string; c: string; s: number; q: number; n: number; m: number; st: number | null }>(sql, binds);
      for (const r of rows) out.push({ d: r.d, b: String(r.b), c: r.c, s: +r.s || 0, q: +r.q || 0, n: +r.n || 0, m: +r.m || 0, st: r.st == null ? null : +r.st, t: null });
    }
    const sales = cats.filter((c) => c.source === "sales");
    if (sales.length) {
      const { byName } = await getStoreMap();
      const rows = await sfQuery<{ d: string; ch: string; cat: string; s: number; q: number; m: number }>(
        `select to_varchar(date) d, channel ch, category cat, sum(gross_sales) s, sum(iff(gross_sales >= 10 * gross_quantity, gross_quantity, 0)) q, sum(iff(gross_sales >= 10 * gross_quantity, price * gross_quantity, 0)) m
         from ${T("HORIZONTAL_SALES_CATEGORIES")} where type = 'Store' and date between ? and ? and category in (${sales.map(() => "?").join(",")})
         group by 1, 2, 3`,
        [from, to, ...sales.map((c) => c.salesCategory)],
      );
      for (const r of rows) {
        const store = byName.get(String(r.ch).trim().toUpperCase());
        const cat = sales.find((c) => c.salesCategory === r.cat);
        if (!store || !cat) continue;
        out.push({ d: r.d, b: store.branch_code, c: cat.key, s: +r.s || 0, q: +r.q || 0, n: null, m: +r.m || 0, st: null, t: null });
      }
    }
    return out;
  });
}

/**
 * Resolution order for a store-day target: day override > week override > month override > Snowflake target.
 * Week/month overrides are phased using the Snowflake daily target shape (even split when no shape exists).
 * Category-level ('*') month overrides then scale every store in that category-month to the new total.
 */
function applyOverrides(facts: Fact[], overrides: TargetOverride[], storeCodes: string[]): Fact[] {
  for (const f of facts) f.t = f.st;
  if (!overrides.length) return facts;
  const key = (b: string, c: string, d: string) => `${b}|${c}|${d}`;
  const idx = new Map(facts.map((f) => [key(f.b, f.c, f.d), f]));
  const minD = facts.reduce((m, f) => (f.d < m ? f.d : m), "9999");
  const maxD = facts.reduce((m, f) => (f.d > m ? f.d : m), "0000");
  const ensure = (b: string, c: string, d: string) => {
    let f = idx.get(key(b, c, d));
    if (!f) {
      f = { d, b, c, s: 0, q: 0, n: catByKey(c)?.source === "dsr" ? 0 : null, m: 0, st: null, t: null };
      facts.push(f);
      idx.set(key(b, c, d), f);
    }
    return f;
  };
  const spread = (b: string, c: string, days: string[], value: number) => {
    const rows = days.filter((d) => d >= minD && d <= maxD).map((d) => ensure(b, c, d));
    const shape = rows.reduce((a, f) => a + (f.st ?? 0), 0);
    for (const f of rows) f.t = shape > 0 ? (value * (f.st ?? 0)) / shape : value / rows.length;
  };
  const daysOf = (o: TargetOverride) =>
    o.grain === "day" ? [o.period_start] : o.grain === "week" ? eachDay(startOfWeek(o.period_start), addDays(startOfWeek(o.period_start), 6)) : eachDay(startOfMonth(o.period_start), endOfMonth(o.period_start));

  const storeLevel = overrides.filter((o) => o.branch_code !== "*");
  for (const grain of ["month", "week", "day"] as const) {
    for (const o of storeLevel.filter((x) => x.grain === grain)) spread(o.branch_code, o.category, daysOf(o), o.target);
  }
  for (const o of overrides.filter((x) => x.branch_code === "*" && x.grain === "month")) {
    const ms = startOfMonth(o.period_start), me = endOfMonth(o.period_start);
    const rows = facts.filter((f) => f.c === o.category && f.d >= ms && f.d <= me);
    const total = rows.reduce((a, f) => a + (f.t ?? 0), 0);
    if (total > 0) for (const f of rows) f.t = ((f.t ?? 0) * o.target) / total;
    else if (storeCodes.length) {
      const days = eachDay(ms, me);
      for (const b of storeCodes) for (const d of days) ensure(b, o.category, d).t = o.target / (storeCodes.length * days.length);
    }
  }
  return facts;
}

/**
 * Store-level month targets from the Control Centre replace the Snowflake store targets for that category-month
 * (stores without an uploaded target then carry none), phased with the Stores split for the store's state.
 */
function applyStoreTargets(facts: Fact[], smt: StoreMonthTarget[], book: TargetBook, byCode: Map<string, Store>) {
  if (!smt.length) return facts;
  const groups = new Map<string, StoreMonthTarget[]>();
  for (const t of smt) { const k = `${t.category}|${t.month}`; groups.set(k, [...(groups.get(k) ?? []), t]); }
  const idx = new Map(facts.map((f) => [`${f.b}|${f.c}|${f.d}`, f]));
  for (const [k, ts] of groups) {
    const [c, month] = k.split("|");
    const ms = startOfMonth(month), me = endOfMonth(month);
    for (const f of facts) if (f.c === c && f.d >= ms && f.d <= me) f.t = null;
    for (const t of ts) {
      const state = byCode.get(t.branch_code)?.state ?? null;
      for (const d of eachDay(ms, me)) {
        let f = idx.get(`${t.branch_code}|${c}|${d}`);
        if (!f) { f = { d, b: t.branch_code, c, s: 0, q: 0, n: catByKey(c)?.source === "dsr" ? 0 : null, m: 0, st: null, t: null }; facts.push(f); idx.set(`${t.branch_code}|${c}|${d}`, f); }
        f.t = t.target * book.share("stores", d, state);
      }
    }
  }
  return facts;
}

/** Facts for every day of every month touched by `range` (full months, so month targets & projections are complete). */
export async function getFacts(range: Range, catKeys: string[]): Promise<Fact[]> {
  const keys = catKeys.filter((k) => CATEGORIES.some((c) => c.key === k)).sort();
  const months = monthsBetween(startOfMonth(range.from), range.to);
  const from = months[0], to = endOfMonth(months[months.length - 1]);
  return cached(`facts:eff:${from}:${to}:${keys.join(",")}`, 60, async () => {
    const [chunks, overrides, { stores, byCode }, book] = await Promise.all([
      Promise.all(months.map((m) => fetchMonth(m, keys))),
      listOverrides(from, to),
      getStoreMap(),
      getTargetBook(from, months[months.length - 1]),
    ]);
    const facts = chunks.flat().map((f) => ({ ...f }));
    const relevant = overrides.filter((o) => keys.includes(o.category));
    applyOverrides(facts, relevant, stores.map((s) => s.branch_code));
    return applyStoreTargets(facts, book.stores.filter((t) => keys.includes(t.category)), book, byCode);
  });
}
