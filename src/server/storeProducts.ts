import "server-only";
import type { Ctx } from "./context";
import { getSkuFacts } from "./data/sku";
import { getStoreInventory } from "./data/inventory";
import { getProductMap, productL1, type Product } from "./data/products";
import { ATTR_LABEL } from "./data/metafields";
import { catLabel } from "./views";
import { addDays } from "@/lib/dates";
import { cached } from "@/lib/cache";
import { gitOrEmpty } from "./scope";

/** Metafields a store × product view can be cut by (value = what the product carries). */
export const META_KEYS: { key: string; label: string; get: (p: Product) => string | null }[] = [
  { key: "l1", label: "Type", get: (p) => productL1(p) },
  { key: "l2", label: "Sub-type", get: (p) => p.l2 },
  { key: "colour", label: "Colour", get: (p) => p.attrs.colour ?? p.colour },
  ...["occasion", "aesthetic", "closure", "upperMaterial", "soleType", "toeShape", "season", "material", "shape"].map((k) => ({ key: k, label: ATTR_LABEL[k] ?? k, get: (p: Product) => p.attrs[k] ?? null })),
];

export interface StoreSkuRow {
  id: string; b: string; store: string; city: string | null; state: string | null; format: string | null;
  sku: string; name: string; image: string | null; category: string; catName: string;
  l1: string | null; l2: string | null; colour: string | null;
  revenue: number; units: number; l7Units: number; l30Units: number; l30: number; stock: number; git: number; cover: number | null; share: number | null; last: string | null;
}
export interface MetaFilter { l1?: string | null; l2?: string | null; colour?: string | null }

const matches = (p: Product, f: MetaFilter) =>
  (!f.l1 || productL1(p) === f.l1) && (!f.l2 || p.l2 === f.l2) && (!f.colour || (p.attrs.colour ?? p.colour)?.toLowerCase() === f.colour.toLowerCase());

/**
 * Store × product facts for the selected period and categories: store sales lines (gross, period + L7 / L30) joined to
 * live store stock (latest store report). One row per store × SKU with sales in the period / L30 or stock on hand.
 */
export async function storeSkuRows(ctx: Ctx): Promise<StoreSkuRow[]> {
  const { range, compare } = ctx.period;
  const key = `storesku:v2:${ctx.asOf}:${range.from}:${range.to}:${ctx.filters.cats.join(",")}`;
  return cached(key, 600, async () => {
    const [facts, pm] = await Promise.all([getSkuFacts({ range, compare, asOf: ctx.asOf, cats: ctx.filters.cats, ch: "store" }), getProductMap()]);
    const [inv, git] = await Promise.all([getStoreInventory([...pm.keys()]).catch(() => []), gitOrEmpty(new Set(pm.keys()))]);
    const cats = new Set(ctx.filters.cats);
    const out = new Map<string, StoreSkuRow>();
    const row = (b: string, storeName: string, sku: string): StoreSkuRow | null => {
      const p = pm.get(sku);
      if (!p?.category || !cats.has(p.category)) return null;
      const id = `${b}|${sku}`;
      let r = out.get(id);
      if (!r) {
        const st = ctx.byCode.get(b);
        r = { id, b, store: st?.short_name ?? storeName, city: st?.city ?? null, state: st?.state ?? null, format: st?.location_type ?? null,
          sku, name: p.name ?? sku, image: p.image, category: p.category, catName: catLabel(p.category), l1: productL1(p), l2: p.l2, colour: p.attrs.colour ?? p.colour,
          revenue: 0, units: 0, l7Units: 0, l30Units: 0, l30: 0, stock: 0, git: 0, cover: null, share: null, last: null };
        out.set(id, r);
      }
      return r;
    };
    for (const f of facts) {
      const st = ctx.byName.get(f.ch.toUpperCase());
      const r = row(st?.branch_code ?? f.ch, f.ch.replace(/^SNITCH\s*-\s*/i, ""), f.sku);
      if (!r) continue;
      r.revenue += f.rs; r.units += f.rq; r.l7Units += f.l7q; r.l30Units += f.l30q; r.l30 += f.l30s;
      if (f.last && (!r.last || f.last > r.last)) r.last = f.last;
    }
    for (const s of inv) { const r = row(s.b, s.store, s.sku); if (r) r.stock += s.units; }
    for (const l of git.lines) { const r = row(l.b, l.store, l.sku); if (r) r.git += l.qty; }
    const storeRev = new Map<string, number>();
    for (const r of out.values()) storeRev.set(`${r.b}|${r.category}`, (storeRev.get(`${r.b}|${r.category}`) ?? 0) + r.revenue);
    const rows = [...out.values()].filter((r) => r.revenue > 0 || r.l30Units > 0 || r.stock > 0 || r.git > 0);
    for (const r of rows) {
      r.cover = r.l30Units > 0 ? (r.stock + r.git) / (r.l30Units / 30) : null;
      const t = storeRev.get(`${r.b}|${r.category}`) ?? 0;
      r.share = t > 0 ? r.revenue / t : null;
    }
    return rows.sort((a, b) => b.revenue - a.revenue);
  });
}

/** Per-store totals of the products matching a metafield filter (for the Stores table). */
export async function storeMetaTotals(ctx: Ctx, f: MetaFilter) {
  const [rows, pm] = await Promise.all([storeSkuRows(ctx), getProductMap()]);
  const m = new Map<string, { revenue: number; units: number; stock: number; git: number; l30Units: number; skus: number; storeRevenue: number }>();
  for (const r of rows) {
    const e = m.get(r.b) ?? { revenue: 0, units: 0, stock: 0, git: 0, l30Units: 0, skus: 0, storeRevenue: 0 };
    e.storeRevenue += r.revenue;
    const p = pm.get(r.sku);
    if (p && matches(p, f)) { e.revenue += r.revenue; e.units += r.units; e.stock += r.stock; e.git += r.git; e.l30Units += r.l30Units; if (r.revenue > 0 || r.stock > 0) e.skus++; }
    m.set(r.b, e);
  }
  return m;
}

/** Distinct metafield values present in the scope (for filter pickers), most common first. */
export async function metaOptions(ctx: Ctx) {
  const rows = await storeSkuRows(ctx);
  const pm = await getProductMap();
  const skus = new Set(rows.map((r) => r.sku));
  const res: Record<string, string[]> = {};
  for (const mk of META_KEYS) {
    const n = new Map<string, number>();
    for (const s of skus) { const v = pm.get(s) && mk.get(pm.get(s)!); if (v) n.set(v, (n.get(v) ?? 0) + 1); }
    res[mk.key] = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  }
  return res;
}

/** Store × metafield-value pivot: which values sell where (revenue / units in the period, stock now). */
export async function metaPivot(ctx: Ctx) {
  const [rows, pm] = await Promise.all([storeSkuRows(ctx), getProductMap()]);
  const keys = META_KEYS.filter((mk) => rows.some((r) => { const p = pm.get(r.sku); return p && mk.get(p); }));
  const stores = new Map<string, { b: string; store: string; city: string | null }>();
  const cells: Record<string, Record<string, Record<string, [number, number, number, number]>>> = {}; // attr → store → value → [rev, units, stock, in transit]
  for (const r of rows) {
    stores.set(r.b, { b: r.b, store: r.store, city: r.city });
    const p = pm.get(r.sku); if (!p) continue;
    for (const mk of keys) {
      const v = mk.get(p) ?? "Not set";
      const c = ((cells[mk.key] ??= {})[r.b] ??= {});
      const e = (c[v] ??= [0, 0, 0, 0]);
      e[0] += r.revenue; e[1] += r.units; e[2] += r.stock; e[3] += r.git;
    }
  }
  return { attrs: keys.map((k) => ({ key: k.key, label: k.label })), stores: [...stores.values()], cells, window: { from: ctx.period.range.from, to: ctx.period.range.to, l30From: addDays(ctx.asOf, -29) } };
}
