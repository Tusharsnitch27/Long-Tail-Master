/**
 * Category registry. Adding a long-tail category = adding an entry here (and enabling it in Admin → Settings).
 *  - source "dsr": store-day facts come from a DSR table + a daily target table (bills, targets available)
 *  - source "sales": store-day facts are derived from HORIZONTAL_SALES_CATEGORIES (no bills; targets only via Postgres)
 */
export type CategoryKey = string;

export interface CategoryDef {
  key: CategoryKey;
  label: string;
  /** value of CATEGORY in HORIZONTAL_SALES_CATEGORIES */
  salesCategory: string;
  /** value(s) of CATEGORY in product masters */
  masterCategory: string[];
  source: "dsr" | "sales";
  dsrTable?: string;
  targetTable?: string;
  color: string;
}

export const CATEGORIES: CategoryDef[] = [
  { key: "perfumes", label: "Perfumes", salesCategory: "Perfumes", masterCategory: ["PERFUMES", "Perfumes"], source: "dsr", dsrTable: "LONG_TAIL_DSR_PERFUMES", targetTable: "MTD_TARGET_PERFUMES", color: "#6d5bd0" },
  { key: "shoes", label: "Shoes", salesCategory: "Shoes", masterCategory: ["Shoes", "SHOES"], source: "dsr", dsrTable: "LONG_TAIL_DSR_SHOES", targetTable: "MTD_TARGET_SHOES", color: "#d97a2b" },
  { key: "sunglasses", label: "Sunglasses", salesCategory: "Sunglasses", masterCategory: ["Sunglasses"], source: "sales", color: "#2b8fd9" },
  { key: "belts", label: "Belts", salesCategory: "Belts", masterCategory: ["Belts"], source: "sales", color: "#5a9e4b" },
  { key: "bags", label: "Bags", salesCategory: "Bags", masterCategory: ["Bags"], source: "sales", color: "#b8487a" },
  { key: "accessories", label: "Accessories", salesCategory: "Accessories", masterCategory: ["Accessories"], source: "sales", color: "#8a8a3a" },
  { key: "luggage", label: "Luggage", salesCategory: "Luggage", masterCategory: ["Luggage"], source: "sales", color: "#4b7f9e" },
];

export const DEFAULT_ENABLED = ["perfumes", "shoes"];

export const catByKey = (k: string) => CATEGORIES.find((c) => c.key === k);
export const catBySalesName = (n: string) => CATEGORIES.find((c) => c.salesCategory.toLowerCase() === n?.toLowerCase());
export const catByMaster = (n: string) => CATEGORIES.find((c) => c.masterCategory.some((m) => m.toLowerCase() === n?.toLowerCase()));
