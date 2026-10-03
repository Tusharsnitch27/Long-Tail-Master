import "server-only";
import { parseFilters, type Filters } from "@/lib/filters";
import { resolvePeriod, startOfMonth, minDate, maxDate, type Range, type Period } from "@/lib/dates";
import { getSettings, type AppSettings } from "./settings";
import { getFreshness } from "./data/freshness";
import { getStoreMap, type Store } from "./data/stores";
import { getFacts, type Fact } from "./data/facts";
import { filterFacts } from "./analytics";
import { cache } from "react";
import { getUser, type User } from "./auth";
import { accessFor, canOpen, type Access } from "@/lib/access";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { registerMoneyMask } from "@/lib/mask";

/** per-request money mask (React cache = one object per server render) */
const moneyFlag = cache(() => ({ on: false }));
registerMoneyMask(moneyFlag);
/** Apply the signed-in user's revenue access to everything formatted in this request. */
export function applyAccess(user: User | null): Access {
  const a = accessFor(user?.role ?? "viewer");
  moneyFlag().on = !a.revenue;
  return a;
}

export type SP = Record<string, string | string[] | undefined>;

export interface Ctx {
  sp: SP;
  qs: string;
  settings: AppSettings;
  asOf: string;
  today: string;
  filters: Filters;
  period: Period;
  stores: Store[];
  byCode: Map<string, Store>;
  byName: Map<string, Store>;
  user: User | null;
  /** what the signed-in user may see (revenue, GP, channels, downloads) */
  access: Access;
}

export async function pageContext(searchParams: Promise<SP>): Promise<Ctx> {
  const sp = await searchParams;
  // user lookup can fail outside a request (e.g. startup warm-up); pages are already gated by the layout
  const [settings, fresh, sm, user] = await Promise.all([getSettings(), getFreshness(), getStoreMap(), getUser().catch(() => null)]);
  const filters = parseFilters(sp, settings.enabledCategories);
  const period = resolvePeriod(filters.preset, fresh.asOf, fresh.today, { from: filters.from, to: filters.to });
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v == null ? [] : [[k, Array.isArray(v) ? v.join(",") : v]]))).toString();
  const access = applyAccess(user);
  // page access is enforced here too: the app shell hides a page, this stops it from rendering at all
  const path = (await headers()).get("x-pathname");
  if (user && path && !canOpen(user.role, path)) redirect(`/no-access?from=${encodeURIComponent(path)}`);
  return { sp, qs, settings, asOf: fresh.asOf, today: fresh.today, filters, period, ...sm, user, access };
}

/** Filtered facts covering the selected range, its comparison, the current month and any extra ranges. */
export async function loadFacts(ctx: Ctx, extra: Range[] = []): Promise<Fact[]> {
  const ranges = [ctx.period.range, ctx.period.compare, { from: startOfMonth(ctx.asOf), to: ctx.asOf }, ...extra];
  const from = ranges.map((r) => r.from).reduce(minDate);
  const to = ranges.map((r) => r.to).reduce(maxDate);
  const all = await getFacts({ from, to }, ctx.settings.enabledCategories);
  return filterFacts(all, ctx.filters, ctx.byCode);
}

export const withQs = (ctx: Ctx, path: string, extra: Record<string, string | null> = {}) => {
  const p = new URLSearchParams(ctx.qs);
  for (const [k, v] of Object.entries(extra)) (v == null ? p.delete(k) : p.set(k, v));
  const s = p.toString();
  return s ? `${path}?${s}` : path;
};
