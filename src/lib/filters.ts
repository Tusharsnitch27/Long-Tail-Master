import type { Preset } from "./dates";
import type { Channel } from "./categories";

/**
 * Global context: Category (single, default Overall), Period, Channel (+ marketplace), Store (only where relevant).
 * Options shown in the UI are built from values present in the data.
 */
export interface Filters {
  preset: Preset;
  from?: string;
  to?: string;
  /** selected category key, or null = Overall */
  cat: string | null;
  /** categories in scope (Overall = all enabled) */
  cats: string[];
  channel: Channel;
  /** marketplace when channel = marketplace (null = all marketplaces) */
  mp: string | null;
  stores: string[];
  // store dimensions (not exposed as global filters; kept for scoped queries)
  state: string[];
  region: string[];
  city: string[];
  om: string[];
  sst: string[];
  am: string[];
  ct: string[];
  lt: string[];
  /** SKU-sales channel for store × SKU queries */
  ch: "store" | "shopify" | "marketplace" | "all";
  pb: string[];
}

export const STORE_DIMS = [
  { key: "region", label: "Region", field: "region" },
  { key: "state", label: "State", field: "state" },
  { key: "city", label: "City", field: "city" },
  { key: "om", label: "Store type", field: "operating_model" },
  { key: "sst", label: "Store status", field: "store_status" },
  { key: "am", label: "Area manager", field: "am" },
  { key: "ct", label: "City type", field: "city_type" },
  { key: "lt", label: "Location", field: "location_type" },
] as const;

export const PRICE_BANDS = [
  { key: "lt1000", label: "< ₹1,000", min: 0, max: 999 },
  { key: "1000-1499", label: "₹1,000–1,499", min: 1000, max: 1499 },
  { key: "1500-1999", label: "₹1,500–1,999", min: 1500, max: 1999 },
  { key: "2000-2499", label: "₹2,000–2,499", min: 2000, max: 2499 },
  { key: "2500+", label: "₹2,500+", min: 2500, max: Infinity },
];

type SP = Record<string, string | string[] | undefined>;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(",") : v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined));

export function parseFilters(sp: SP, enabledCats: string[]): Filters {
  const c = one(sp, "cat");
  const cat = c && enabledCats.includes(c) ? c : null;
  const chan = one(sp, "ch");
  const channel: Channel = chan === "stores" || chan === "online" || chan === "marketplace" ? chan : "all";
  return {
    preset: (one(sp, "p") as Preset) || "mtd",
    from: one(sp, "from"),
    to: one(sp, "to"),
    cat,
    cats: cat ? [cat] : enabledCats,
    channel,
    mp: channel === "marketplace" ? one(sp, "mp") ?? null : null,
    stores: list(sp.store),
    state: [], region: [], city: [], om: [], sst: [], am: [], ct: [], lt: [],
    ch: "store",
    pb: [],
  };
}

export function hasStoreFilters(f: Filters) {
  return f.stores.length > 0;
}
