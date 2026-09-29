import "server-only";
import { addMonths, endOfMonth, minDate, startOfMonth } from "@/lib/dates";
import { getFacts } from "./data/facts";
import { filterFacts } from "./analytics";
import { listOverrides } from "./data/targets";
import type { Ctx } from "./context";

/** Month selected via ?m=YYYY-MM (defaults to the as-of month). */
export async function monthScope(ctx: Ctx) {
  const m = typeof ctx.sp.m === "string" && /^\d{4}-\d{2}$/.test(ctx.sp.m) ? `${ctx.sp.m}-01` : startOfMonth(ctx.asOf);
  const ms = m, me = endOfMonth(m);
  const cutoff = minDate(me, ctx.asOf);
  const hasActuals = cutoff >= ms;
  const [all, overrides] = await Promise.all([getFacts({ from: ms, to: me }, ctx.settings.enabledCategories), listOverrides(ms, me)]);
  const facts = filterFacts(all, ctx.filters, ctx.byCode);
  const months = Array.from({ length: 7 }, (_, i) => addMonths(startOfMonth(ctx.asOf), 1 - i)).map((x) => x.slice(0, 7));
  const ovr = overrides.filter((o) => o.period_start >= ms && o.period_start <= me && ctx.filters.cats.includes(o.category));
  return { ms, me, cutoff, hasActuals, facts, months, overrides: ovr, label: new Date(ms + "T00:00:00Z").toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) };
}
