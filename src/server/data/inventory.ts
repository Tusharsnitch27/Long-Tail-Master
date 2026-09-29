import "server-only";
import { sfCached } from "../snowflake";
import { productCode } from "./warehouse";

/**
 * Inventory is a SNAPSHOT metric: never sum across snapshots.
 *
 * Network level — INVENTORY_DAILY_SNAPSHOT_LATEST keeps one row per SKU × cut-size per day (≈121 days), despite
 * its name. Latest = max(SNAPSHOT_TS) per SKU × cut-size; SKUs can have different latest timestamps (a SKU that
 * stopped syncing keeps an old one), so the timestamp is returned per row.
 *
 * Store level — SPEED_INVENTORY: store × SKU-size × bin location, one set per SAVED_DATE. Latest = max(SAVED_DATE)
 * per BRANCH_CODE (within 14 days); then sum bins/sizes. Covers only the stores in that feed (~20), so every answer
 * must state coverage.
 */
const S = "SNITCH_DB.MAPLEMONK";

export interface NetworkInv { sku: string; category: string; offline: number; online: number; snapshot_ts: string }
export interface StoreInv { b: string; store: string; sku: string; size: string; units: number; saved_date: string }

export function getNetworkInventory(): Promise<NetworkInv[]> {
  return sfCached<NetworkInv>(
    "inv:network",
    `select sku_group sku, any_value(category) category, sum(offline_inventory) offline, sum(online_inventory) online,
            to_varchar(max(snapshot_ts), 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') snapshot_ts
     from (select * from ${S}.INVENTORY_DAILY_SNAPSHOT_LATEST
           where category in ('Perfumes','Shoes','Sunglasses','Belts','Bags','Accessories','Luggage','Caps')
           qualify snapshot_ts = max(snapshot_ts) over (partition by sku_group, cut_size))
     group by 1`,
    [],
    900,
  ).then((rows) => rows.map((r) => ({ ...r, offline: +r.offline || 0, online: +r.online || 0 })));
}

/**
 * Latest store snapshot for long-tail products. SKUGROUP is NULL for newer SKUs in this feed (e.g. 4MSFR0942-01-01),
 * so the product is derived from the size-level SKU code against the known product list — never filtered on SKUGROUP.
 */
export async function getStoreInventory(skuGroups: string[]): Promise<StoreInv[]> {
  const known = new Set(skuGroups);
  if (!known.size) return [];
  const prefixes = Array.from(new Set([...known].map((k) => k.slice(0, 4)))).sort();
  const rows = await sfCached<{ b: string; store: string; sku: string; grp: string | null; units: number; saved_date: string }>(
    `inv:store:v2:${prefixes.join(",")}`,
    `with latest as (
       select branch_code, max(saved_date) d from ${S}.SPEED_INVENTORY where saved_date >= dateadd(day, -14, current_date) group by 1)
     select s.branch_code b, max(s.store) store, s.sku sku, max(s.skugroup) grp, sum(s.total) units, to_varchar(l.d) saved_date
     from ${S}.SPEED_INVENTORY s join latest l on l.branch_code = s.branch_code and s.saved_date = l.d
     where left(s.sku, 4) in (select value::string from table(flatten(parse_json(?))))
     group by s.branch_code, s.sku, l.d`,
    [JSON.stringify(prefixes)],
    900,
  );
  const out: StoreInv[] = [];
  for (const r of rows) {
    const code = String(r.sku);
    const product = r.grp && known.has(r.grp) ? r.grp : productCode(code, known);
    if (!known.has(product)) continue;
    out.push({ b: String(r.b), store: r.store, sku: product, size: code.startsWith(product + "-") ? code.slice(product.length + 1) : "One size", units: +r.units || 0, saved_date: r.saved_date });
  }
  return out;
}

/** Stores present in the store-level inventory feed (coverage disclosure). */
export function getStoreInventoryCoverage() {
  return sfCached<{ b: string; store: string; saved_date: string }>(
    "inv:coverage",
    `select branch_code b, max(store) store, to_varchar(max(saved_date)) saved_date from ${S}.SPEED_INVENTORY
     where saved_date >= dateadd(day, -14, current_date) group by 1`,
    [],
    900,
  );
}
