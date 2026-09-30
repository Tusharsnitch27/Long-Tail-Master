import "server-only";
import { cached } from "@/lib/cache";
import { addDays } from "@/lib/dates";
import { CATEGORIES } from "@/lib/categories";
import { getProductMap } from "./data/products";
import { getFreshness } from "./data/freshness";
import { getChannelSku } from "./data/channels";
import { getSkuFacts } from "./data/sku";

export interface ShowcaseItem { sku: string; name: string; image: string }

/**
 * Login-page showcase: the top 3 products per category by last-30-day gross sales (all channels), one colourway per
 * style, names and images only. Free gifts (under ₹10 a unit) never qualify. Cached for 6 hours and warmed at startup.
 */
export function getShowcase(): Promise<Record<string, ShowcaseItem[]>> {
  return cached("login:showcase", 6 * 3600, async () => {
    const { asOf } = await getFreshness();
    const range = { from: addDays(asOf, -29), to: asOf }, compare = { from: addDays(asOf, -59), to: addDays(asOf, -30) };
    const [pm, uc, st] = await Promise.all([
      getProductMap(),
      getChannelSku({ range, compare, asOf }),
      getSkuFacts({ range, compare, asOf, cats: CATEGORIES.map((c) => c.key), ch: "store" }),
    ]);
    const rev = new Map<string, { s: number; q: number }>();
    for (const r of uc) { const e = rev.get(r.sku) ?? { s: 0, q: 0 }; e.s += r.l30s; e.q += r.l30q; rev.set(r.sku, e); }
    for (const r of st) { const e = rev.get(r.sku) ?? { s: 0, q: 0 }; e.s += r.l30s; e.q += r.l30q; rev.set(r.sku, e); }
    const out: Record<string, ShowcaseItem[]> = {};
    const ranked = [...rev.entries()].filter(([, v]) => v.q > 0 && v.s / v.q >= 10).sort((a, b) => b[1].s - a[1].s);
    for (const [sku] of ranked) {
      const p = pm.get(sku);
      if (!p?.image || !p.name || !p.category) continue;
      const xs = (out[p.category] ??= []);
      if (xs.length < 3 && !xs.some((x) => x.sku.split("-")[0] === p.style)) xs.push({ sku, name: p.name, image: p.image });
    }
    return out;
  });
}
