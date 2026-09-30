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
 *  Footwear — the top shoe of each type (L1) · Fragrance — top 2 + the State of Mind gift set · Eyewear — top 3 ·
 *  Accessories — top 3 (socks separately, top 2) · Luggage — one each of Blink, Rubik and Vitto · Bags, Belts — top 2.
 * Cached for 6 hours and warmed at startup.
 */
export function getShowcase(): Promise<ShowcaseItem[]> {
  return cached("login:showcase:v2", 6 * 3600, async () => {
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

    const shoes: Product[] = [];
    for (const p of of("shoes")) if (p.l1 && !shoes.some((s) => s.l1 === p.l1)) shoes.push(p);
    const perfumes = pick(of("perfumes").filter((p) => !/gift|som\b/i.test(p.name!)), 2);
    const som = [...ranked, ...pm.values()].find((p) => p.category === "perfumes" && /state of mind|^som\b|som-gift/i.test(p.name ?? ""));
    const luggage = ["blink", "rubik", "vit+o"].map((k) => of("luggage").find((p) => new RegExp(k, "i").test(p.name!))).filter((p): p is Product => !!p);
    return [
      ...shoes.slice(0, 6).map((p) => item(p, "Footwear")),
      ...perfumes.map((p) => item(p, "Fragrance")),
      ...(som ? [{ sku: som.sku, name: "State of Mind", image: som.image, cat: "Fragrance · Gift set" }] : []),
      ...pick(of("sunglasses"), 3).map((p) => item(p, "Eyewear")),
      ...pick(of("accessories").filter((p) => !isSock(p)), 3).map((p) => item(p, "Accessories")),
      ...pick(of("accessories").filter(isSock), 2).map((p) => item(p, "Socks")),
      ...luggage.map((p) => item(p, "Luggage")),
      ...pick(of("bags"), 2).map((p) => item(p, "Bags")),
      ...pick(of("belts"), 2).map((p) => item(p, "Belts")),
    ];
  });
}
