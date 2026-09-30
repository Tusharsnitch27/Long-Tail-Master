import "server-only";
import { CATEGORIES } from "@/lib/categories";
import { cached } from "@/lib/cache";
import { sfQuery, sfCached } from "../snowflake";

/**
 * Warehouse stock. Current = UNICOMMERCE_LIVE_INVENTORY — a CURRENT-STATE table (one row per warehouse × size-level SKU;
 * UPDATED = that row's last change). Daily history = SNITCH_FINAL_INVENTORY_WH2 (one row per warehouse × SKU × DATE).
 * Only the three long-tail warehouses count. Units = INVENTORY (good stock; blocked / bad / not-synced excluded).
 */
export const FACILITIES = ["SAPL-WH1", "SAPL-WH2", "SAPL-NORTH-TAURU"] as const;
export const ZONE: Record<string, "South" | "North"> = { "SAPL-WH1": "South", "SAPL-WH2": "South", "SAPL-NORTH-TAURU": "North" };
const facList = FACILITIES.map((f) => `'${f}'`).join(",");

export interface WarehouseStock { sku: string; units: number; byFacility: Record<string, number>; byZone: { North: number; South: number }; bySize: Record<string, number>; updated: string | null }

const ucNames = () => CATEGORIES.flatMap((c) => c.ucCategories);

/** Size-level code → product (SKU group): SH0173-01-42 → SH0173-01 when the shorter code is a known product. */
export function productCode(code: string, known: Set<string>) {
  if (known.has(code)) return code;
  const parts = code.split("-");
  for (let i = parts.length - 1; i > 0; i--) { const p = parts.slice(0, i).join("-"); if (known.has(p)) return p; }
  return parts.length >= 3 ? parts.slice(0, -1).join("-") : code;
}

export function getWarehouseStock(known: Set<string>): Promise<{ bySku: Map<string, WarehouseStock>; updated: string | null }> {
  return cached(`wh:v2:${known.size}`, 600, async () => {
    const rows = await sfQuery<{ code: string; fac: string; size: string | null; units: number; upd: string | null }>(
      `select "Item SkuCode" code, "FACILITY" fac, "SIZE" size, sum("INVENTORY") units, max("UPDATED") upd
       from SNITCH_DB.MAPLEMONK.UNICOMMERCE_LIVE_INVENTORY
       where "Category Name" in (${ucNames().map((n) => `'${n}'`).join(",")}) and "FACILITY" in (${facList})
       group by 1, 2, 3`,
    );
    const bySku = new Map<string, WarehouseStock>();
    let latest: string | null = null;
    for (const r of rows) {
      const sku = productCode(String(r.code), known);
      const e = bySku.get(sku) ?? { sku, units: 0, byFacility: {}, byZone: { North: 0, South: 0 }, bySize: {}, updated: null };
      const u = +r.units || 0;
      e.units += u;
      e.byFacility[r.fac] = (e.byFacility[r.fac] ?? 0) + u;
      e.byZone[ZONE[r.fac] ?? "South"] += u;
      const size = r.size || (String(r.code) !== sku ? String(r.code).slice(sku.length + 1) : "One size");
      e.bySize[size] = (e.bySize[size] ?? 0) + u;
      if (r.upd && (!e.updated || r.upd > e.updated)) e.updated = r.upd;
      if (r.upd && (!latest || r.upd > latest)) latest = r.upd;
      bySku.set(sku, e);
    }
    return { bySku, updated: latest };
  });
}

/** Daily warehouse units by category × facility (history table; one snapshot per day, never summed across days). */
export async function getWarehouseHistory(from: string, to: string) {
  const rows = await sfCached<{ d: string; cat: string; fac: string; units: number }>(
    "wh:hist",
    `select to_varchar(date) d, "Category Name" cat, "FACILITY" fac, sum(try_to_number(to_varchar("INVENTORY"))) units
     from SNITCH_DB.MAPLEMONK.SNITCH_FINAL_INVENTORY_WH2
     where date between ? and ? and "FACILITY" in (${facList}) and "Category Name" in (${ucNames().map((n) => `'${n}'`).join(",")})
     group by 1, 2, 3 order by 1`,
    [from, to],
    3600,
  );
  return rows.map((r) => ({ d: r.d, cat: CATEGORIES.find((c) => c.ucCategories.includes(r.cat))?.key ?? r.cat, fac: r.fac, zone: ZONE[r.fac], units: +r.units || 0 }));
}

/** Daily warehouse units for one product (all sizes, by zone). */
export async function getProductWarehouseHistory(sku: string, from: string, to: string) {
  const rows = await sfCached<{ d: string; fac: string; units: number }>(
    "wh:hist:sku",
    `select to_varchar(date) d, "FACILITY" fac, sum(try_to_number(to_varchar("INVENTORY"))) units
     from SNITCH_DB.MAPLEMONK.SNITCH_FINAL_INVENTORY_WH2
     where date between ? and ? and "FACILITY" in (${facList}) and ("Item SkuCode" = ? or startswith("Item SkuCode", ?))
     group by 1, 2 order by 1`,
    [from, to, sku, sku + "-"],
    3600,
  );
  return rows.map((r) => ({ d: r.d, fac: r.fac, zone: ZONE[r.fac], units: +r.units || 0 }));
}
