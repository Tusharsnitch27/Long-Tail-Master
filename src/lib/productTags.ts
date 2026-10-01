/**
 * Product-level team remarks (tags). Each tag hides the action types it contradicts for that SKU and is shown as a
 * team note everywhere else (product page, Product Master, remaining actions, Harvey).
 */
export const PRODUCT_TAGS = {
  no_store_dispatch: { label: "Not to be sent to stores", hint: "Stops allocation, distribution and store-push suggestions", hides: ["allocation", "missed_distribution", "distribution", "category_expansion"] },
  store_recall: { label: "Being called back from stores", hint: "Stops store pushes and transfers; slow stock in stores is expected", hides: ["allocation", "missed_distribution", "distribution", "inventory_low_sales", "slow_moving"] },
  online_only: { label: "Online / marketplace only", hint: "No store allocation or distribution", hides: ["allocation", "missed_distribution", "distribution"] },
  discontinued: { label: "Discontinued — no reorder", hint: "No reorder or replenishment nudges", hides: ["fast_low_doi", "distribution", "allocation", "boost_new_inward"] },
  quality_hold: { label: "Quality / stock on hold", hint: "No boosts, pushes or allocation until cleared", hides: ["allocation", "missed_distribution", "distribution", "boost_new_inward", "boost_paced_down", "boost_online_stock"] },
  no_boost: { label: "Don't promote", hint: "Keep out of marketing boosts", hides: ["boost_new_inward", "boost_paced_down", "boost_online_stock"] },
} as const;
export type ProductTag = keyof typeof PRODUCT_TAGS;
export const PRODUCT_TAG_KEYS = Object.keys(PRODUCT_TAGS) as ProductTag[];
export const productTagLabel = (t: string | null | undefined): string | null => (t && t in PRODUCT_TAGS ? PRODUCT_TAGS[t as ProductTag].label : null);
