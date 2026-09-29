import "server-only";

/**
 * Business semantic layer for the AI Copilot. The model reasons over these concepts; it never sees credentials
 * or writes SQL. Registering a new approved dataset = add it here + expose it through a tool in tools.ts.
 */

export type MetricType = "additive" | "snapshot" | "calculated" | "distinct" | "plan";

export interface Dataset {
  id: string;
  table: string;
  grain: string;
  time: string;
  coverage: string;
  caveats?: string;
  enabled: boolean;
}

export const DATASETS: Dataset[] = [
  { id: "store_daily", table: "LONG_TAIL_DSR_PERFUMES / LONG_TAIL_DSR_SHOES", grain: "store × category × day (rows only on days with a sale)", time: "DATE (IST); today partial", coverage: "~137 stores", caveats: "Stores-channel revenue (net of discount), units, bills. Official source for store performance and targets.", enabled: true },
  { id: "store_targets", table: "MTD_TARGET_PERFUMES / MTD_TARGET_SHOES (+ overrides)", grain: "store × category × day incl. future days", time: "DATE; phased", coverage: "Stores channel only", caveats: "Online and Marketplace have no targets.", enabled: true },
  { id: "channel_sales", table: "UNICOMMERCE_FACT_ITEMS_INTERMEDIATE", grain: "order item (quantity 1)", time: "ORDER_DATE", coverage: "Online = SHOPIFY; Marketplace = AJIO / MYNTRA / FLIPKART / AMAZON (Amazon has no long-tail orders since Jul 2026)", caveats: "Revenue = Σ SELLING_PRICE of non-cancelled items. Shoes include 'Footwear'.", enabled: true },
  { id: "store_sku_sales", table: "HORIZONTAL_SALES_CATEGORIES (TYPE = Store)", grain: "order line", time: "DATE", coverage: "Stores", caveats: "The only store × product source; gross line value (~1–3% above DSR net). Not used for channel totals.", enabled: true },
  { id: "product_master", table: "LONG_TAIL_MASTER_BIBLE", grain: "product (SKU group)", time: "refreshed daily", coverage: "All long-tail categories", caveats: "Identity, MRP, inwards, LIFETIME sales by channel, Return % (lifetime, value-based), store inventory (all stores).", enabled: true },
  { id: "warehouse_inventory", table: "UNICOMMERCE_LIVE_INVENTORY", grain: "warehouse × size-level SKU, current state", time: "UPDATED per row (IST)", coverage: "3 warehouses", caveats: "Current state — summed across warehouses/sizes, never over time. Good stock only.", enabled: true },
  { id: "store_inventory_feed", table: "SPEED_INVENTORY", grain: "store × SKU size × bin, daily snapshot", time: "SAVED_DATE per store", coverage: "Only ~20 of ~137 stores", caveats: "Latest SAVED_DATE per store. Always disclose coverage for per-store stock.", enabled: true },
];

export const ENTITIES = [
  "Store (branch code, name, city, state, region, store type COCO/COFO/FOCO, status FRESH/OUTLET, area manager)",
  "Category (Perfumes, Shoes — others registered but may be disabled)",
  "Product family (a style: same name across colour variants) → SKU groups (e.g. SH0173-01 black, SH0173-02 brown) → sizes",
  "Channel: Overall = Stores + Online + Marketplace; Online = Shopify; Marketplace = AJIO / MYNTRA / FLIPKART / AMAZON",
  "Date / Week (Mon–Sun) / Month",
  "Target (plan per store × category × day)",
  "Inventory snapshot (network or store level)",
];

export const RELATIONSHIPS = [
  "SKU group → product master (name, category, MRP, colour, status)",
  "SKU group + store + date → SKU sales (sku_sales)",
  "Store + category + date → revenue/units/bills (store_daily) and target (store_targets)",
  "Store → city → state → region; store → area manager",
  "Store name in sku_sales CHANNEL = store name in store_daily",
];

export const METRICS: { name: string; type: MetricType; rule: string }[] = [
  { name: "Revenue", type: "additive", rule: "Stores: DSR net sales. Online / Marketplace: Σ selling price of non-cancelled Unicommerce items. Overall = sum of the three." },
  { name: "Units", type: "additive", rule: "Stores: DSR qty. Online / Marketplace: non-cancelled items." },
  { name: "Orders / Bills", type: "additive", rule: "Online / Marketplace: distinct orders. Stores: bills." },
  { name: "Target / Achievement %", type: "plan", rule: "Stores channel only: phased store targets; achievement = stores revenue ÷ target." },
  { name: "Gap / Required run rate / Projected", type: "calculated", rule: "Target − revenue; remaining month target ÷ remaining days; MTD achievement × month target." },
  { name: "ASP", type: "calculated", rule: "Revenue ÷ units." },
  { name: "Growth", type: "calculated", rule: "vs the comparable period (MTD vs prev month same days; WTD vs same weekdays last week)." },
  { name: "Stores selling / Sales per store", type: "distinct", rule: "Distinct stores with ≥1 sale; revenue ÷ active stores (÷ days)." },
  { name: "Return %", type: "snapshot", rule: "LIFETIME, value-based: returned ₹ ÷ sold ₹ (Product Master), per channel or overall. No period return % exists." },
  { name: "Store inventory", type: "snapshot", rule: "Per product: all stores combined (Product Master, daily). Per store: store-inventory feed (~20 stores), latest SAVED_DATE per store." },
  { name: "Warehouse inventory", type: "snapshot", rule: "Unicommerce live stock (current state), summed across warehouses and sizes." },
  { name: "Days of inventory", type: "calculated", rule: "(store + warehouse units) ÷ (L30 units ÷ 30)." },
  { name: "Lifetime sales / Inwards", type: "snapshot", rule: "Product Master to-date values; do not mix with period revenue." },
];

export function semanticPrompt() {
  const ds = DATASETS.filter((d) => d.enabled)
    .map((d) => `- ${d.id}: ${d.table}\n  grain: ${d.grain}\n  time: ${d.time}\n  coverage: ${d.coverage}${d.caveats ? `\n  caveats: ${d.caveats}` : ""}`)
    .join("\n");
  return `## Datasets (governed; reachable only through tools)
${ds}

## Entities
${ENTITIES.map((e) => `- ${e}`).join("\n")}

## Relationships
${RELATIONSHIPS.map((e) => `- ${e}`).join("\n")}

## Metrics and time behaviour
${METRICS.map((m) => `- ${m.name} [${m.type}]: ${m.rule}`).join("\n")}`;
}
