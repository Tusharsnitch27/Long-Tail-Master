import "server-only";
import { catForProduct, catBySalesName } from "@/lib/categories";
import { cached } from "@/lib/cache";
import { sfCached } from "../snowflake";
import { getMetafields, type Meta } from "./metafields";
import { getStoreInventory } from "./inventory";
import { productCode } from "./warehouse";

/**
 * Product Master = LONG_TAIL_MASTER_BIBLE (all long-tail categories, refreshed daily): identity, image, inwards,
 * lifetime sales by channel, Return % and store inventory. LONG_TAIL_PRODUCT_INVENTORY_MASTER only fills names /
 * colour / images the Bible lacks (its inventory columns are stale and never used).
 * Product grain = SKU group (style + colour), e.g. SH0173-01.
 */
export interface ChannelSplit { all: number | null; stores: number | null; online: number | null; marketplace: number | null }
export interface Product {
  sku: string;
  style: string;
  name: string | null;
  category: string | null; // registry key
  colour: string | null;
  material: string | null;
  vendor: string | null;
  image: string | null;
  mrp: number | null;
  sellingPrice: number | null;
  cogs: number | null;
  status: string | null;
  lifecycle: string | null;
  allocation: string | null;
  liveDate: string | null;
  daysSinceLive: number | null;
  ageing: number | null;
  inBible: boolean;
  // inventory (Bible, daily) — store = all stores combined
  invTotal: number | null;
  invWarehouse: number | null;
  invOffline: number | null;
  storesStocked: number | null;
  // lifetime (to date)
  inwardTotal: number | null;
  lastInward: string | null;
  sales: ChannelSplit; // ₹
  qty: ChannelSplit;
  returnsValue: ChannelSplit; // ₹ returned
  returnPct: ChannelSplit; // returned ₹ ÷ sold ₹
  l30Sales: number | null;
  l30Qty: number | null;
  // legacy aliases used across views
  qtySoldTd: number | null;
  salesTd: number | null;
  returnPctTd: number | null;
  gpPctTd: number | null;
  tags: string[];
  // metafields
  l1: string | null; // product type (e.g. Sneaker, Backpack, Square)
  l2: string | null; // sub-type (e.g. Low top, Chelsea)
  attrs: Record<string, string>;
  collection: string | null;
  /** name + type + attributes + colour + code, lower-case — search matches metafields, not just the name */
  search: string;
  /** store inventory source: live store report (latest date) or Product Master fallback */
  storeInvSource: "live" | "bible" | null;
}

const S = "SNITCH_DB.MAPLEMONK";

export function getProducts(): Promise<Product[]> {
  return cached("products:merged:v3", 600, buildProducts);
}

async function buildProducts(): Promise<Product[]> {
  const rows = await sfCached<Record<string, unknown>>(
    "products:v2",
    `with b as (select * from ${S}.LONG_TAIL_MASTER_BIBLE),
     m as (select * from ${S}.LONG_TAIL_PRODUCT_INVENTORY_MASTER),
     h as (select sku_group, any_value(category) category, max(price) price, max(image_url) image_url, max_by(product_tags, date) tags
           from ${S}.HORIZONTAL_SALES_CATEGORIES
           where date >= dateadd(day, -180, current_date) and category in ('Perfumes','Shoes','Sunglasses','Belts','Bags','Accessories','Luggage')
           group by 1)
     select coalesce(b.sku_group, m.sku_group, h.sku_group) sku,
            coalesce(nullif(b.product_name, ''), m.title) name, coalesce(b.category, m.category, h.category) category,
            m.color colour, coalesce(nullif(b.material, 'NO_MATERIAL'), m.material_mapped) material, m.vendor,
            coalesce(b.image_link, m.image_url, h.image_url) image, coalesce(b.mrp, m.original_price, h.price) mrp, m.current_slashed_price selling_price,
            coalesce(b.cogs, m.cost_price) cogs, m.status, b.lifecycle_status lifecycle, b.allocation_status allocation,
            to_varchar(coalesce(b.live_date, m.final_live_date)) live_date, coalesce(b.days_since_live, m.days_since_live) days_since_live, b.ageing,
            b.sku_group is not null in_bible, b.total_inv_all inv_total, b.wh_inv_all inv_wh, b.offline_inv_all inv_offline, b.store_count_all stores_stocked,
            b.total_inward_qty inward_total, to_varchar(b.last_inward_date) last_inward,
            b.sales_td_all s_all, b.sales_td_offline s_st, b.sales_td_shopify s_on, b.sales_td_marketplace s_mp,
            b.qty_sold_td_all q_all, b.qty_sold_td_offline q_st, b.qty_sold_td_shopify q_on, b.qty_sold_td_marketplace q_mp,
            b.returns_td_all r_all, b.returns_td_offline r_st, b.returns_td_shopify r_on, b.returns_td_marketplace r_mp,
            b.sales_l30_all l30_s, b.qty_sold_l30_all l30_q, b.gp_pct_td_all gp,
            to_varchar(h.tags) tags
     from b full outer join m on m.sku_group = b.sku_group
     full outer join h on h.sku_group = coalesce(b.sku_group, m.sku_group)`,
    [],
    1800,
  );
  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const pct = (r: number | null, s: number | null) => (r != null && s && s > 0 ? r / s : null);
  const [meta, inv] = await Promise.all([getMetafields().catch(() => new Map<string, Meta>()), getStoreInventory([]).catch(() => [])]);
  const base = rows.map((r) => {
    const sku = String(r.sku).toUpperCase();
    const cat = catForProduct(r.category as string | null, sku) ?? catBySalesName(String(r.category ?? ""));
    let tags: string[] = [];
    try { tags = r.tags ? (JSON.parse(String(r.tags)) as string[]) : []; } catch {}
    const sales = { all: n(r.s_all), stores: n(r.s_st), online: n(r.s_on), marketplace: n(r.s_mp) };
    const ret = { all: n(r.r_all), stores: n(r.r_st), online: n(r.r_on), marketplace: n(r.r_mp) };
    const qty = { all: n(r.q_all), stores: n(r.q_st), online: n(r.q_on), marketplace: n(r.q_mp) };
    const name = (r.name as string) ?? null;
    return {
      sku, style: sku.split("-")[0], name: name ? name.replace(/\b\w+/g, (w) => (w.length > 2 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)) : null,
      category: cat?.key ?? null, colour: (r.colour as string) ?? null, material: (r.material as string) ?? null, vendor: (r.vendor as string) ?? null,
      image: (r.image as string) ?? null, mrp: n(r.mrp), sellingPrice: n(r.selling_price), cogs: n(r.cogs),
      status: (r.status as string) ?? null, lifecycle: (r.lifecycle as string) ?? null, allocation: (r.allocation as string) ?? null,
      liveDate: (r.live_date as string) ?? null, daysSinceLive: n(r.days_since_live), ageing: n(r.ageing),
      inBible: Boolean(r.in_bible), invTotal: n(r.inv_total), invWarehouse: n(r.inv_wh), invOffline: n(r.inv_offline), storesStocked: n(r.stores_stocked),
      inwardTotal: n(r.inward_total), lastInward: (r.last_inward as string) ?? null,
      sales, qty, returnsValue: ret,
      returnPct: { all: pct(ret.all, sales.all), stores: pct(ret.stores, sales.stores), online: pct(ret.online, sales.online), marketplace: pct(ret.marketplace, sales.marketplace) },
      l30Sales: n(r.l30_s), l30Qty: n(r.l30_q),
      qtySoldTd: qty.all, salesTd: sales.all, returnPctTd: pct(ret.all, sales.all), gpPctTd: n(r.gp), tags,
      l1: null, l2: null, attrs: {}, collection: null, search: "", storeInvSource: null,
    } as Product;
  });
  const bySku = new Map(base.map((p) => [p.sku, p]));
  // products that exist only in the metafield sheet (e.g. new bags / sunglasses) still belong to the master
  for (const m of meta.values()) {
    if (bySku.has(m.sku) || !m.category) continue;
    const empty = { all: null, stores: null, online: null, marketplace: null };
    const p = { sku: m.sku, style: m.sku.split("-")[0], name: m.name ? m.name.replace(/\b\w+/g, (w) => (w.length > 2 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)) : null, category: m.category, colour: null, material: null, vendor: null, image: m.image, mrp: null, sellingPrice: null, cogs: null,
      status: null, lifecycle: null, allocation: null, liveDate: null, daysSinceLive: null, ageing: null, inBible: false, invTotal: null, invWarehouse: null, invOffline: null, storesStocked: null,
      inwardTotal: null, lastInward: null, sales: { ...empty }, qty: { ...empty }, returnsValue: { ...empty }, returnPct: { ...empty }, l30Sales: null, l30Qty: null,
      qtySoldTd: null, salesTd: null, returnPctTd: null, gpPctTd: null, tags: [], l1: null, l2: null, attrs: {}, collection: null, search: "", storeInvSource: null } as Product;
    base.push(p); bySku.set(p.sku, p);
  }
  // live store inventory (latest date of the store report) replaces the Product Master's store figure
  const known = new Set(bySku.keys());
  const live = new Map<string, { units: number; stores: number }>();
  for (const r of inv) {
    const k = productCode(r.sku, known);
    const e = live.get(k) ?? { units: 0, stores: 0 };
    e.units += r.units; if (r.units > 0) e.stores++;
    live.set(k, e);
  }
  for (const p of base) {
    const m = meta.get(p.sku);
    if (m) {
      p.l1 = m.l1; p.l2 = m.l2; p.attrs = { ...m.attrs }; p.collection = m.collection;
      if (m.imageOverride) p.image = m.image; else p.image ??= m.image;
      p.category ??= m.category;
    }
    if (p.colour && !p.attrs.colour) p.attrs.colour = p.colour;
    const l = live.get(p.sku);
    if (inv.length) { p.invOffline = l?.units ?? 0; p.storesStocked = l?.stores ?? 0; p.storeInvSource = "live"; }
    else if (p.invOffline != null) p.storeInvSource = "bible";
    p.search = [p.name, p.sku, p.l1, p.l2, p.collection, ...Object.values(p.attrs)].filter(Boolean).join(" ").toLowerCase();
  }
  return base;
}

/** Product type for filters: metafield L1, else Shopify tags. */
export function productL1(p: Product) { return p.l1 ?? productType(p); }

/** Product type from Shopify tags (Sneakers / Loafers / Boots …). */
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
