import "server-only";
import { cached, invalidate } from "@/lib/cache";
import { catForProduct } from "@/lib/categories";
import seed from "@/data/shoe-metafields.json";
import { sfCached } from "../snowflake";
import { dbConfigured, q } from "../db";

/**
 * Product metafields.
 *  - L1 / L2 (product type / sub-type), name, image, collection: SNITCH_DB.MAPLEMONK.GS_LONGTAIL_METAFIELD
 *  - Shoe attributes (colour, occasion, aesthetic, closure, material, sole, toe, construction, season …): the
 *    "Longtail Metafields" workbook (src/data/shoe-metafields.json; L1 / L2 deliberately not taken from it)
 *  - Admin edits / uploads in the tool (Postgres product_meta) win over both.
 */
export interface Meta { sku: string; l1: string | null; l2: string | null; name: string | null; image: string | null; imageOverride?: boolean; category: string | null; collection: string | null; attrs: Record<string, string> }

export const ATTR_LABEL: Record<string, string> = {
  colour: "Colour", occasion: "Occasion", aesthetic: "Fashion aesthetic", bestWith: "Best with", closure: "Closure", upperMaterial: "Upper material",
  soleType: "Sole type", toeShape: "Toe shape", construction: "Construction", season: "Season", soleMaterial: "Sole material", material: "Material", shape: "Shape",
};

const clean = (v: unknown) => { const s = v == null ? "" : String(v).trim(); return !s || /^(none|null|n\/a|na|-)$/i.test(s) ? null : s; };
const title = (s: string | null) => (s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);

export function getMetafields(): Promise<Map<string, Meta>> {
  return cached("meta:v1", 900, async () => {
    const [rows, overrides] = await Promise.all([
      sfCached<Record<string, unknown>>("meta:gs", `select upper(sku_group) sku, meta1, meta2, name, imagelink, category, collection from SNITCH_DB.MAPLEMONK.GS_LONGTAIL_METAFIELD where sku_group is not null`, [], 1800).catch(() => []),
      dbConfigured() ? q<{ sku_group: string; attrs: Record<string, string> }>("select sku_group, attrs from product_meta").catch(() => []) : Promise.resolve([]),
    ]);
    const m = new Map<string, Meta>();
    const get = (sku: string) => { let e = m.get(sku); if (!e) m.set(sku, (e = { sku, l1: null, l2: null, name: null, image: null, category: null, collection: null, attrs: {} })); return e; };
    for (const r of rows) {
      const sku = String(r.sku).trim();
      const e = get(sku);
      const cat = catForProduct(clean(r.category), sku);
      e.category = cat?.key ?? null;
      e.l1 = title(clean(r.meta1)); e.l2 = title(clean(r.meta2)); e.name = clean(r.name); e.image = clean(r.imagelink); e.collection = clean(r.collection);
      // bags / belts store the colour in L2
      if (e.category === "bags" && e.l2) e.attrs.colour = e.l2;
      if (e.category === "belts" && e.l2) { e.attrs.colour = e.l2; e.attrs.material = e.l1 ?? ""; }
      if (e.category === "sunglasses" && e.l1) e.attrs.shape = e.l1;
    }
    for (const [sku, a] of Object.entries(seed as Record<string, Record<string, string>>)) Object.assign(get(sku).attrs, a);
    for (const o of overrides) {
      const e = get(o.sku_group.toUpperCase());
      const { l1, l2, image, ...attrs } = o.attrs ?? {};
      if (l1) e.l1 = l1; if (l2) e.l2 = l2; if (image) { e.image = image; e.imageOverride = true; }
      Object.assign(e.attrs, attrs);
    }
    return m;
  });
}

/** Admin: upsert attributes for products (merge). */
export async function saveProductMeta(rows: { sku: string; attrs: Record<string, string> }[], actor: string) {
  for (const r of rows) {
    await q(`insert into product_meta(sku_group, attrs, updated_by) values ($1, $2, $3)
             on conflict (sku_group) do update set attrs = product_meta.attrs || excluded.attrs, updated_by = excluded.updated_by, updated_at = now()`, [r.sku.toUpperCase(), JSON.stringify(r.attrs), actor]);
  }
  await q("insert into audit_log(actor, action, entity, detail) values ($1,'upload','product_meta',$2)", [actor, JSON.stringify({ rows: rows.length })]);
  invalidate("meta:");
  invalidate("products:");
}

/** New inwards (putaway) timeline — PUTAWAY_TRACKING where FINAL_TYPE = 'New Inward'. */
export async function getInwards(sku: string) {
  const rows = await sfCached<{ d: string; wh: string; qty: number; done: number; lines: number }>(
    "inwards:sku",
    `select to_varchar(putaway_completed_date) d, "Warehouse Name" wh, sum(total_quantity) qty, sum(putaway_completed_quantity) done, count(*) lines
     from SNITCH_DB.MAPLEMONK.PUTAWAY_TRACKING where final_type = 'New Inward' and upper(skugroup) = ? group by 1, 2 order by 1`,
    [sku.toUpperCase()],
    3600,
  );
  return rows.map((r) => ({ d: r.d, wh: r.wh, qty: +r.qty || 0, done: +r.done || 0, lines: +r.lines || 0 }));
}

/** Recent new inwards by product (all long-tail), for sell-through of new stock and demand planning. */
export async function getRecentInwards(days = 90) {
  const rows = await sfCached<{ sku: string; wh: string; qty: number; first: string; last: string }>(
    "inwards:recent",
    `select upper(skugroup) sku, "Warehouse Name" wh, sum(total_quantity) qty, to_varchar(min(putaway_completed_date)) first, to_varchar(max(putaway_completed_date)) last
     from SNITCH_DB.MAPLEMONK.PUTAWAY_TRACKING
     where final_type = 'New Inward' and putaway_completed_date >= dateadd(day, ?, current_date)
       and category in ('Perfumes','Shoes','Footwear','Accessories','Bags','Belts','Sunglasses','TROLLEY','Luggage','Caps')
     group by 1, 2`,
    [-days],
    3600,
  );
  return rows.map((r) => ({ ...r, qty: +r.qty || 0 }));
}
