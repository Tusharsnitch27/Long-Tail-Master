import "server-only";
import { addDays, addMonths, dayOfWeek, eachDay, endOfMonth, minDate, startOfMonth } from "@/lib/dates";
import { getFacts } from "./data/facts";
import { getChannelDaily } from "./data/channels";
import { ucChannel, type ChKey } from "./channelData";
import { cached } from "@/lib/cache";

/**
 * Daily split model.
 *  - Past months: the ACTUAL daily shape of sales (gross, all long-tail categories) per channel.
 *  - Upcoming months: RECOMMENDED weight(day) = weekday index × day-of-month index × event uplift, where the weekday index
 *    comes from the last 12 weeks and the day-of-month index (salary credit in the first days, month-end dip…) from the
 *    last 6 complete months, both per channel. Event uplifts are stated assumptions, editable in the Control Centre.
 */
export const CHANNELS: ChKey[] = ["stores", "online", "marketplace"];

/** Festive / sale calendar FY 26-27 (India). Uplift per channel [stores, online, marketplace]; dates to verify each year. */
export const EVENTS: { from: string; to: string; name: string; up: [number, number, number] }[] = [
  { from: "2026-10-02", to: "2026-10-02", name: "Gandhi Jayanti (holiday)", up: [1.1, 1.0, 1.0] },
  { from: "2026-10-11", to: "2026-10-19", name: "Navratri", up: [1.08, 1.05, 1.05] },
  { from: "2026-10-20", to: "2026-10-20", name: "Dussehra", up: [1.2, 1.1, 1.1] },
  { from: "2026-11-01", to: "2026-11-05", name: "Pre-Diwali gifting", up: [1.15, 1.15, 1.15] },
  { from: "2026-11-06", to: "2026-11-07", name: "Dhanteras · Choti Diwali", up: [1.45, 1.25, 1.2] },
  { from: "2026-11-08", to: "2026-11-08", name: "Diwali (stores close early)", up: [0.7, 0.8, 0.9] },
  { from: "2026-11-10", to: "2026-11-11", name: "Bhai Dooj", up: [1.15, 1.05, 1.05] },
  { from: "2026-11-27", to: "2026-11-29", name: "Black Friday weekend", up: [1.05, 1.2, 1.2] },
  { from: "2026-12-24", to: "2026-12-25", name: "Christmas", up: [1.25, 1.1, 1.1] },
  { from: "2026-12-31", to: "2026-12-31", name: "New Year's Eve", up: [1.2, 1.05, 1.05] },
  { from: "2027-01-24", to: "2027-01-26", name: "Republic Day sales", up: [1.1, 1.2, 1.25] },
  { from: "2027-02-07", to: "2027-02-14", name: "Valentine's week", up: [1.15, 1.2, 1.15] },
  { from: "2027-03-21", to: "2027-03-21", name: "Day before Holi", up: [1.1, 1.05, 1.05] },
  { from: "2027-03-22", to: "2027-03-22", name: "Holi", up: [0.6, 0.9, 0.9] },
];
const BUCKETS = [[1, 3], [4, 7], [8, 14], [15, 21], [22, 25], [26, 31]] as const;
const bucketOf = (d: string) => BUCKETS.findIndex(([a, b]) => Number(d.slice(8)) >= a && Number(d.slice(8)) <= b);

/** Daily gross revenue per channel over a range, all long-tail categories. */
async function history(from: string, to: string, cats: string[]) {
  const [facts, uc] = await Promise.all([getFacts({ from, to }, cats), getChannelDaily({ from, to })]);
  const by: Record<ChKey, Map<string, number>> = { stores: new Map(), online: new Map(), marketplace: new Map() };
  for (const f of facts) if (f.d >= from && f.d <= to) by.stores.set(f.d, (by.stores.get(f.d) ?? 0) + f.s);
  const catSet = new Set(cats);
  for (const r of uc) { const k = ucChannel(r.mp); if (k && catSet.has(r.c) && r.d >= from && r.d <= to) by[k].set(r.d, (by[k].get(r.d) ?? 0) + r.revenue); }
  return by;
}

export interface SplitFactors { dow: Record<ChKey, number[]>; dom: Record<ChKey, number[]>; basis: { dow: string; dom: string } }

/** Weekday (last 12 weeks) and day-of-month (last 6 complete months) indices per channel; each averages to 1. */
export function splitFactors(asOf: string, cats: string[]): Promise<SplitFactors> {
  return cached(`splitfactors:${asOf}:${cats.join(",")}`, 3600, async () => {
    const domFrom = addMonths(startOfMonth(asOf), -6), domTo = addDays(startOfMonth(asOf), -1);
    const dowFrom = addDays(asOf, -83);
    const h = await history(minDate(domFrom, dowFrom), asOf, cats);
    const dow = {} as Record<ChKey, number[]>, dom = {} as Record<ChKey, number[]>;
    for (const k of CHANNELS) {
      const s = Array(7).fill(0), n = Array(7).fill(0);
      for (const d of eachDay(dowFrom, asOf)) { s[dayOfWeek(d)] += h[k].get(d) ?? 0; n[dayOfWeek(d)]++; }
      const avg = s.map((x, i) => x / Math.max(n[i], 1));
      const m = avg.reduce((a, x) => a + x, 0) / 7 || 1;
      dow[k] = avg.map((x) => (m ? x / m : 1));
      // day-of-month residual after removing the weekday effect, relative to each month's average day
      const bs = Array(BUCKETS.length).fill(0), bn = Array(BUCKETS.length).fill(0);
      for (let mo = domFrom; mo <= domTo; mo = addMonths(mo, 1)) {
        const days = eachDay(mo, endOfMonth(mo));
        const adj = days.map((d) => (h[k].get(d) ?? 0) / (dow[k][dayOfWeek(d)] || 1));
        const mean = adj.reduce((a, x) => a + x, 0) / days.length;
        if (!mean) continue;
        days.forEach((d, i) => { const b = bucketOf(d); bs[b] += adj[i] / mean; bn[b]++; });
      }
      const idx = bs.map((x, i) => (bn[i] ? x / bn[i] : 1));
      // shrink towards 1 (noise control) and cap
      dom[k] = idx.map((x) => Math.min(1.35, Math.max(0.75, 1 + (x - 1) * 0.7)));
    }
    return { dow, dom, basis: { dow: `${dowFrom} → ${asOf}`, dom: `${domFrom} → ${domTo}` } };
  });
}

export const eventsOn = (d: string) => EVENTS.filter((e) => d >= e.from && d <= e.to);

/** Recommended weights (sum to 100) for a month and channel. */
export function recommend(month: string, k: ChKey, f: SplitFactors) {
  const ci = CHANNELS.indexOf(k);
  const days = eachDay(startOfMonth(month), endOfMonth(month));
  const raw = days.map((d) => (f.dow[k][dayOfWeek(d)] || 1) * (f.dom[k][bucketOf(d)] || 1) * eventsOn(d).reduce((a, e) => a * e.up[ci], 1));
  const t = raw.reduce((a, x) => a + x, 0) || 1;
  return days.map((d, i) => ({ day: d, weight: Number(((100 * raw[i]) / t).toFixed(4)) }));
}

/** Actual daily shares for a past (or current) month; days after asOf are filled with the recommendation. */
export async function actualSplit(month: string, k: ChKey, asOf: string, cats: string[], f: SplitFactors) {
  const ms = startOfMonth(month), me = endOfMonth(month);
  const h = await history(ms, minDate(me, asOf), cats);
  const days = eachDay(ms, me);
  const rec = recommend(month, k, f);
  const done = days.filter((d) => d <= asOf);
  const actual = done.reduce((a, d) => a + (h[k].get(d) ?? 0), 0);
  if (!actual) return null;
  // scale the recommendation for the remaining days to the actual average day
  const recDone = rec.filter((r) => r.day <= asOf).reduce((a, r) => a + r.weight, 0) || 1;
  const perRec = actual / recDone;
  const raw = days.map((d, i) => (d <= asOf ? h[k].get(d) ?? 0 : rec[i].weight * perRec));
  const t = raw.reduce((a, x) => a + x, 0) || 1;
  return days.map((d, i) => ({ day: d, weight: Number(((100 * raw[i]) / t).toFixed(4)) }));
}
