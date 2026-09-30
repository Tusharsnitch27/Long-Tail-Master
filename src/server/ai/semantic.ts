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
  { id: "store_daily", table: "LONG_TAIL_DSR_PERFUMES / LONG_TAIL_DSR_SHOES (+ HORIZONTAL_SALES_CATEGORIES for Accessories, Bags, Belts, Sunglasses, Trolleys)", grain: "store × category × day (rows only on days with a sale)", time: "DATE (IST); today partial", coverage: "~140 stores", caveats: "Stores-channel GROSS sales (before returns), units, bills (DSR categories only). Official source for store performance and targets.", enabled: true },
  { id: "store_targets", table: "MTD_TARGET_PERFUMES / MTD_TARGET_SHOES + Control Centre store targets (+ overrides)", grain: "store × category × day incl. future days", time: "DATE; phased", coverage: "Stores channel", caveats: "Store-level targets only spread the plan across stores/days. The Stores category target is ALWAYS the Control Centre plan; when Σ store targets differs from it by >1% a target_mismatch action appears.", enabled: true },
  { id: "channel_sales", table: "UNICOMMERCE_FACT_ITEMS_INTERMEDIATE", grain: "order item (quantity 1)", time: "ORDER_DATE", coverage: "Online = SHOPIFY; Marketplace = AJIO / MYNTRA / FLIPKART / AMAZON / NYKAA (Amazon has no long-tail orders since Jul 2026)", caveats: "Revenue = Σ SELLING_PRICE of items incl. cancellations. Shoes include 'Footwear'.", enabled: true },
  { id: "store_sku_sales", table: "HORIZONTAL_SALES_CATEGORIES (TYPE = Store)", grain: "order line", time: "DATE", coverage: "Stores", caveats: "The only store × product source; gross line value (~1–3% above DSR). Not used for channel totals.", enabled: true },
  { id: "product_master", table: "LONG_TAIL_MASTER_BIBLE", grain: "product (SKU group)", time: "refreshed daily", coverage: "All long-tail categories", caveats: "Identity, MRP, inwards, LIFETIME sales by channel, Return % (lifetime, value-based), store inventory (all stores).", enabled: true },
  { id: "warehouse_inventory", table: "UNICOMMERCE_LIVE_INVENTORY", grain: "warehouse × size-level SKU, current state", time: "UPDATED per row (IST)", coverage: "3 warehouses: North = SAPL-NORTH-TAURU; South = SAPL-WH1, SAPL-WH2", caveats: "Current state — summed across warehouses/sizes, never over time. Good stock only.", enabled: true },
  { id: "store_report", table: "OFFLINE_MASTER_DAILY_REPORT_1", grain: "store × product (SKU group) × day, daily snapshot", time: "DATE; the latest date = live store inventory", coverage: "~140 stores", caveats: "Snapshot — never sum across dates. Product level (no size split). A category is LIVE in a store if stock > 0 here or it sold in the last 60 days.", enabled: true },
  { id: "team_remarks", table: "remarks (app database)", grain: "one remark", time: "created_at; optional day / snooze-until", coverage: "entered by the team in the Action Centre", caveats: "Context, not data: not-applicable store × category pairs, snoozes, anomaly days (festival / Snitch birthday spikes), notes. Respect them.", enabled: true },
];

export const ENTITIES = [
  "Store (branch code, name, city, state, region, store type COCO/COFO/FOCO, status FRESH/OUTLET, area manager)",
  "Category — ONLY Accessories, Bags, Belts, Perfumes, Shoes (incl. Footwear, Sandals), Sunglasses, Trolleys (Luggage). Apparel is out of scope.",
  "Product family (a style: same name across colour variants) → SKU groups (e.g. SH0173-01 black, SH0173-02 brown) → sizes",
  "Channel: Overall = Stores + Online + Marketplace; Online = Shopify; Marketplace = AJIO / MYNTRA / FLIPKART / AMAZON / NYKAA",
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
  { name: "Revenue", type: "additive", rule: "Stores: DSR gross sales (SALES, before returns). Online / Marketplace: Σ selling price of all (incl. cancelled) Unicommerce items. Overall = sum of the three." },
  { name: "Units", type: "additive", rule: "Stores: DSR qty. Online / Marketplace: items incl. cancellations." },
  { name: "Orders / Bills", type: "additive", rule: "Online / Marketplace: distinct orders. Stores: bills." },
  { name: "Target / Achievement %", type: "plan", rule: "Stores channel only: phased store targets; achievement = stores revenue ÷ target." },
  { name: "Gap / Required run rate / Projected", type: "calculated", rule: "Target − revenue; remaining month target ÷ remaining days; MTD achievement × month target." },
  { name: "ASP", type: "calculated", rule: "Revenue ÷ units." },
  { name: "Growth", type: "calculated", rule: "vs the comparable period (MTD vs prev month same days; WTD vs same weekdays last week)." },
  { name: "Stores selling / Sales per store", type: "distinct", rule: "Distinct stores with ≥1 sale; revenue ÷ active stores (÷ days)." },
  { name: "Return %", type: "snapshot", rule: "LIFETIME, value-based: returned ₹ ÷ sold ₹ (Product Master), per channel or overall. No period return % exists." },
  { name: "Store inventory", type: "snapshot", rule: "Store report (OFFLINE_MASTER_DAILY_REPORT_1), latest date = live; per product (all stores) or per store (~140 stores)." },
  { name: "Warehouse inventory", type: "snapshot", rule: "Unicommerce live stock (current state), summed across warehouses and sizes." },
  { name: "Days of inventory (DOI)", type: "calculated", rule: "(store + warehouse units) ÷ (last-30-days units ÷ 30) — always this definition." },
  { name: "Free gifts", type: "calculated", rule: "Items sold under ₹10 per unit (e.g. socks given free) are free gifts in every category: excluded from units and never treated as fast movers or stock risks." },
  { name: "Live category (store)", type: "calculated", rule: "Stock > 0 on the latest store report OR a sale in the last 60 days, unless a team remark says the store doesn't carry it." },
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
