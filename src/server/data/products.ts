import "server-only";
import { catByMaster, catBySalesName } from "@/lib/categories";
import { sfCached } from "../snowflake";

/**
 * Product master = LONG_TAIL_MASTER_BIBLE (fresh; perfumes only today) merged with
 * LONG_TAIL_PRODUCT_INVENTORY_MASTER (all long-tail categories; used ONLY for static attributes —
 * its inventory/ROS columns are stale, last REFRESHED_AT Jul 2026) and SKU facts seen in sales.
 */
export interface Product {
  sku: string;
  name: string | null;
  category: string | null; // registry key
  colour: string | null;
  material: string | null;
  vendor: string | null;
  image: string | null;
  mrp: number | null;
  sellingPrice: number | null;
  cogs: number | null;
  status: string | null; // ACTIVE / DRAFT (Shopify)
  lifecycle: string | null; // LIVE / HISTORICAL (Bible)
  allocation: string | null;
  liveDate: string | null;
  daysSinceLive: number | null;
  ageing: number | null;
  // Bible-only (fresh) inventory & lifetime metrics
  inBible: boolean;
  invTotal: number | null;
  invWarehouse: number | null;
  invOffline: number | null;
  storesStocked: number | null;
  qtySoldTd: number | null;
  salesTd: number | null;
  returnPctTd: number | null;
  gpPctTd: number | null;
  inwardTotal: number | null;
  lastInward: string | null;
  tags: string[];
}

const S = "SNITCH_DB.MAPLEMONK";

export async function getProducts(): Promise<Product[]> {
  const rows = await sfCached<Record<string, unknown>>(
    "products",
    `with b as (select * from ${S}.LONG_TAIL_MASTER_BIBLE),
     m as (select * from ${S}.LONG_TAIL_PRODUCT_INVENTORY_MASTER),
     h as (select sku_group, any_value(category) category, max(price) price, max(image_url) image_url,
                  max_by(product_tags, date) tags
           from ${S}.HORIZONTAL_SALES_CATEGORIES
           where date >= dateadd(day, -180, current_date) and type = 'Store'
             and category in ('Perfumes','Shoes','Sunglasses','Belts','Bags','Accessories','Luggage')
           group by 1)
     select coalesce(b.sku_group, m.sku_group, h.sku_group) sku,
            coalesce(b.product_name, m.title) name,
            coalesce(b.category, m.category, h.category) category,
            m.color colour, coalesce(nullif(b.material, 'NO_MATERIAL'), m.material_mapped) material, m.vendor,
            coalesce(b.image_link, m.image_url, h.image_url) image,
            coalesce(b.mrp, m.original_price, h.price) mrp, m.current_slashed_price selling_price, coalesce(b.cogs, m.cost_price) cogs,
            m.status, b.lifecycle_status lifecycle, b.allocation_status allocation,
            to_varchar(coalesce(b.live_date, m.final_live_date)) live_date, coalesce(b.days_since_live, m.days_since_live) days_since_live, b.ageing,
            b.sku_group is not null in_bible, b.total_inv_all inv_total, b.wh_inv_all inv_wh, b.offline_inv_all inv_offline, b.store_count_all stores_stocked,
            b.qty_sold_td_all qty_td, b.sales_td_all sales_td, b.return_pct_td_all return_pct_td, b.gp_pct_td_all gp_pct_td,
            b.total_inward_qty inward_total, to_varchar(b.last_inward_date) last_inward,
            to_varchar(h.tags) tags
     from b full outer join m on m.sku_group = b.sku_group
     full outer join h on h.sku_group = coalesce(b.sku_group, m.sku_group)`,
    [],
    1800,
  );
  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return rows.map((r) => {
    const cat = catByMaster(String(r.category ?? "")) ?? catBySalesName(String(r.category ?? ""));
    let tags: string[] = [];
    try { tags = r.tags ? (JSON.parse(String(r.tags)) as string[]) : []; } catch {}
    return {
      sku: String(r.sku), name: (r.name as string) ?? null, category: cat?.key ?? null,
      colour: (r.colour as string) ?? null, material: (r.material as string) ?? null, vendor: (r.vendor as string) ?? null,
      image: (r.image as string) ?? null, mrp: n(r.mrp), sellingPrice: n(r.selling_price), cogs: n(r.cogs),
      status: (r.status as string) ?? null, lifecycle: (r.lifecycle as string) ?? null, allocation: (r.allocation as string) ?? null,
      liveDate: (r.live_date as string) ?? null, daysSinceLive: n(r.days_since_live), ageing: n(r.ageing),
      inBible: Boolean(r.in_bible), invTotal: n(r.inv_total), invWarehouse: n(r.inv_wh), invOffline: n(r.inv_offline),
      storesStocked: n(r.stores_stocked), qtySoldTd: n(r.qty_td), salesTd: n(r.sales_td), returnPctTd: n(r.return_pct_td), gpPctTd: n(r.gp_pct_td),
      inwardTotal: n(r.inward_total), lastInward: (r.last_inward as string) ?? null, tags,
    };
  });
}

/** Product type derived from Shopify tags (e.g. Sneakers / Loafers / Boots) — used as SKU sub-category. */
const TYPE_TAGS = ["Sneakers", "Loafers", "Boots", "Mules", "Sandals", "Slides", "Derby", "Oxford", "Boat Shoes", "Moccasins", "Slip-on", "Eau De Parfum", "Reserve Collection", "Aviator", "Wayfarer"];
export function productType(p: Product): string | null {
  const t = TYPE_TAGS.find((x) => p.tags.some((tag) => tag.toLowerCase() === x.toLowerCase()));
  if (t) return t;
  if (p.name && /reserve collection/i.test(p.name)) return "Reserve Collection";
  return null;
}

export async function getProductMap() {
  const ps = await getProducts();
  return new Map(ps.map((p) => [p.sku, p]));
}
