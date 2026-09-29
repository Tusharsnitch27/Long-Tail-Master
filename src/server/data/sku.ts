import "server-only";
import { catByKey, catBySalesName } from "@/lib/categories";
import { addDays, maxDate, minDate, startOfMonth, type Range } from "@/lib/dates";
import type { Filters } from "@/lib/filters";
import { sfCached } from "../snowflake";

/** SKU × store (or × online channel) sales aggregates from HORIZONTAL_SALES_CATEGORIES (gross, line-level source). */
export interface SkuStoreFact {
  sku: string;
  c: string; // category key
  ch: string; // store name (type=Store) or channel
  type: string;
  rs: number; rq: number; // selected range
  ps: number; pq: number; // comparison range
  l7s: number; l7q: number; p7s: number; p7q: number; // last 7 / prior 7 (to asOf)
  l30s: number; l30q: number;
  mtds: number; mtdq: number;
  disc: number; // discount amount in range
  last: string | null; // last sale date (90d lookback)
  price: number | null;
}

const TYPES: Record<Filters["ch"], string[]> = { store: ["Store"], shopify: ["Shopify"], marketplace: ["Marketplace"], all: ["Store", "Shopify", "Marketplace"] };

export async function getSkuFacts(opts: { range: Range; compare: Range; asOf: string; cats: string[]; ch: Filters["ch"] }): Promise<SkuStoreFact[]> {
  const { range, compare, asOf, ch } = opts;
  const cats = opts.cats.map((k) => catByKey(k)!).filter(Boolean);
  const lo = minDate(minDate(range.from, compare.from), addDays(asOf, -89));
  const hi = maxDate(range.to, asOf);
  const types = TYPES[ch];
  const binds = [
    range.from, range.to, range.from, range.to, compare.from, compare.to, compare.from, compare.to,
    addDays(asOf, -6), asOf, addDays(asOf, -6), asOf, addDays(asOf, -13), addDays(asOf, -7), addDays(asOf, -13), addDays(asOf, -7),
    addDays(asOf, -29), asOf, addDays(asOf, -29), asOf, startOfMonth(asOf), asOf, startOfMonth(asOf), asOf,
    range.from, range.to,
    lo, hi, ...types, ...cats.map((c) => c.salesCategory),
  ];
  const w = (col: string) => `sum(iff(date between ? and ?, ${col}, 0))`;
  const rows = await sfCached<Record<string, unknown>>(
    "skufacts",
    `select sku_group sku, category cat, trim(channel) ch, type,
       ${w("gross_sales")} rs, ${w("gross_quantity")} rq, ${w("gross_sales")} ps, ${w("gross_quantity")} pq,
       ${w("gross_sales")} l7s, ${w("gross_quantity")} l7q, ${w("gross_sales")} p7s, ${w("gross_quantity")} p7q,
       ${w("gross_sales")} l30s, ${w("gross_quantity")} l30q, ${w("gross_sales")} mtds, ${w("gross_quantity")} mtdq,
       ${w("discount_amount")} disc,
       to_varchar(max(date)) last, max(price) price
     from SNITCH_DB.MAPLEMONK.HORIZONTAL_SALES_CATEGORIES
     where date between ? and ? and type in (${types.map(() => "?").join(",")}) and category in (${cats.map(() => "?").join(",")})
     group by 1, 2, 3, 4`,
    binds,
  );
  return rows.map((r) => ({
    sku: String(r.sku), c: catBySalesName(String(r.cat))?.key ?? String(r.cat).toLowerCase(), ch: String(r.ch), type: String(r.type),
    rs: +(r.rs as number) || 0, rq: +(r.rq as number) || 0, ps: +(r.ps as number) || 0, pq: +(r.pq as number) || 0,
    l7s: +(r.l7s as number) || 0, l7q: +(r.l7q as number) || 0, p7s: +(r.p7s as number) || 0, p7q: +(r.p7q as number) || 0,
    l30s: +(r.l30s as number) || 0, l30q: +(r.l30q as number) || 0, mtds: +(r.mtds as number) || 0, mtdq: +(r.mtdq as number) || 0,
    disc: +(r.disc as number) || 0, last: (r.last as string) ?? null, price: r.price == null ? null : +(r.price as number),
  }));
}

/** Daily SKU trend for one SKU (optionally one store). */
export async function getSkuDaily(sku: string, range: Range, ch: Filters["ch"], store?: string) {
  const types = TYPES[ch];
  return sfCached<{ date: string; sales: number; qty: number; stores: number }>(
    "skudaily",
    `select to_varchar(date) date, sum(gross_sales) sales, sum(gross_quantity) qty, count(distinct channel) stores
     from SNITCH_DB.MAPLEMONK.HORIZONTAL_SALES_CATEGORIES
     where sku_group = ? and date between ? and ? and type in (${types.map(() => "?").join(",")}) ${store ? "and trim(channel) = ?" : ""}
     group by 1 order by 1`,
    [sku, range.from, range.to, ...types, ...(store ? [store] : [])],
  );
}

/** Daily SKU sales for a set of SKUs (optionally restricted to store names), for trend views. */
export async function getSkuDailyMulti(skus: string[], range: Range, ch: Filters["ch"], storeNames?: string[] | null) {
  const types = TYPES[ch];
  const rows = await sfCached<{ date: string; sku: string; sales: number; qty: number; stores: number }>(
    "skudailymulti",
    `select to_varchar(date) date, sku_group sku, sum(gross_sales) sales, sum(gross_quantity) qty, count(distinct channel) stores
     from SNITCH_DB.MAPLEMONK.HORIZONTAL_SALES_CATEGORIES
     where sku_group in (select value::string from table(flatten(parse_json(?))))
       and date between ? and ? and type in (${types.map(() => "?").join(",")})
       ${storeNames?.length ? "and upper(trim(channel)) in (select upper(value::string) from table(flatten(parse_json(?))))" : ""}
     group by 1, 2 order by 1`,
    [JSON.stringify([...skus].sort()), range.from, range.to, ...types, ...(storeNames?.length ? [JSON.stringify([...storeNames].sort())] : [])],
  );
  return rows.map((r) => ({ ...r, sales: +r.sales || 0, qty: +r.qty || 0, stores: +r.stores || 0 }));
}
