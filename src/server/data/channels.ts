import "server-only";
import { CATEGORIES, MARKETPLACES, ONLINE, catByUc } from "@/lib/categories";
import { addDays, endOfMonth, istToday, maxDate, minDate, startOfMonth, type Range } from "@/lib/dates";
import { cached } from "@/lib/cache";
import { sfQuery, sfCached } from "../snowflake";

/**
 * Online (Shopify) + Marketplace sales from UNICOMMERCE_FACT_ITEMS_INTERMEDIATE.
 * Grain: one row per order item (quantity 1). Revenue = Σ SELLING_PRICE of all items, cancellations included (as in HORIZONTAL_SALES_CATEGORIES).
 */
const T = "SNITCH_DB.MAPLEMONK.UNICOMMERCE_FACT_ITEMS_INTERMEDIATE";
const MPS = [ONLINE, ...MARKETPLACES];
const ucNames = () => CATEGORIES.flatMap((c) => c.ucCategories);
const inList = (xs: readonly string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");
/** Revenue and units INCLUDE cancelled items (user decision, matches HORIZONTAL_SALES_CATEGORIES); cancellations are also counted separately. */
const CANCELLED = "sale_order_item_status = 'CANCELLED'";
/** Nykaa has three Unicommerce channels (NYKAA.COM, NYKAA_FASHION, NYKAA_SAPL_TAURU); they are one marketplace, "NYKAA". */
const MP = "iff(marketplace_mapped ilike 'NYKAA%', 'NYKAA', marketplace_mapped)";
/** Free gift = an item sold for under ₹10 (e.g. socks given with an order). Gifts are excluded from units, ASP and velocity; counted separately. */
export const FREE_GIFT_MAX = 10;
const PAID = `selling_price >= ${FREE_GIFT_MAX}`;

export interface ChannelDay { d: string; mp: string; c: string; items: number; revenue: number; mrp: number; orders: number; cancelled: number; gifts: number }

/** Day × marketplace × category, for one calendar month (cached; past months 6h). */
function month(m: string): Promise<ChannelDay[]> {
  const from = startOfMonth(m), to = endOfMonth(m);
  const ttl = to >= addDays(istToday(), -1) ? 600 : 6 * 3600;
  return cached(`uc:day:v3:${m}`, ttl, async () => {
    const rows = await sfQuery<Record<string, unknown>>(
      `select to_varchar(order_date) d, ${MP} mp, category cat,
              count_if(${PAID}) items, sum(selling_price) revenue, sum(iff(${PAID}, mrp, 0)) mrp,
              count_if(not (${PAID})) gifts, count(distinct order_id) orders, count_if(${CANCELLED}) cancelled
       from ${T} where order_date between ? and ? and ${MP} in (${inList(MPS)}) and category in (${inList(ucNames())})
       group by 1, 2, 3`,
      [from, to],
    );
    return rows.flatMap((r) => {
      const c = catByUc(String(r.cat));
      return c ? [{ d: String(r.d), mp: String(r.mp), c: c.key, items: +(r.items as number) || 0, revenue: +(r.revenue as number) || 0, mrp: +(r.mrp as number) || 0, orders: +(r.orders as number) || 0, cancelled: +(r.cancelled as number) || 0, gifts: +(r.gifts as number) || 0 }] : [];
    });
  });
}

export async function getChannelDaily(range: Range): Promise<ChannelDay[]> {
  const months: string[] = [];
  for (let m = startOfMonth(range.from); m <= range.to; m = startOfMonth(addDays(endOfMonth(m), 1))) months.push(m);
  return (await Promise.all(months.map(month))).flat();
}

export interface ChannelSku { sku: string; c: string; mp: string; rs: number; rq: number; ps: number; pq: number; l7s: number; l7q: number; p7s: number; p7q: number; l30s: number; l30q: number; last: string | null }

/** SKU group × marketplace aggregates for a period, its comparison and rolling windows ending at asOf. */
export async function getChannelSku(o: { range: Range; compare: Range; asOf: string }): Promise<ChannelSku[]> {
  const { range, compare, asOf } = o;
  const lo = minDate(minDate(range.from, compare.from), addDays(asOf, -89)), hi = maxDate(range.to, asOf);
  const w = (col: string) => `sum(iff(order_date between ? and ?, ${col}, 0))`;
  const binds = [range.from, range.to, range.from, range.to, compare.from, compare.to, compare.from, compare.to,
    addDays(asOf, -6), asOf, addDays(asOf, -6), asOf, addDays(asOf, -13), addDays(asOf, -7), addDays(asOf, -13), addDays(asOf, -7),
    addDays(asOf, -29), asOf, addDays(asOf, -29), asOf, lo, hi];
  const rows = await sfCached<Record<string, unknown>>(
    "uc:sku:v3",
    `select sku_group sku, any_value(category) cat, ${MP} mp,
       ${w("selling_price")} rs, ${w(`iff(${PAID}, 1, 0)`)} rq, ${w("selling_price")} ps, ${w(`iff(${PAID}, 1, 0)`)} pq,
       ${w("selling_price")} l7s, ${w(`iff(${PAID}, 1, 0)`)} l7q, ${w("selling_price")} p7s, ${w(`iff(${PAID}, 1, 0)`)} p7q, ${w("selling_price")} l30s, ${w(`iff(${PAID}, 1, 0)`)} l30q,
       to_varchar(max(order_date)) last
     from ${T} where order_date between ? and ? and ${MP} in (${inList(MPS)}) and category in (${inList(ucNames())})
     group by 1, 3`,
    binds,
  );
  return rows.flatMap((r) => {
    const c = catByUc(String(r.cat));
    const n = (k: string) => +(r[k] as number) || 0;
    return c ? [{ sku: String(r.sku), c: c.key, mp: String(r.mp), rs: n("rs"), rq: n("rq"), ps: n("ps"), pq: n("pq"), l7s: n("l7s"), l7q: n("l7q"), p7s: n("p7s"), p7q: n("p7q"), l30s: n("l30s"), l30q: n("l30q"), last: (r.last as string) ?? null }] : [];
  });
}

/** Daily revenue/units for a set of products across Online + Marketplace. */
export async function getChannelSkuDaily(skus: string[], range: Range) {
  if (!skus.length) return [];
  const rows = await sfCached<{ d: string; mp: string; revenue: number; units: number }>(
    "uc:skudaily:v3",
    `select to_varchar(order_date) d, ${MP} mp, sum(selling_price) revenue, count_if(${PAID}) units from ${T}
     where sku_group in (select value::string from table(flatten(parse_json(?)))) and order_date between ? and ? and ${MP} in (${inList(MPS)})
     group by 1, 2`,
    [JSON.stringify([...skus].sort()), range.from, range.to],
  );
  return rows.map((r) => ({ ...r, revenue: +r.revenue || 0, units: +r.units || 0 }));
}

/** Latest item timestamp (sales freshness for Online/Marketplace). */
export async function channelFreshness() {
  const r = await sfCached<{ ts: string | null }>("uc:fresh", `select to_varchar(max(uc_created), 'YYYY-MM-DD"T"HH24:MI:SS') ts from ${T} where order_date >= dateadd(day, -3, current_date)`, [], 300);
  return r[0]?.ts ?? null;
}
