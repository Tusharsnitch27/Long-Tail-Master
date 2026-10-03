import "server-only";
import { moneyMasked } from "@/lib/mask";
import { growth, safeDiv } from "@/lib/metrics";
import { addDays, type Range } from "@/lib/dates";
import { catLabel } from "./views";
import type { Ctx } from "./context";
import type { Fact } from "./data/facts";
import type { ChannelDay } from "./data/channels";
import { channelMetrics, marketplaceBreakdown, CH_LABEL, type ChKey } from "./channelData";
import { storeRows, summarize, monthOutlook, groupFacts } from "./analytics";
import type { Action } from "./actions";
import type { Plan, PlanChannel } from "./plan";

/** Every line is computed from data — no generic commentary. */
export interface Insight { tone: "positive" | "negative" | "neutral"; text: string; href?: string; value?: number }
const inrRaw = (v: number) => { const a = Math.abs(v); const s = a >= 1e7 ? `₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹${(a / 1e5).toFixed(1)} L` : a >= 1e3 ? `₹${(a / 1e3).toFixed(1)}K` : `₹${Math.round(a)}`; return v < 0 ? `-${s}` : s; };
const inr = (v: number) => (moneyMasked() ? "₹ —" : inrRaw(v)); // hidden for roles without revenue access
const pc = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const sp = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

export function drivers(ctx: Ctx, facts: Fact[], uc: ChannelDay[], range: Range, compare: Range, channel: PlanChannel): Insight[] {
  const out: Insight[] = [];
  const chans: ChKey[] = channel === "all" ? ["stores", "online", "marketplace"] : [channel];
  // channel contribution to the change
  if (chans.length > 1) for (const k of chans) {
    const c = channelMetrics(facts, uc, range, k).revenue, p = channelMetrics(facts, uc, compare, k).revenue, d = c - p;
    if (Math.abs(d) > 0) out.push({ tone: d >= 0 ? "positive" : "negative", text: `${CH_LABEL[k]} ${d >= 0 ? "contributed +" : "declined "}${inr(Math.abs(d))} (${sp(growth(c, p))}) ${ctx.period.compareLabel}.`, value: Math.abs(d), href: k === "stores" ? "/stores" : `/${k === "online" ? "online" : "marketplace"}` });
  }
  // category movement
  for (const c of ctx.filters.cats) {
    const f = facts.filter((x) => x.c === c), u = uc.filter((x) => x.c === c);
    const cur = chans.reduce((a, k) => a + channelMetrics(f, u, range, k).revenue, 0), prev = chans.reduce((a, k) => a + channelMetrics(f, u, compare, k).revenue, 0);
    const g = growth(cur, prev);
    if (g != null && Math.abs(g) >= 0.05) out.push({ tone: g >= 0 ? "positive" : "negative", text: `${catLabel(c)} ${g >= 0 ? "grew" : "fell"} ${pc(Math.abs(g), 1)} (${inr(cur - prev)}).`, value: Math.abs(cur - prev), href: `/category?cat=${c}` });
  }
  // marketplace concentration of change
  if (chans.includes("marketplace")) {
    const bd = marketplaceBreakdown(uc, range, compare);
    const drop = bd.reduce((a, r) => a + Math.min(0, r.revenue - r.prev), 0);
    const worst = [...bd].sort((a, b) => (a.revenue - a.prev) - (b.revenue - b.prev))[0];
    if (drop < 0 && worst && worst.revenue - worst.prev < 0) out.push({ tone: "negative", text: `${worst.mp} accounts for ${pc((worst.revenue - worst.prev) / drop)} of the marketplace decline (${inr(worst.revenue - worst.prev)}).`, value: Math.abs(worst.revenue - worst.prev), href: `/marketplace?mp=${worst.mp}` });
  }
  // store target-gap concentration (month to date)
  if (chans.includes("stores")) {
    const ms = { from: ctx.asOf.slice(0, 8) + "01", to: ctx.asOf };
    const gaps = [...groupFacts(facts, (f) => f.b)].map(([b, fs]) => { const m = summarize(fs, ms); return { b, gap: Math.max((m.target ?? 0) - m.sales, 0) }; }).sort((a, b) => b.gap - a.gap);
    const total = gaps.reduce((a, g) => a + g.gap, 0);
    let acc = 0, n = 0; for (const g of gaps) { if (acc >= total * 0.5) break; acc += g.gap; n++; }
    if (total > 0 && n > 0) out.push({ tone: "negative", text: `${n} stores account for ${pc(acc / total)} of the ${inr(total)} MTD store target gap.`, value: acc, href: "/stores?tab=stores" });
  }
  return out.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 5);
}

export function risks(ctx: Ctx, plan: Plan, facts: Fact[], uc: ChannelDay[], range: Range, actions: Action[]): Insight[] {
  const out: Insight[] = [];
  const th = ctx.settings.thresholds;
  if (plan.projectedAch != null && plan.projectedAch < th.onTrack) out.push({ tone: "negative", text: `Target risk — projected achievement is ${pc(plan.projectedAch)} (projected gap ${inr(plan.projectedGap ?? 0)}).`, href: "/stores" });
  const fast = actions.filter((a) => a.type === "fast_low_doi");
  const urgentFast = fast.filter((a) => a.priority === "urgent");
  if (fast.length) out.push({ tone: "negative", text: `Inventory risk — ${fast.length} fast-selling product${fast.length > 1 ? "s have" : " has"} under 14 days of cover${urgentFast.length ? ` (${urgentFast.length} under 7 days)` : ""}.`, href: "/merchandising" });
  const drops = actions.filter((a) => a.type === "channel_decline").sort((a, b) => b.impact - a.impact);
  if (drops[0]) out.push({ tone: "negative", text: `Channel risk — ${drops[0].title.replace(" WoW", "")} week on week (${drops[0].impactLabel}).`, href: "/channels" });
  const rows = storeRows(facts, range, range, ctx.byCode, th, ctx.filters.cats);
  const tot = rows.reduce((a, r) => a + r.sales, 0);
  const top10 = safeDiv(rows.slice(0, 10).reduce((a, r) => a + r.sales, 0), tot);
  if (top10 != null && top10 >= 0.4 && rows.length > 20) out.push({ tone: "neutral", text: `Concentration — top 10 stores contribute ${pc(top10)} of store sales.`, href: "/stores" });
  const ret = actions.filter((a) => a.type === "return_risk");
  if (ret.length >= 3) out.push({ tone: "negative", text: `Return risk — ${ret.length} products have channel return % well above their category average (lifetime).`, href: "/actions?group=channel&type=Return%20risk" });
  return out.slice(0, 5);
}

export function opportunities(actions: Action[], warehouseFastUnits: number): Insight[] {
  const out: Insight[] = [];
  const alloc = actions.filter((a) => a.type === "allocation");
  if (alloc.length) out.push({ tone: "positive", text: `≈${inr(alloc.reduce((a, x) => a + x.impact, 0))} potential sales from ${alloc.length} fast-selling, low-stock store × product pairs with warehouse stock (estimate, not guaranteed).`, href: "/merchandising" });
  const dist = actions.filter((a) => a.type === "distribution" || a.type === "missed_distribution");
  if (dist.length) out.push({ tone: "positive", text: `${dist.length} distribution opportunities — products selling strongly where listed but stocked in few relevant stores (≈${inr(dist.reduce((a, x) => a + x.impact, 0))}/month, estimate).`, href: "/merchandising" });
  if (warehouseFastUnits > 0) out.push({ tone: "positive", text: `Warehouse holds ${Math.round(warehouseFastUnits).toLocaleString("en-IN")} units of fast-moving products available for redistribution.`, href: "/merchandising" });
  const rec = actions.filter((a) => a.type === "target_recovery");
  if (rec.length) out.push({ tone: "positive", text: `${rec.length} stores behind target have recently run at the daily rate they now need — recoverable with focus (${inr(rec.reduce((a, x) => a + x.impact, 0))} gap).`, href: "/actions?group=store" });
  const gap = actions.filter((a) => a.type === "category_gap");
  if (gap.length) out.push({ tone: "positive", text: `${gap.length} stores are strong in one category but far below peers in another (≈${inr(gap.reduce((a, x) => a + x.impact, 0))}/month to median).`, href: "/actions?group=store&type=Category%20gap" });
  return out.slice(0, 4);
}

/** Up to five leadership actions, each linked to the detailed view. */
export function leadershipActions(plan: Plan, actions: Action[]): Insight[] {
  const out: Insight[] = [];
  if (plan.projectedGap != null && plan.projectedGap > 0) out.push({ tone: "negative", text: `Close the ${inr(plan.projectedGap)} projected month-end target gap — needs ${inr(plan.requiredRunRate ?? 0)}/day vs ${inr(plan.currentRunRate)}/day now.`, href: "/stores" });
  const allocBy = new Map<string, { name: string; n: number; sku: string }>();
  for (const a of actions.filter((x) => x.type === "allocation" && x.product)) { const e = allocBy.get(a.product!.sku) ?? { name: a.product!.name ?? a.product!.sku, n: 0, sku: a.product!.sku }; e.n++; allocBy.set(a.product!.sku, e); }
  const topAlloc = [...allocBy.values()].sort((a, b) => b.n - a.n)[0];
  if (topAlloc) out.push({ tone: "neutral", text: `Reallocate ${topAlloc.name} to ${topAlloc.n} fast-selling store${topAlloc.n > 1 ? "s" : ""} with low stock.`, href: `/products/${encodeURIComponent(topAlloc.sku)}` });
  const drop = actions.filter((a) => a.type === "channel_decline").sort((a, b) => b.impact - a.impact)[0];
  if (drop) out.push({ tone: "negative", text: `Review ${drop.title.split(" sales")[0]} decline — ${drop.impactLabel}.`, href: drop.links[0]?.href });
  const dist = actions.filter((a) => a.type === "distribution" || a.type === "missed_distribution").sort((a, b) => b.impact - a.impact)[0];
  if (dist) out.push({ tone: "neutral", text: `Extend distribution: ${dist.title}.`, href: "/merchandising" });
  const ret = actions.filter((a) => a.type === "return_risk");
  if (ret.length) out.push({ tone: "neutral", text: `Review ${ret.length} high-return product${ret.length > 1 ? "s" : ""} on Online / Marketplace.`, href: "/actions?group=channel&type=Return%20risk" });
  const slow = actions.filter((a) => a.type === "slow_moving");
  if (out.length < 5 && slow.length) out.push({ tone: "neutral", text: `Act on ${slow.length} slow-moving products (≈${inr(slow.reduce((a, x) => a + x.impact, 0))} of stock at 50% of MRP).`, href: "/merchandising" });
  return out.slice(0, 5);
}

/** Warehouse units of products selling ≥1/day (L7) — available for redistribution. */
export function fastWarehouseUnits(actionsCtxVelocity: Map<string, number>, wh: (s: string) => number) {
  let u = 0; for (const [sku, perDay] of actionsCtxVelocity) if (perDay >= 1) u += wh(sku); return u;
}
export { monthOutlook, addDays };
