import { getProducts } from "@/server/data/products";
import { getWarehouseStock } from "@/server/data/warehouse";
import { getChannelDaily, getChannelSku, channelFreshness } from "@/server/data/channels";
import { pageContext } from "@/server/context";
import { buildActions } from "@/server/actions";

/** Dev-only: summaries of the Category Mitra data modules for validation. */
export async function GET(req: Request) {
  if (process.env.AUTH_MODE !== "dev" || process.env.NODE_ENV === "production") return new Response("not found", { status: 404 });
  const what = new URL(req.url).searchParams.get("what");
  const t0 = Date.now();
  if (what === "products") {
    const ps = await getProducts();
    const byCat: Record<string, { n: number; inBible: number; salesAll: number; returns: number; storeInv: number; whBible: number }> = {};
    for (const p of ps) {
      const k = p.category ?? "none"; const e = (byCat[k] ??= { n: 0, inBible: 0, salesAll: 0, returns: 0, storeInv: 0, whBible: 0 });
      e.n++; if (p.inBible) e.inBible++; e.salesAll += p.sales.all ?? 0; e.returns += p.returnsValue.all ?? 0; e.storeInv += p.invOffline ?? 0; e.whBible += p.invWarehouse ?? 0;
    }
    const sample = ps.filter((p) => p.sku === "SH0173-01" || p.sku === "4MSFR0916");
    return Response.json({ ms: Date.now() - t0, count: ps.length, byCat, sample });
  }
  if (what === "warehouse") {
    const ps = await getProducts();
    const { bySku, updated } = await getWarehouseStock(new Set(ps.map((p) => p.sku)));
    const unmatched = [...bySku.keys()].filter((k) => !ps.some((p) => p.sku === k));
    const byCat: Record<string, number> = {};
    for (const [k, v] of bySku) { const c = ps.find((p) => p.sku === k)?.category ?? "unmapped"; byCat[c] = (byCat[c] ?? 0) + v.units; }
    return Response.json({ ms: Date.now() - t0, updated, products: bySku.size, unmatched: unmatched.length, unmatchedSample: unmatched.slice(0, 8), byCat, chelsea: bySku.get("SH0173-01"), tonka: bySku.get("4MSFR0916") });
  }
  if (what === "channels") {
    const days = await getChannelDaily({ from: "2026-09-01", to: "2026-09-28" });
    const agg: Record<string, { revenue: number; items: number; orders: number }> = {};
    for (const d of days) { const k = `${d.c}|${d.mp}`; const e = (agg[k] ??= { revenue: 0, items: 0, orders: 0 }); e.revenue += d.revenue; e.items += d.items; e.orders += d.orders; }
    const sku = await getChannelSku({ range: { from: "2026-09-01", to: "2026-09-28" }, compare: { from: "2026-08-01", to: "2026-08-28" }, asOf: "2026-09-28" });
    return Response.json({ ms: Date.now() - t0, fresh: await channelFreshness(), agg, skuRows: sku.length, top: sku.sort((a, b) => b.rs - a.rs).slice(0, 3) });
  }
  if (what === "actions") {
    const ctx = await pageContext(Promise.resolve({}));
    const { actions, coverage } = await buildActions(ctx);
    const counts: Record<string, number> = {};
    for (const x of actions) { counts[`${x.group}:${x.type}:${x.priority}`] = (counts[`${x.group}:${x.type}:${x.priority}`] ?? 0) + 1; }
    return Response.json({ ms: Date.now() - t0, total: actions.length, coverage, counts, top: actions.slice(0, 12).map((x) => ({ p: x.priority, t: x.typeLabel, title: x.title, impact: x.impactLabel, reason: x.reason, rec: x.recommendation, ev: x.evidence.map((e) => `${e.label}: ${e.value}`).join(" | ") })) });
  }
  return Response.json({ error: "what=products|warehouse|channels|actions" }, { status: 400 });
}
