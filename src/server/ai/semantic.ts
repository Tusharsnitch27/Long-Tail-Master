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
  {
    id: "store_daily",
    table: "LONG_TAIL_DSR_PERFUMES / LONG_TAIL_DSR_SHOES",
    grain: "store × category × day (rows only exist for days with a sale)",
    time: "DATE (IST business day); today is partial until end of day",
    coverage: "~137 offline stores; perfumes from Aug 2023, shoes from Oct 2023",
    caveats: "Net sales after discount. Bills/units/MRP available. Official source for store revenue and target achievement.",
    enabled: true,
  },
  {
    id: "store_targets",
    table: "MTD_TARGET_PERFUMES / MTD_TARGET_SHOES (+ PostgreSQL overrides)",
    grain: "store × category × day, including future days of the month",
    time: "DATE; phased (weekends carry more)",
    coverage: "All target-bearing stores",
    caveats: "Targets are plans, not actuals. Overrides from Target Setup are applied on top.",
    enabled: true,
  },
  {
    id: "sku_sales",
    table: "HORIZONTAL_SALES_CATEGORIES",
    grain: "order line (SKU group × channel × day)",
    time: "DATE",
    coverage: "All channels: stores (TYPE=Store, CHANNEL=store name), website/app, marketplaces",
    caveats: "Gross line value — differs ~1–3% from DSR net sales. Use for SKU-level questions only.",
    enabled: true,
  },
  {
    id: "product_master",
    table: "LONG_TAIL_MASTER_BIBLE + LONG_TAIL_PRODUCT_INVENTORY_MASTER",
    grain: "SKU group",
    time: "Bible refreshed daily; inventory master last refreshed Jul 2026 (static attributes only)",
    coverage: "Bible: perfumes only (44). Inventory master: all long-tail categories (names, colour, status)",
    enabled: true,
  },
  {
    id: "network_inventory",
    table: "INVENTORY_DAILY_SNAPSHOT_LATEST",
    grain: "SKU group × cut-size × daily snapshot",
    time: "SNAPSHOT_TS per SKU — latest snapshot differs by SKU",
    coverage: "All long-tail SKUs; online (warehouse) and offline (all stores combined) totals",
    caveats: "Snapshot metric. The latest snapshot per SKU is used; never sum across snapshots.",
    enabled: true,
  },
  {
    id: "store_inventory",
    table: "SPEED_INVENTORY",
    grain: "store × SKU size × bin location × daily snapshot",
    time: "SAVED_DATE per store — latest per store",
    coverage: "Only the stores in the store-inventory feed (~20 of ~137)",
    caveats: "Snapshot metric. Store counts from this source cover only feed stores — always disclose.",
    enabled: true,
  },
];

export const ENTITIES = [
  "Store (branch code, name, city, state, region, store type COCO/COFO/FOCO, status FRESH/OUTLET, area manager)",
  "Category (Perfumes, Shoes — others registered but may be disabled)",
  "Product family (a style: same name across colour variants) → SKU groups (e.g. SH0173-01 black, SH0173-02 brown) → sizes",
  "Channel (Stores, Website/App, Marketplace)",
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
  { name: "Revenue", type: "additive", rule: "Sum over the period. Store views: DSR net sales. SKU views: gross line value." },
  { name: "Units", type: "additive", rule: "Sum over the period." },
  { name: "Bills", type: "additive", rule: "Store level only (not available at SKU level)." },
  { name: "Target", type: "plan", rule: "Sum of phased daily targets over the period (target-to-date for partial periods)." },
  { name: "Achievement %", type: "calculated", rule: "Revenue ÷ Target; undefined when target is 0/missing." },
  { name: "Gap", type: "calculated", rule: "Target − Revenue." },
  { name: "Required run rate", type: "calculated", rule: "(Month target − MTD revenue) ÷ remaining days." },
  { name: "Projected month-end", type: "calculated", rule: "MTD achievement × full-month target (phasing-aware)." },
  { name: "ASP", type: "calculated", rule: "Revenue ÷ Units." },
  { name: "ATV / UPT", type: "calculated", rule: "Revenue ÷ Bills / Units ÷ Bills." },
  { name: "Stores selling", type: "distinct", rule: "Distinct stores with ≥1 sale in the period (not additive across periods)." },
  { name: "Store penetration", type: "calculated", rule: "Stores selling the SKU ÷ active stores in scope." },
  { name: "Sales per store / per store per day", type: "calculated", rule: "Revenue ÷ active stores (÷ days)." },
  { name: "L7 / L30 / MTD sales", type: "additive", rule: "Rolling windows ending at the as-of date (last complete day)." },
  { name: "Last sale date", type: "snapshot", rule: "Max sale date within a 90-day lookback." },
  { name: "Current inventory", type: "snapshot", rule: "Latest snapshot only (per SKU for network, per store for store level). Never summed over time." },
  { name: "Stores with stock", type: "distinct", rule: "Stores with current inventory > 0 in the store-inventory feed." },
  { name: "MRP / price / SKU status / store status", type: "snapshot", rule: "Current value from the master." },
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
