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
  { key: "accessories", label: "Accessories", salesCategory: "Accessories", ucCategories: ["Accessories"], masterCategory: ["Accessories", "ACCESSORIES", "Caps", "CAPS"], skuPrefixes: ["4MAC", "4MCP", "4MSCK", "4MBD", "4MHT", "4MSFC", "4MSFL"], source: "sales", color: "#e08a3c" },
  { key: "bags", label: "Bags", salesCategory: "Bags", ucCategories: ["Bags"], masterCategory: ["Bags", "BAGS"], skuPrefixes: ["BP"], source: "sales", color: "#c2527a" },
  { key: "belts", label: "Belts", salesCategory: "Belts", ucCategories: ["Belts"], masterCategory: ["Belts", "BELTS"], skuPrefixes: ["4MBL"], source: "sales", color: "#7a6a3a" },
  { key: "perfumes", label: "Perfumes", salesCategory: "Perfumes", ucCategories: ["Perfumes"], masterCategory: ["PERFUMES", "Perfumes"], skuPrefixes: ["4MSFR"], source: "dsr", dsrTable: "LONG_TAIL_DSR_PERFUMES", targetTable: "MTD_TARGET_PERFUMES", color: "#0e8a96" },
  { key: "shoes", label: "Shoes", salesCategory: "Shoes", ucCategories: ["Shoes", "Footwear"], masterCategory: ["SHOES", "Shoes", "Footwear", "FOOTWEAR", "Sandals", "SANDALS"], skuPrefixes: ["SH"], source: "dsr", dsrTable: "LONG_TAIL_DSR_SHOES", targetTable: "MTD_TARGET_SHOES", color: "#0b3b44" },
  { key: "sunglasses", label: "Sunglasses", salesCategory: "Sunglasses", ucCategories: ["Sunglasses"], masterCategory: ["Sunglasses", "SUNGLASSES"], skuPrefixes: ["SN"], source: "sales", color: "#5cc0c7" },
  { key: "luggage", label: "Trolleys", salesCategory: "Luggage", ucCategories: ["TROLLEY", "Luggage"], masterCategory: ["Luggage", "LUGGAGE", "TROLLEY"], skuPrefixes: ["4MTL"], source: "sales", color: "#6b7fd7" },
];

export const DEFAULT_ENABLED = ["accessories", "bags", "belts", "perfumes", "shoes", "sunglasses", "luggage"];
/** Category keys in A→Z order of their labels (every list and table uses this order). */
export const sortCats = (keys: string[]) => [...keys].sort((a, b) => (catByKey(a)?.label ?? a).localeCompare(catByKey(b)?.label ?? b));
/** Scope guard: only these source categories belong to the tool (anything else is out of scope for pages and Mitra). */
export const IN_SCOPE_NOTE = "Accessories, Bags, Belts, Perfumes, Shoes (incl. Footwear, Sandals), Sunglasses and Trolleys";

export const catByKey = (k: string) => CATEGORIES.find((c) => c.key === k);
export const catBySalesName = (n: string) => CATEGORIES.find((c) => c.salesCategory.toLowerCase() === n?.toLowerCase());
export const catByUc = (n: string) => CATEGORIES.find((c) => c.ucCategories.some((u) => u.toLowerCase() === n?.toLowerCase()));
export const catByMaster = (n: string) => CATEGORIES.find((c) => c.masterCategory.some((m) => m.toLowerCase() === n?.toLowerCase()));
/** Category for a product: SKU prefix first (BP = Bags, 4MTL = Trolleys, SH = Shoes, 4MSFR = Perfumes, 4MBL = Belts, SN = Sunglasses,
 * 4MAC / 4MCP / 4MSCK … = Accessories; longest prefix wins), then the master's category. */
export const catForProduct = (masterCategory: string | null | undefined, sku: string) =>
  CATEGORIES.flatMap((c) => (c.skuPrefixes ?? []).map((p) => ({ c, p }))).filter(({ p }) => sku.toUpperCase().startsWith(p)).sort((a, b) => b.p.length - a.p.length)[0]?.c ??
  (masterCategory ? catByMaster(masterCategory) : undefined);

/** Channels in the UI. Marketplace members are fixed by definition; which ones appear depends on the data. */
export const MARKETPLACES = ["AJIO", "MYNTRA", "FLIPKART", "AMAZON", "NYKAA"] as const;
export const ONLINE = "SHOPIFY";
export type Channel = "all" | "stores" | "online" | "marketplace";
export const CHANNELS: { key: Channel; label: string }[] = [
  { key: "all", label: "Overall" }, { key: "stores", label: "Stores" }, { key: "online", label: "Online" }, { key: "marketplace", label: "Marketplace" },
];
