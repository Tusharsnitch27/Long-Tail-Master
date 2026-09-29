/**
 * Category registry — one entry per business category, with its name in each source.
 * Adding a category = adding an entry here (and enabling it in Settings).
 *  - source "dsr": Stores-channel facts come from a DSR table + daily target table (bills, targets)
 *  - source "sales": Stores-channel facts are derived from HORIZONTAL_SALES_CATEGORIES (no bills; targets via Postgres)
 */
export type CategoryKey = string;

export interface CategoryDef {
  key: CategoryKey;
  label: string;
  /** CATEGORY in HORIZONTAL_SALES_CATEGORIES */
  salesCategory: string;
  /** CATEGORY values in UNICOMMERCE_FACT_ITEMS_INTERMEDIATE / UNICOMMERCE_LIVE_INVENTORY */
  ucCategories: string[];
  /** CATEGORY values in the product masters */
  masterCategory: string[];
  /** SKU-group prefixes that belong here when the master has no category (legacy codes) */
  skuPrefixes?: string[];
  source: "dsr" | "sales";
  dsrTable?: string;
  targetTable?: string;
  color: string;
}

export const CATEGORIES: CategoryDef[] = [
  { key: "perfumes", label: "Perfumes", salesCategory: "Perfumes", ucCategories: ["Perfumes"], masterCategory: ["PERFUMES", "Perfumes"], skuPrefixes: ["4MSFR"], source: "dsr", dsrTable: "LONG_TAIL_DSR_PERFUMES", targetTable: "MTD_TARGET_PERFUMES", color: "#6d5bd0" },
  { key: "shoes", label: "Shoes", salesCategory: "Shoes", ucCategories: ["Shoes", "Footwear"], masterCategory: ["SHOES", "Shoes", "Footwear", "FOOTWEAR"], skuPrefixes: ["SH"], source: "dsr", dsrTable: "LONG_TAIL_DSR_SHOES", targetTable: "MTD_TARGET_SHOES", color: "#d97a2b" },
  { key: "sunglasses", label: "Sunglasses", salesCategory: "Sunglasses", ucCategories: ["Sunglasses"], masterCategory: ["Sunglasses", "SUNGLASSES"], source: "sales", color: "#2b8fd9" },
  { key: "belts", label: "Belts", salesCategory: "Belts", ucCategories: ["Belts"], masterCategory: ["Belts", "BELTS"], source: "sales", color: "#5a9e4b" },
  { key: "bags", label: "Bags", salesCategory: "Bags", ucCategories: ["Bags"], masterCategory: ["Bags", "BAGS"], source: "sales", color: "#b8487a" },
  { key: "accessories", label: "Accessories", salesCategory: "Accessories", ucCategories: ["Accessories"], masterCategory: ["Accessories", "ACCESSORIES"], source: "sales", color: "#8a8a3a" },
  { key: "luggage", label: "Luggage", salesCategory: "Luggage", ucCategories: ["TROLLEY", "Luggage"], masterCategory: ["Luggage", "LUGGAGE"], skuPrefixes: ["4MTL"], source: "sales", color: "#4b7f9e" },
];

export const DEFAULT_ENABLED = ["perfumes", "shoes"];

export const catByKey = (k: string) => CATEGORIES.find((c) => c.key === k);
export const catBySalesName = (n: string) => CATEGORIES.find((c) => c.salesCategory.toLowerCase() === n?.toLowerCase());
export const catByUc = (n: string) => CATEGORIES.find((c) => c.ucCategories.some((u) => u.toLowerCase() === n?.toLowerCase()));
export const catByMaster = (n: string) => CATEGORIES.find((c) => c.masterCategory.some((m) => m.toLowerCase() === n?.toLowerCase()));
/** Category for a product: master category first, else legacy SKU prefix (longest prefix wins). */
export const catForProduct = (masterCategory: string | null | undefined, sku: string) =>
  (masterCategory ? catByMaster(masterCategory) : undefined) ??
  CATEGORIES.flatMap((c) => (c.skuPrefixes ?? []).map((p) => ({ c, p }))).filter(({ p }) => sku.toUpperCase().startsWith(p)).sort((a, b) => b.p.length - a.p.length)[0]?.c;

/** Channels in the UI. Marketplace members are fixed by definition; which ones appear depends on the data. */
export const MARKETPLACES = ["AJIO", "MYNTRA", "FLIPKART", "AMAZON"] as const;
export const ONLINE = "SHOPIFY";
export type Channel = "all" | "stores" | "online" | "marketplace";
export const CHANNELS: { key: Channel; label: string }[] = [
  { key: "all", label: "Overall" }, { key: "stores", label: "Stores" }, { key: "online", label: "Online" }, { key: "marketplace", label: "Marketplace" },
];
