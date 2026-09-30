import "server-only";
import { CATEGORIES } from "@/lib/categories";
import { sfCached } from "../snowflake";
import { productCode } from "./warehouse";

/**
 * Store inventory = OFFLINE_MASTER_DAILY_REPORT_1: one row per store × SKU group × DATE (daily snapshot, ~140 stores).
 * The LATEST DATE is live store inventory; earlier dates are backdated snapshots. Inventory is a snapshot metric —
 * never sum across dates. SKU_GROUP is lower-case in this table, so it is upper-cased and mapped to Product Master codes.
 */
const T = "SNITCH_DB.MAPLEMONK.OFFLINE_MASTER_DAILY_REPORT_1";
/** NEW_CATEGORY values that belong to the tool. */
export const STORE_INV_CATS = ["Perfumes", "Shoes", "Footwear", "Accessories", "Bags", "Belts", "Sunglasses", "Luggage", "Caps"];
const inList = STORE_INV_CATS.map((c) => `'${c}'`).join(",");

export interface StoreInv { b: string; store: string; sku: string; size: string; units: number; saved_date: string; s7: number; s30: number; cat: string }

const branch = (v: unknown) => String(Math.round(Number(v)));

/** Latest date in the store report (= live). */
export async function storeInventoryDate(): Promise<string | null> {
  const r = await sfCached<{ d: string | null }>("inv:store:date", `select to_varchar(max(date)) d from ${T} where date >= dateadd(day, -7, current_date)`, [], 600);
  return r[0]?.d ?? null;
}

/** Live store stock for long-tail products (latest DATE), store × product. */
export async function getStoreInventory(skuGroups: string[]): Promise<StoreInv[]> {
  const known = new Set(skuGroups);
  const d = await storeInventoryDate();
  if (!d) return [];
  const rows = await sfCached<{ b: number; store: string; sku: string; units: number; s7: number; s30: number; cat: string }>(
    "inv:store:v3",
    `select branch_code b, max(marketplace_mapped) store, upper(sku_group) sku, sum(inventory) units, sum(sales_last_7_days) s7, sum(sales_last_30_days) s30, max(new_category) cat
     from ${T} where date = ? and new_category in (${inList}) group by 1, 3`,
    [d],
    900,
  );
  return rows.map((r) => ({
    b: branch(r.b), store: String(r.store ?? "").replace(/^SNITCH\s*-\s*/i, ""), sku: known.size ? productCode(String(r.sku), known) : String(r.sku),
    size: "All", units: +r.units || 0, saved_date: d, s7: +r.s7 || 0, s30: +r.s30 || 0, cat: String(r.cat),
  }));
}

/** Stores present in the store report on the latest date (coverage disclosure). */
export async function getStoreInventoryCoverage() {
  const d = await storeInventoryDate();
  if (!d) return [];
  const rows = await sfCached<{ b: number; store: string }>("inv:coverage:v3", `select branch_code b, max(marketplace_mapped) store from ${T} where date = ? group by 1`, [d], 900);
  return rows.map((r) => ({ b: branch(r.b), store: r.store, saved_date: d }));
}

/**
 * Store × source category totals on the latest date for ALL categories (apparel included) — used only as a store-size
 * denominator (e.g. "shoes are 2% of this store's units") and to find strong stores where a long-tail category is not live.
 */
export async function getStoreCategoryMix() {
  const d = await storeInventoryDate();
  if (!d) return { date: null, rows: [] as { b: string; cat: string; inv: number; s30: number }[] };
  const rows = await sfCached<{ b: number; cat: string; inv: number; s30: number }>(
    "inv:storemix",
    `select branch_code b, coalesce(new_category, 'Other') cat, sum(inventory) inv, sum(sales_last_30_days) s30 from ${T} where date = ? group by 1, 2`,
    [d],
    3600,
  );
  return { date: d, rows: rows.map((r) => ({ b: branch(r.b), cat: String(r.cat), inv: +r.inv || 0, s30: +r.s30 || 0 })) };
}

/** Backdated store inventory: daily total units by source category (never summed across days). */
export async function getStoreInventoryHistory(from: string, to: string) {
  const rows = await sfCached<{ d: string; cat: string; units: number; stores: number }>(
    "inv:store:hist",
    `select to_varchar(date) d, new_category cat, sum(inventory) units, count(distinct iff(inventory > 0, branch_code, null)) stores
     from ${T} where date between ? and ? and new_category in (${inList}) group by 1, 2 order by 1`,
    [from, to],
    3600,
  );
  return rows.map((r) => ({ d: r.d, cat: catKey(r.cat), units: +r.units || 0, stores: +r.stores || 0 }));
}

/** Backdated store inventory for one product (daily, all stores). */
export async function getProductStoreHistory(sku: string, from: string, to: string) {
  const rows = await sfCached<{ d: string; units: number; stores: number }>(
    "inv:store:sku",
    `select to_varchar(date) d, sum(inventory) units, count(distinct iff(inventory > 0, branch_code, null)) stores
     from ${T} where date between ? and ? and upper(sku_group) = ? group by 1 order by 1`,
    [from, to, sku.toUpperCase()],
    3600,
  );
  return rows.map((r) => ({ d: r.d, units: +r.units || 0, stores: +r.stores || 0 }));
}

export const catKey = (newCategory: string) =>
  CATEGORIES.find((c) => c.salesCategory.toLowerCase() === newCategory?.toLowerCase() || c.ucCategories.some((u) => u.toLowerCase() === newCategory?.toLowerCase()) || c.masterCategory.some((m) => m.toLowerCase() === newCategory?.toLowerCase()))?.key ?? null;
