import "server-only";
import { sfCached } from "../snowflake";

/**
 * Shopify product catalogue (NEW_MEAFIELDS_PRODUCT_PRODUCTS_GRAPH_QL) at SKU-group level — the primary source for a
 * product's name, image, MRP / selling price, live date and status. Other sources (Product Master, inventory master,
 * metafield sheet) only fill what Shopify leaves empty. Cost price is deliberately not read.
 */
export interface ShopifyProduct { sku: string; name: string | null; image: string | null; mrp: number | null; sellingPrice: number | null; liveDate: string | null; status: string | null; productType: string | null; url: string | null }

export async function getShopifyProducts(): Promise<Map<string, ShopifyProduct>> {
  const rows = await sfCached<Record<string, unknown>>(
    "shopify:products:v1",
    `with v as (
       select upper(left(f.value:sku::string, length(f.value:sku::string) - charindex('-', reverse(f.value:sku::string)))) sku_group,
              nullif(trim(p.title), '') title, p.media[0]:preview:image:url::string image_url,
              try_to_number(replace(f.value:price::string, '"', '')) sp, try_to_number(replace(f.value:compareAtPrice::string, '"', '')) cap,
              try_to_date(p.publishedat) pub, p.status, p.producttype, p.onlinestoreurl
       from SNITCH_DB.MAPLEMONK.NEW_MEAFIELDS_PRODUCT_PRODUCTS_GRAPH_QL p, table(flatten(input => parse_json(p.variants))) f
       where f.value:sku::string is not null and charindex('-', f.value:sku::string) > 0)
     select sku_group sku,
            max_by(title, coalesce(pub, '2021-01-01'::date)) name, max_by(image_url, coalesce(pub, '2021-01-01'::date)) image,
            max(greatest(coalesce(cap, 0), coalesce(sp, 0))) mrp, max_by(sp, coalesce(pub, '2021-01-01'::date)) selling_price,
            to_varchar(min(pub)) live_date, max_by(status, coalesce(pub, '2021-01-01'::date)) status,
            max_by(producttype, coalesce(pub, '2021-01-01'::date)) product_type, max_by(onlinestoreurl, coalesce(pub, '2021-01-01'::date)) url
     from v group by 1`,
    [],
    3600,
  );
  const n = (v: unknown) => (v == null || v === "" || Number(v) <= 0 ? null : Number(v));
  return new Map(rows.map((r) => [String(r.sku), {
    sku: String(r.sku), name: (r.name as string) ?? null, image: (r.image as string) ?? null, mrp: n(r.mrp), sellingPrice: n(r.selling_price),
    liveDate: (r.live_date as string) ?? null, status: (r.status as string) ?? null, productType: (r.product_type as string) ?? null, url: (r.url as string) ?? null,
  }]));
}
