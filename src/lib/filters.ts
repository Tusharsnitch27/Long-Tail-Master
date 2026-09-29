import type { Preset } from "./dates";

export interface Filters {
  preset: Preset;
  from?: string;
  to?: string;
  cats: string[];
  stores: string[];
  state: string[];
  region: string[];
  city: string[];
  om: string[];
  sst: string[];
  am: string[];
  ct: string[];
  lt: string[];
  /** sales channel for SKU views */
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
const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(",") : v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function parseFilters(sp: SP, enabledCats: string[]): Filters {
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined));
  const cats = list(sp.cat).filter((c) => enabledCats.includes(c));
  const ch = one("ch");
  return {
    preset: (one("p") as Preset) || "mtd",
    from: one("from"),
    to: one("to"),
    cats: cats.length ? cats : enabledCats,
    stores: list(sp.store),
    state: list(sp.state),
    region: list(sp.region),
    city: list(sp.city),
    om: list(sp.om),
    sst: list(sp.sst),
    am: list(sp.am),
    ct: list(sp.ct),
    lt: list(sp.lt),
    ch: ch === "shopify" || ch === "marketplace" || ch === "all" ? ch : "store",
    pb: list(sp.pb),
  };
}

export function hasStoreFilters(f: Filters) {
  return f.stores.length > 0 || STORE_DIMS.some((d) => (f[d.key as keyof Filters] as string[]).length > 0);
}
