import "server-only";
import { sfCached } from "../snowflake";

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

/** Latest store snapshot for long-tail SKUs only (SKU groups known to the product masters). */
export function getStoreInventory(skuGroups: string[]): Promise<StoreInv[]> {
  const list = Array.from(new Set(skuGroups)).sort();
  if (!list.length) return Promise.resolve([]);
  return sfCached<StoreInv>(
    `inv:store:${list.length}`,
    `with latest as (
       select branch_code, max(saved_date) d from ${S}.SPEED_INVENTORY where saved_date >= dateadd(day, -14, current_date) group by 1)
     select s.branch_code b, max(s.store) store, s.skugroup sku, s.sku size_sku, sum(s.total) units, to_varchar(l.d) saved_date
     from ${S}.SPEED_INVENTORY s join latest l on l.branch_code = s.branch_code and s.saved_date = l.d
     where s.skugroup in (select value::string from table(flatten(parse_json(?))))
     group by s.branch_code, s.skugroup, s.sku, l.d`,
    [JSON.stringify(list)],
    900,
  ).then((rows) =>
    rows.map((r) => {
      const raw = r as unknown as { size_sku: string };
      return { b: String(r.b), store: r.store, sku: r.sku, size: raw.size_sku.startsWith(r.sku + "-") ? raw.size_sku.slice(r.sku.length + 1) : raw.size_sku, units: +r.units || 0, saved_date: r.saved_date };
    }),
  );
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
