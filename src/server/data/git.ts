import "server-only";
import { CATEGORIES } from "@/lib/categories";
import { cached } from "@/lib/cache";
import { sfCached } from "../snowflake";
import { productCode } from "./warehouse";

/**
 * Goods in transit (GIT) from the warehouse to stores — JIT_OFFLINE_GOODS: one row per store × size SKU × inward date,
 * current state (refreshed daily). Every row is stock already allocated to a store but not yet in its store stock:
 *   WH_PENDING (allocated, still at the warehouse) → PICKUP_PENDING → ESHIP_PENDING → DELIVERY_PENDING (on the road)
 *   → INWARD_PENDING (delivered, store inward pending).
 * SKU_GROUP is only the style for shoes (e.g. SH0173), so the product is taken from ITEM CODE (e.g. SH0173-01-40 → SH0173-01).
 */
const T = "SNITCH_DB.MAPLEMONK.JIT_OFFLINE_GOODS";

export const GIT_STAGES = [
  { key: "WH_PENDING", label: "At warehouse · dispatch pending", short: "At warehouse", color: "#e2c9a6" },
  { key: "PICKUP_PENDING", label: "Awaiting courier pickup", short: "Pickup", color: "#d3b089" },
  { key: "ESHIP_PENDING", label: "Shipment created", short: "Shipped", color: "#c08f60" },
  { key: "DELIVERY_PENDING", label: "On the way to the store", short: "On the way", color: "#8c5a30" },
  { key: "INWARD_PENDING", label: "Delivered · store inward pending", short: "At store, not inwarded", color: "#2e6f73" },
] as const;
export type GitStage = (typeof GIT_STAGES)[number]["key"];
export const gitStage = (s: string) => GIT_STAGES.find((x) => x.key === s);
/** Ageing at or above this many days is flagged as stuck. */
export const GIT_STUCK_DAYS = 7;

export interface GitLine { b: string; store: string; sku: string; item: string; qty: number; status: string; inward: string | null; aging: number; skuClass: string | null }
export interface GitAgg { units: number; lines: number; maxAging: number; oldest: string | null; stuck: number; byStage: Record<string, number> }
export interface GitData {
  lines: GitLine[];
  /** product → totals (all stores) */
  bySku: Map<string, GitAgg & { stores: number }>;
  /** `${branch}|${sku}` → totals */
  byStoreSku: Map<string, GitAgg>;
  /** branch → totals */
  byStore: Map<string, GitAgg & { skus: number }>;
  updated: string | null;
}

const emptyAgg = (): GitAgg => ({ units: 0, lines: 0, maxAging: 0, oldest: null, stuck: 0, byStage: {} });
const add = (a: GitAgg, l: GitLine) => {
  a.units += l.qty; a.lines++; a.maxAging = Math.max(a.maxAging, l.aging);
  if (l.inward && (!a.oldest || l.inward < a.oldest)) a.oldest = l.inward;
  if (l.aging >= GIT_STUCK_DAYS) a.stuck += l.qty;
  a.byStage[l.status] = (a.byStage[l.status] ?? 0) + l.qty;
};

const CAT_NAMES = [...new Set(CATEGORIES.flatMap((c) => [c.salesCategory, ...c.ucCategories, ...c.masterCategory]))];
const PREFIXES = CATEGORIES.flatMap((c) => c.skuPrefixes);

export function getGoodsInTransit(known: Set<string>): Promise<GitData> {
  return cached(`git:v1:${known.size}`, 900, async () => {
    const [rows, ts] = await Promise.all([
      sfCached<{ b: number | null; store: string | null; item: string; qty: number; status: string; inward: string | null; aging: number | null; cls: string | null }>(
        "git:lines:v1",
        `select branch_code b, max(store) store, upper("ITEM CODE") item, sum(qty) qty, status, to_varchar(inward_date) inward, max(aging) aging, max(sku_class) cls
         from ${T}
         where qty > 0 and (category in (${CAT_NAMES.map(() => "?").join(",")}) or upper("ITEM CODE") like any (${PREFIXES.map(() => "?").join(",")}))
         group by 1, 3, 5, 6`,
        [...CAT_NAMES, ...PREFIXES.map((p) => `${p}%`)],
        900,
      ),
      sfCached<{ t: string | null }>("git:updated", `select to_varchar(last_altered, 'YYYY-MM-DD"T"HH24:MI:SS TZH:TZM') t from SNITCH_DB.information_schema.tables where table_schema = 'MAPLEMONK' and table_name = 'JIT_OFFLINE_GOODS'`, [], 900).catch(() => []),
    ]);
    const lines: GitLine[] = [];
    for (const r of rows) {
      if (r.b == null) continue;
      const sku = productCode(String(r.item), known);
      if (!known.has(sku)) continue; // only long-tail products in the master
      lines.push({ b: String(Math.round(Number(r.b))), store: String(r.store ?? "").replace(/^SNITCH\s*-\s*/i, ""), sku, item: String(r.item), qty: +r.qty || 0, status: String(r.status), inward: r.inward, aging: +(r.aging ?? 0) || 0, skuClass: r.cls });
    }
    const bySku = new Map<string, GitAgg & { stores: number }>(), byStoreSku = new Map<string, GitAgg>(), byStore = new Map<string, GitAgg & { skus: number }>();
    const storesOf = new Map<string, Set<string>>(), skusOf = new Map<string, Set<string>>();
    for (const l of lines) {
      const k = `${l.b}|${l.sku}`;
      add(byStoreSku.get(k) ?? byStoreSku.set(k, emptyAgg()).get(k)!, l);
      add(bySku.get(l.sku) ?? bySku.set(l.sku, { ...emptyAgg(), stores: 0 }).get(l.sku)!, l);
      add(byStore.get(l.b) ?? byStore.set(l.b, { ...emptyAgg(), skus: 0 }).get(l.b)!, l);
      (storesOf.get(l.sku) ?? storesOf.set(l.sku, new Set()).get(l.sku)!).add(l.b);
      (skusOf.get(l.b) ?? skusOf.set(l.b, new Set()).get(l.b)!).add(l.sku);
    }
    for (const [s, e] of bySku) e.stores = storesOf.get(s)?.size ?? 0;
    for (const [b, e] of byStore) e.skus = skusOf.get(b)?.size ?? 0;
    return { lines, bySku, byStoreSku, byStore, updated: ts[0]?.t ?? null };
  });
}

/** "12 in transit (8 on the way · 4 at warehouse)" style summary of a GIT aggregate. */
export function gitSummary(a: GitAgg | undefined | null) {
  if (!a || a.units <= 0) return null;
  const parts = GIT_STAGES.filter((s) => a.byStage[s.key]).map((s) => `${a.byStage[s.key]} ${s.short.toLowerCase()}`);
  return `${a.units} in transit (${parts.join(" · ")})${a.maxAging >= GIT_STUCK_DAYS ? ` · oldest ${a.maxAging}d` : ""}`;
}
