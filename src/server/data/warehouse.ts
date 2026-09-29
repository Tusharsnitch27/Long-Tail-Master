import "server-only";
import { CATEGORIES } from "@/lib/categories";
import { cached } from "@/lib/cache";
import { sfQuery } from "../snowflake";

/**
 * Warehouse stock from UNICOMMERCE_LIVE_INVENTORY — a CURRENT-STATE table (one row per warehouse × size-level SKU;
 * UPDATED = that row's last change). Summing across warehouses/sizes is correct; there are no historical snapshots.
 * Units = INVENTORY (good stock; blocked / bad / not-synced excluded).
 */
export interface WarehouseStock { sku: string; units: number; byFacility: Record<string, number>; bySize: Record<string, number>; updated: string | null }

const ucNames = () => CATEGORIES.flatMap((c) => c.ucCategories);

/** Size-level code → product (SKU group): SH0173-01-42 → SH0173-01 when the shorter code is a known product. */
export function productCode(code: string, known: Set<string>) {
  if (known.has(code)) return code;
  const parts = code.split("-");
  for (let i = parts.length - 1; i > 0; i--) { const p = parts.slice(0, i).join("-"); if (known.has(p)) return p; }
  return parts.length >= 3 ? parts.slice(0, -1).join("-") : code;
}

export function getWarehouseStock(known: Set<string>): Promise<{ bySku: Map<string, WarehouseStock>; updated: string | null }> {
  return cached(`wh:${known.size}`, 600, async () => {
    const rows = await sfQuery<{ code: string; fac: string; size: string | null; units: number; upd: string | null }>(
      `select "Item SkuCode" code, "FACILITY" fac, "SIZE" size, sum("INVENTORY") units, max("UPDATED") upd
       from SNITCH_DB.MAPLEMONK.UNICOMMERCE_LIVE_INVENTORY
       where "Category Name" in (${ucNames().map((n) => `'${n}'`).join(",")})
       group by 1, 2, 3`,
    );
    const bySku = new Map<string, WarehouseStock>();
    let latest: string | null = null;
    for (const r of rows) {
      const sku = productCode(String(r.code), known);
      const e = bySku.get(sku) ?? { sku, units: 0, byFacility: {}, bySize: {}, updated: null };
      const u = +r.units || 0;
      e.units += u;
      e.byFacility[r.fac] = (e.byFacility[r.fac] ?? 0) + u;
      const size = r.size || (String(r.code) !== sku ? String(r.code).slice(sku.length + 1) : "One size");
      e.bySize[size] = (e.bySize[size] ?? 0) + u;
      if (r.upd && (!e.updated || r.upd > e.updated)) e.updated = r.upd;
      if (r.upd && (!latest || r.upd > latest)) latest = r.upd;
      bySku.set(sku, e);
    }
    return { bySku, updated: latest };
  });
}
