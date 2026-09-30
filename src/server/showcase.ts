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
 *  Footwear — hero boot + one small image per other shoe type · Fragrance — top perfume + 2 more + the State of Mind gift set ·
 *  bags, belts and socks together (a cap when socks have no image) · Luggage — Vitto and Rubik (beside the sign-in).
 * Cached for 6 hours and warmed at startup.
 */
export function getShowcase(): Promise<(ShowcaseItem & { role: string })[]> {
  return cached("login:showcase:v6", 6 * 3600, async () => {
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
    const T = (p: Product | undefined, cat: string, role: string) => (p ? [{ ...item(p, cat), role }] : []);
    const shoes = of("shoes");
    const hero = first(shoes, /boot|chelsea/i) ?? shoes[0];
    // one small image per other shoe type, in a fixed order
    const types: [RegExp, RegExp?][] = [[/sneaker/i, /mule/i], [/mule/i], [/loafer/i], [/sandal|\bslides\b/i, /mule|slide-easy/i], [/oxford|derby|formal/i]];
    const shoeSmall: Product[] = [];
    for (const [re, not] of types) { const p = shoes.find((x) => x !== hero && !shoeSmall.includes(x) && re.test(`${x.l1 ?? ""} ${x.l2 ?? ""} ${x.name}`) && !(not && not.test(`${x.l2 ?? ""} ${x.name}`))); if (p && shoeSmall.length < 4) shoeSmall.push(p); }
    const perfumes = pick(of("perfumes").filter((p) => !/gift|som\b/i.test(p.name!)), 3);
    const som = [...ranked, ...pm.values()].find((p) => p.category === "perfumes" && /state of mind|^som\b|som-gift/i.test(p.name ?? ""));
    const acc = withImg.filter((p) => p.category === "accessories");
    const sock = acc.find(isSock);
    const luggage = of("luggage");
    return [
      ...T(hero, "Footwear", "shoe-hero"), ...shoeSmall.flatMap((p) => T(p, "Footwear", "shoe")),
      ...T(perfumes[0], "Fragrance", "perfume-hero"), ...perfumes.slice(1, 3).flatMap((p) => T(p, "Fragrance", "perfume")),
      ...(som ? [{ sku: som.sku, name: "State of Mind", image: som.image, cat: "Fragrance", role: "perfume" }] : []),
      ...T(of("bags")[0], "Bags", "acc"), ...T(of("belts")[0], "Belts", "acc"), ...T(sock ?? first(acc, /cap/i), sock ? "Socks" : "Accessories", "acc"),
      ...T(first(luggage, /vit+o/i), "Luggage", "trolley"), ...T(first(luggage, /rubik/i), "Luggage", "trolley"),
    ];
  });
}
