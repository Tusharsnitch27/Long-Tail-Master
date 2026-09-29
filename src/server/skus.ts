import "server-only";
import { PRICE_BANDS } from "@/lib/filters";
import { addDays } from "@/lib/dates";
import type { Ctx } from "./context";
import { storeMatcher } from "./analytics";
import { getSkuFacts, type SkuStoreFact } from "./data/sku";
import { getProductMap, productType } from "./data/products";
import { skuRollup } from "./views";

/** SKU × store facts for the page's period, filtered by category, channel, store filters and price band. */
export async function loadSkus(ctx: Ctx) {
  const [facts, products] = await Promise.all([
    getSkuFacts({ range: ctx.period.range, compare: ctx.period.compare, asOf: ctx.asOf, cats: ctx.filters.cats, ch: ctx.filters.ch }),
    getProductMap(),
  ]);
  const m = storeMatcher(ctx.filters, ctx.byCode);
  const bands = PRICE_BANDS.filter((b) => ctx.filters.pb.includes(b.key));
  const rows: (SkuStoreFact & { b: string | null; store: string })[] = [];
  for (const f of facts) {
    const st = f.type === "Store" ? ctx.byName.get(f.ch.toUpperCase()) : undefined;
    if (m && (f.type !== "Store" || !st || !m(st.branch_code))) continue;
    if (bands.length) {
      const price = products.get(f.sku)?.mrp ?? f.price;
      if (price == null || !bands.some((b) => price >= b.min && price <= b.max)) continue;
    }
    rows.push({ ...f, b: st?.branch_code ?? null, store: st?.short_name ?? f.ch.replace(/^SNITCH\s*-\s*/i, "") });
  }
  // penetration denominator: in-scope stores active in the last 45 days
  const network = ctx.filters.ch === "store" ? ctx.stores.filter((s) => !m || m(s.branch_code)).filter((s) => s.last_seen != null && s.last_seen >= addDays(ctx.asOf, -45)).length : new Set(rows.map((r) => r.ch)).size;
  const skus = skuRollup(rows, products, network, productType);
  return { rows, skus, products, network };
}
