import "server-only";
import { cached } from "@/lib/cache";
import { addDays } from "@/lib/dates";
import { CATEGORIES } from "@/lib/categories";
import { getProductMap, type Product } from "./data/products";
import { getFreshness } from "./data/freshness";
import { getChannelSku } from "./data/channels";
import { getSkuFacts } from "./data/sku";

export interface ShowcaseItem { sku: string; name: string; image: string | null; cat: string }

/**
 * Login collage, ranked by last-30-day gross sales (all channels; free gifts never qualify):
 *  Footwear — top boots, sneakers and mules · Fragrance — top 2 + the State of Mind gift set ·
 *  one each of belts, bags, caps and another accessory · Luggage — the top trolley (beside the sign-in).
 * Cached for 6 hours and warmed at startup.
 */
export function getShowcase(): Promise<(ShowcaseItem & { role: string })[]> {
  return cached("login:showcase:v4", 6 * 3600, async () => {
    const { asOf } = await getFreshness();
    const range = { from: addDays(asOf, -29), to: asOf }, compare = { from: addDays(asOf, -59), to: addDays(asOf, -30) };
    const [pm, uc, st] = await Promise.all([
      getProductMap(),
      getChannelSku({ range, compare, asOf }),
      getSkuFacts({ range, compare, asOf, cats: CATEGORIES.map((c) => c.key), ch: "store" }),
    ]);
    const rev = new Map<string, { s: number; q: number }>();
    for (const r of [...uc, ...st]) { const e = rev.get(r.sku) ?? { s: 0, q: 0 }; e.s += r.l30s; e.q += r.l30q; rev.set(r.sku, e); }
    const ranked = [...rev.entries()].filter(([, v]) => v.q > 0 && v.s / v.q >= 10).sort((a, b) => b[1].s - a[1].s)
      .map(([sku]) => pm.get(sku)).filter((p): p is Product => !!p?.name && !!p.category);
    const withImg = ranked.filter((p) => p.image);
    const isSock = (p: Product) => p.sku.startsWith("4MSCK") || /sock/i.test(`${p.l1 ?? ""} ${p.name}`);
    const pick = (xs: Product[], n: number) => { const out: Product[] = []; for (const p of xs) if (out.length < n && !out.some((o) => o.style === p.style)) out.push(p); return out; };
    const of = (c: string) => withImg.filter((p) => p.category === c);
    const item = (p: Product, cat: string): ShowcaseItem => ({ sku: p.sku, name: p.name!, image: p.image, cat });

    const first = (xs: Product[], re: RegExp, not?: RegExp) => xs.find((p) => re.test(`${p.l1 ?? ""} ${p.l2 ?? ""} ${p.name}`) && !(not && not.test(`${p.l2 ?? ""} ${p.name}`)));
    const perfumes = pick(of("perfumes").filter((p) => !/gift|som\b/i.test(p.name!)), 2);
    const som = [...ranked, ...pm.values()].find((p) => p.category === "perfumes" && /state of mind|^som\b|som-gift/i.test(p.name ?? ""));
    const acc = of("accessories").filter((p) => !isSock(p));
    const tiles: (ShowcaseItem & { role: string })[] = [];
    const add = (p: Product | undefined, cat: string, role: string) => { if (p && !tiles.some((t) => t.sku === p.sku)) tiles.push({ ...item(p, cat), role }); };
    add(first(of("shoes"), /boot|chelsea/i), "Footwear", "big");
    add(perfumes[0], "Fragrance", "big");
    add(first(of("shoes"), /sneaker/i, /mule/i), "Footwear", "tile");
    add(first(of("shoes"), /mule/i), "Footwear", "tile");
    add(perfumes[1], "Fragrance", "tile");
    if (som) tiles.push({ sku: som.sku, name: "State of Mind", image: som.image, cat: "Fragrance", role: "tile" });
    add(of("belts")[0], "Belts", "tile");
    add(of("bags")[0], "Bags", "tile");
    add(first(acc, /cap/i), "Accessories", "tile");
    add(first(acc, /chain|bracelet|pendant|bandana|hat/i), "Accessories", "tile");
    add(of("luggage")[0], "Luggage", "side");
    return tiles;
  });
}
