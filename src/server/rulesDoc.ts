import "server-only";
import { RULES } from "./actions";
import type { AppSettings } from "./settings";

const p = (v: number) => `${Math.round(v * 100)}%`;

/** Plain-language rule book: what each rule does, where it applies and the value in force. */
export function ruleBook(s: AppSettings) {
  const t = s.thresholds;
  return [
    { group: "Targets", name: "Status bands", where: "Executive Summary status, store bands, KPI and chart colours", value: `Ahead ≥${p(t.ahead)} · On track ≥${p(t.onTrack)} · At risk ≥${p(t.atRisk)} · Behind below`, why: "Projected (month) or period achievement against target" },
    { group: "Targets", name: "Stores target", where: "Every Stores / Overall target, gap and achievement", value: "The plan’s category Stores target (Control Centre)", why: "Store targets (Snowflake or uploaded) only spread it across stores and days; if they don’t add up to the plan, it’s flagged for you to align" },
    { group: "Targets", name: "Gross sales", where: "Every revenue and achievement figure", value: "Gross sales before returns", why: "Same basis as the plan: DSR SALES, store sales lines (GROSS_SALES), Unicommerce selling price" },
    { group: "Targets", name: "Daily phasing", where: "Target to date, daily target line, required run rate", value: "Control Centre split per channel (per state for Stores) · even when none is set", why: "Weekends and festive days carry the weight you give them" },
    { group: "Targets", name: "Missing targets", where: "All target metrics", value: "Never inferred", why: "Slices without a target are excluded and named; achievement is like for like" },
    { group: "Targets", name: "Month-end projection", where: "Executive Summary, category and channel tables", value: "MTD achievement × month target (target slices) · daily run rate × days (others)", why: "Phasing-aware — a slow start on light days isn't punished" },
    { group: "Sales", name: "Free gifts", where: "Units, ASP, velocity, DOI, top / bottom SKUs — all categories", value: "Items sold under ₹10 per unit are free gifts (e.g. socks): excluded from units and velocity, counted separately", why: "Gift units would otherwise inflate sell-through and hide real demand. DSR totals (Perfumes, Shoes) are store-day aggregates and can't be split" },
    { group: "Inventory", name: "Days of inventory (DOI)", where: "Product, category and merchandising views", value: "(store + warehouse units) ÷ (last-30-day units ÷ 30) · red <14 · amber >180", why: "Based on the last 30 days of sale (gifts excluded); inventory is always the latest snapshot, never summed over days" },
    { group: "Inventory", name: "Fast mover, low cover", where: "Action Centre (SKU), at-risk SKUs", value: `≥${RULES.fastMinPerDay} unit/day and <${RULES.fastDoiDays} days of cover (urgent <${RULES.urgentDoiDays})`, why: "Stock-outs on sellers are the most expensive miss" },
    { group: "Inventory", name: "Slow moving / excess", where: "Merchandising → Excess, bottom SKUs", value: `>${RULES.slowDoiDays} days of cover and ≥${RULES.slowMinUnits} units`, why: "Redistribute first; promote only where business rules allow" },
    { group: "Stores", name: "Category live in a store", where: "Every store action, distribution and expansion", value: "Stock > 0 on the latest store report, or sales in the last 60 days", why: "A store can't be asked to sell a category it doesn't carry — those stores go to Distribution instead" },
    { group: "Stores", name: "Allocation", where: "Merchandising → Allocation, Action Centre", value: `L7 ≥${RULES.allocMinL7} units, low store stock, warehouse ≥${RULES.allocMinWarehouse} · qty = ${RULES.allocCoverDays} days of cover, capped at 25% of warehouse`, why: "Move stock to where it's selling" },
    { group: "Stores", name: "Category gap", where: "Action Centre (Stores)", value: `Below ${p(RULES.catGapRatio)} of peer median sales/day in a live category`, why: "Strong store, weak category — execution, VM or range issue" },
    { group: "Stores", name: "Distribution opportunity", where: "Merchandising → Distribution", value: `Top ${p(1 - RULES.distTopQuantile)} sellers in ≤${p(RULES.distMaxPenetration)} of live stores, warehouse ≥${RULES.distMinWarehouse}`, why: "Winners that most stores don't carry" },
    { group: "Channels", name: "Channel decline", where: "Action Centre (Channel), risks", value: `WoW ≤${p(RULES.channelDropPct)} and ≥₹${RULES.channelDropMin.toLocaleString("en-IN")} (urgent ≥₹${(RULES.urgentChannelDrop / 1e5).toFixed(0)}L)`, why: "Material drops only" },
    { group: "Channels", name: "Return risk", where: "Action Centre (Channel), high-return lists", value: `Lifetime return % ≥ category average +${p(RULES.returnExcessPp)} with ≥₹${(RULES.returnMinSales / 1e5).toFixed(0)}L sales`, why: "Value-based return % from the Product Master (lifetime)" },
    { group: "Remarks", name: "Remarks", where: "Action Centre, store / product pages, Mitra", value: "Not applicable → hides matching actions · Snooze → hides until the date · Context → shown next to the data", why: "Your team's knowledge (no stock, events, closures) is taken into account" },
  ];
}

/** Source tables and what each is used for. */
export const TABLES = [
  { table: "LONG_TAIL_DSR_PERFUMES, LONG_TAIL_DSR_SHOES", use: "Stores gross sales, units, bills for Perfumes and Shoes; store list and attributes", grain: "store × day (sale days only)" },
  { table: "MTD_TARGET_PERFUMES, MTD_TARGET_SHOES", use: "Snowflake store targets (used when no store targets are uploaded)", grain: "store × day" },
  { table: "UNICOMMERCE_FACT_ITEMS_INTERMEDIATE", use: "Online (Shopify) and Marketplace (AJIO, Myntra, Flipkart, Amazon) revenue, units, orders", grain: "order item" },
  { table: "HORIZONTAL_SALES_CATEGORIES", use: "Store sales for categories without a DSR (Accessories, Bags, Belts, Sunglasses, Trolleys), store × product sales, fallback checks", grain: "order line" },
  { table: "LONG_TAIL_MASTER_BIBLE", use: "Product identity, image, MRP, inwards, lifetime sales by channel, return %", grain: "SKU group" },
  { table: "GS_LONGTAIL_METAFIELD + Longtail Metafields workbook", use: "L1 / L2 product type, images; shoe attributes (colour, occasion, material …)", grain: "SKU group" },
  { table: "OFFLINE_MASTER_DAILY_REPORT_1", use: "Store inventory — latest date = live; earlier dates = history; store category mix", grain: "store × SKU group × day" },
  { table: "UNICOMMERCE_LIVE_INVENTORY", use: "Current warehouse stock (SAPL-WH1, SAPL-WH2 = South; SAPL-NORTH-TAURU = North)", grain: "warehouse × size SKU (current)" },
  { table: "SNITCH_FINAL_INVENTORY_WH2", use: "Daily warehouse stock history (same three warehouses)", grain: "warehouse × SKU × day" },
  { table: "PUTAWAY_TRACKING (FINAL_TYPE = 'New Inward')", use: "Product inward timeline: date, warehouse, quantity", grain: "putaway item" },
  { table: "PostgreSQL (app)", use: "Users, targets and splits, store targets, remarks, action status, VM Revamp, future inwards, attribute edits, change log", grain: "—" },
];
