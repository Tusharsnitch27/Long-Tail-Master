import "server-only";
import { cached } from "@/lib/cache";
import { catLabel } from "../views";
import { getProducts, type Product } from "../data/products";
import { CATEGORIES } from "@/lib/categories";
import type { Store } from "../data/stores";

/** Entity resolution: product names/SKUs and locations → governed ids, with explicit confidence. */

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["the", "a", "an", "of", "for", "men", "mens", "snitch", "product", "sku", "style", "our"]);
// Category words users add ("stryker shoe") — they narrow the category but aren't part of the name.
const CAT_WORDS: Record<string, string> = {
  shoe: "shoes", shoes: "shoes", sneaker: "shoes", sneakers: "shoes", footwear: "shoes", boots: "shoes", loafer: "shoes", loafers: "shoes",
  perfume: "perfumes", perfumes: "perfumes", fragrance: "perfumes", edp: "perfumes", scent: "perfumes",
  sunglass: "sunglasses", sunglasses: "sunglasses", shades: "sunglasses", belt: "belts", belts: "belts", bag: "bags", bags: "bags", backpack: "bags", backpacks: "bags",
  sandal: "shoes", sandals: "shoes", slides: "shoes", flipflops: "shoes", trolley: "luggage", trolleys: "luggage", suitcase: "luggage", luggage: "luggage",
  cap: "accessories", caps: "accessories", socks: "accessories", accessory: "accessories", accessories: "accessories",
};

/** Damerau-Levenshtein (optimal string alignment) distance. */
function dist(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
const tokenTol = (t: string) => (t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0);
/** Best fuzzy similarity of a query token against name tokens: 1 exact, 0.85 prefix, 0.7 within edit tolerance. */
function tokenScore(q: string, words: string[]) {
  let best = 0;
  for (const w of words) {
    if (w === q) return 1;
    if (q.length >= 3 && w.startsWith(q)) best = Math.max(best, 0.85);
    const tol = tokenTol(q);
    if (tol && Math.abs(w.length - q.length) <= tol && dist(q, w) <= tol) best = Math.max(best, 0.7);
  }
  return best;
}

interface Indexed { p: Product; name: string; words: string[]; style: string }

function index(): Promise<Indexed[]> {
  return cached("ai:productIndex", 1800, async () =>
    (await getProducts())
      // scope guard: only the tool's registered long-tail categories are resolvable
      .filter((p) => p.category && CATEGORIES.some((c) => c.key === p.category))
      .map((p) => {
        const name = norm(p.name ?? "");
        return { p, name, words: name.split(" ").filter((w) => w && !STOP.has(w)), style: p.sku.split("-")[0].toLowerCase() };
      }),
  );
}

export interface ProductMatch {
  family: string; // display name of the product family
  category: string;
  skus: { sku: string; name: string | null; colour: string | null; mrp: number | null; status: string | null }[];
  match: "sku" | "style_code" | "exact_name" | "phrase" | "all_tokens" | "fuzzy" | "partial";
  score: number;
}

export async function resolveProduct(query: string, category?: string | null) {
  const idx = await index();
  const q = norm(query);
  const rawTokens = q.split(" ").filter(Boolean);
  const impliedCat = rawTokens.map((t) => CAT_WORDS[t]).find(Boolean) ?? null;
  const cat = category ?? impliedCat;
  const tokens = rawTokens.filter((t) => !STOP.has(t) && !CAT_WORDS[t]);
  const pool = cat ? idx.filter((x) => x.p.category === cat) : idx;
  const scored: { x: Indexed; score: number; match: ProductMatch["match"] }[] = [];

  for (const x of pool) {
    const sku = x.p.sku.toLowerCase();
    if (rawTokens.includes(sku) || q === sku) { scored.push({ x, score: 1, match: "sku" }); continue; }
    if (tokens.includes(x.style)) { scored.push({ x, score: 0.98, match: "style_code" }); continue; }
    if (!tokens.length || !x.words.length) continue;
    const phrase = tokens.join(" ");
    if (x.name === phrase) { scored.push({ x, score: 0.97, match: "exact_name" }); continue; }
    if (` ${x.name} `.includes(` ${phrase} `)) { scored.push({ x, score: 0.9, match: "phrase" }); continue; }
    const per = tokens.map((t) => tokenScore(t, x.words));
    const matched = per.filter((s) => s > 0).length;
    if (matched === 0) continue;
    const avg = per.reduce((a, b) => a + b, 0) / tokens.length;
    if (matched === tokens.length) scored.push({ x, score: per.every((s) => s === 1) ? 0.88 : 0.55 + 0.3 * avg, match: per.every((s) => s === 1) ? "all_tokens" : "fuzzy" });
    else if (tokens.length > 1) scored.push({ x, score: 0.3 * (matched / tokens.length) * avg, match: "partial" });
  }
  scored.sort((a, b) => b.score - a.score);

  // Group into product families (same normalised name within a category), keep best score per family
  const fam = new Map<string, ProductMatch>();
  for (const s of scored.slice(0, 60)) {
    const key = `${s.x.p.category}|${s.x.name || s.x.style}`;
    let f = fam.get(key);
    if (!f) fam.set(key, (f = { family: s.x.p.name ?? s.x.p.sku, category: catLabel(s.x.p.category!), skus: [], match: s.match, score: s.score }));
    f.skus.push({ sku: s.x.p.sku, name: s.x.p.name, colour: s.x.p.colour, mrp: s.x.p.mrp, status: s.x.p.lifecycle ?? s.x.p.status });
  }
  const families = [...fam.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  const top = families[0];
  const confidence = !top ? "none" : top.score >= 0.85 ? "high" : top.score >= 0.6 ? "medium" : "low";
  // Ambiguous when another family scores close to the best one.
  const ambiguous = families.length > 1 && top != null && families[1].score >= top.score - 0.05 && confidence !== "none";
  // Nothing matched: offer nearby names as suggestions only (never treated as a match).
  let suggestions: { family: string; category: string; sku: string }[] = [];
  if (!families.length && tokens.length) {
    const near = new Map<string, { family: string; category: string; sku: string; d: number }>();
    for (const x of pool) {
      const d = Math.min(...tokens.flatMap((t) => x.words.filter((w) => w.length >= 3).map((w) => dist(t, w.slice(0, Math.max(t.length, 3)))) ));
      if (Number.isFinite(d) && d <= 2) {
        const k = x.name;
        if (!near.has(k) || near.get(k)!.d > d) near.set(k, { family: x.p.name ?? x.p.sku, category: catLabel(x.p.category!), sku: x.p.sku, d });
      }
    }
    suggestions = [...near.values()].sort((a, b) => a.d - b.d).slice(0, 4).map(({ d: _d, ...r }) => r);
  }
  return {
    query,
    category_filter: cat,
    suggestions,
    confidence,
    ambiguous,
    guidance:
      confidence === "none" ? "No product matches. Tell the user; do not substitute another product."
      : confidence === "low" ? "Only weak matches. Show the candidates and ask the user to confirm before reporting metrics."
      : ambiguous ? "Several products match similarly. Show the options (or aggregate only if the user clearly means all of them)."
      : confidence === "medium" ? "Probable typo match — state the corrected product name explicitly in the answer."
      : "Confident match.",
    matches: families,
  };
}

/** Locations: store names, cities, states, regions, area managers. */
export function resolveLocation(query: string, stores: Store[]) {
  const q = norm(query).replace(/\b(stores?|store|city|region|area)\b/g, "").trim();
  const alias: Record<string, string> = { bangalore: "bengaluru", blr: "bengaluru", bombay: "mumbai", gurgaon: "gurugram", delhi: "new delhi", ncr: "new delhi", calcutta: "kolkata", madras: "chennai", hyd: "hyderabad", vizag: "visakhapatnam", baroda: "vadodara" };
  const target = alias[q] ?? q;
  const out: { kind: "city" | "state" | "region" | "store" | "area_manager"; value: string; stores: { branch_code: string; store: string }[]; score: number }[] = [];
  const add = (kind: (typeof out)[number]["kind"], value: string, pick: (s: Store) => boolean, score: number) => {
    const ss = stores.filter(pick);
    if (ss.length) out.push({ kind, value, stores: ss.map((s) => ({ branch_code: s.branch_code, store: s.short_name })), score });
  };
  const dims: [typeof out[number]["kind"], keyof Store][] = [["city", "city"], ["state", "state"], ["region", "region"], ["area_manager", "am"]];
  for (const [kind, field] of dims) {
    const values = Array.from(new Set(stores.map((s) => String(s[field] ?? "")).filter(Boolean)));
    for (const v of values) {
      const nv = norm(v);
      const score = nv === target ? 1 : nv.startsWith(target) && target.length >= 3 ? 0.8 : target.length >= 4 && dist(nv, target) <= tokenTol(target) ? 0.7 : 0;
      if (score) add(kind, v, (s) => String(s[field] ?? "") === v, score);
    }
  }
  for (const s of stores) {
    const n = norm(s.short_name.replace(/^(coco|cofo|foco)\s*-\s*/i, ""));
    const score = n === target ? 0.95 : ` ${n} `.includes(` ${target} `) ? 0.85 : target.length >= 4 && n.split(" ").some((w) => w.length >= 4 && dist(w, target) <= tokenTol(target)) ? 0.6 : 0;
    if (score) out.push({ kind: "store", value: s.short_name, stores: [{ branch_code: s.branch_code, store: s.short_name }], score });
  }
  out.sort((a, b) => b.score - a.score);
  // an exact/strong hit makes weaker fuzzy hits noise (e.g. Bengaluru vs Mangaluru)
  const strong = out.length && out[0].score >= 0.95;
  const kept = strong ? out.filter((m) => m.score >= 0.8) : out;
  return { query, matches: kept.slice(0, 10), confidence: !kept.length ? "none" : kept[0].score >= 0.8 ? "high" : "medium" };
}
