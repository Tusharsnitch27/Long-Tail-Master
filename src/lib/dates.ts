// All dates are ISO "YYYY-MM-DD" strings in IST business days.
export type ISODate = string;

const toUTC = (d: ISODate) => new Date(`${d}T00:00:00Z`);
const fromUTC = (d: Date): ISODate => d.toISOString().slice(0, 10);

export function istToday(): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
export const addDays = (d: ISODate, n: number) => { const x = toUTC(d); x.setUTCDate(x.getUTCDate() + n); return fromUTC(x); };
export const diffDays = (a: ISODate, b: ISODate) => Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86400000);
export const startOfMonth = (d: ISODate) => `${d.slice(0, 7)}-01`;
export const endOfMonth = (d: ISODate) => { const x = toUTC(startOfMonth(d)); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return fromUTC(x); };
export const addMonths = (d: ISODate, n: number) => { const x = toUTC(startOfMonth(d)); x.setUTCMonth(x.getUTCMonth() + n); return fromUTC(x); };
export const dayOfWeek = (d: ISODate) => (toUTC(d).getUTCDay() + 6) % 7; // Mon=0..Sun=6
export const startOfWeek = (d: ISODate) => addDays(d, -dayOfWeek(d));
export const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b);
export const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function monthsBetween(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export interface Range { from: ISODate; to: ISODate }
export const rangeDays = (r: Range) => diffDays(r.from, r.to) + 1;
export const inRange = (d: ISODate, r: Range) => d >= r.from && d <= r.to;

export type Preset = "today" | "yesterday" | "l7" | "cw" | "pw" | "l30" | "mtd" | "pm" | "custom";
export const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "l7", label: "Last 7 days" },
  { key: "cw", label: "Current week" },
  { key: "pw", label: "Previous week" },
  { key: "l30", label: "Last 30 days" },
  { key: "mtd", label: "MTD" },
  { key: "pm", label: "Previous month" },
  { key: "custom", label: "Custom" },
];

export interface Period {
  preset: Preset;
  range: Range;
  compare: Range;
  compareLabel: string;
  /** true when the range includes today (IST) — data is still arriving */
  partial: boolean;
  /** true when the comparison covers only part of its natural period */
  compareIsPartialPeriod: boolean;
}

/**
 * asOf = last complete business day (yesterday IST). "Today" is available but flagged partial.
 */
export function resolvePeriod(preset: Preset, asOf: ISODate, today: ISODate, custom?: Partial<Range>): Period {
  let range: Range;
  let compare: Range;
  let compareLabel = "vs previous period";
  let compareIsPartialPeriod = false;
  switch (preset) {
    case "today":
      range = { from: today, to: today };
      compare = { from: addDays(today, -7), to: addDays(today, -7) };
      compareLabel = "vs same day last week";
      break;
    case "yesterday":
      range = { from: asOf, to: asOf };
      compare = { from: addDays(asOf, -7), to: addDays(asOf, -7) };
      compareLabel = "vs same day last week";
      break;
    case "l7":
      range = { from: addDays(asOf, -6), to: asOf };
      compare = { from: addDays(asOf, -13), to: addDays(asOf, -7) };
      compareLabel = "vs prior 7 days";
      break;
    case "cw": {
      const ws = startOfWeek(asOf);
      range = { from: ws, to: asOf };
      compare = { from: addDays(ws, -7), to: addDays(asOf, -7) };
      compareLabel = "vs same days last week";
      compareIsPartialPeriod = asOf !== addDays(ws, 6);
      break;
    }
    case "pw": {
      const ws = addDays(startOfWeek(asOf), -7);
      range = { from: ws, to: addDays(ws, 6) };
      compare = { from: addDays(ws, -7), to: addDays(ws, -1) };
      compareLabel = "vs week before";
      break;
    }
    case "l30":
      range = { from: addDays(asOf, -29), to: asOf };
      compare = { from: addDays(asOf, -59), to: addDays(asOf, -30) };
      compareLabel = "vs prior 30 days";
      break;
    case "pm": {
      const pm = addMonths(asOf, -1);
      range = { from: pm, to: endOfMonth(pm) };
      const ppm = addMonths(asOf, -2);
      compare = { from: ppm, to: endOfMonth(ppm) };
      compareLabel = "vs month before (complete)";
      break;
    }
    case "custom": {
      const from = custom?.from && custom.from <= asOf ? custom.from : addDays(asOf, -6);
      const to = custom?.to && custom.to >= from ? minDate(custom.to, today) : asOf;
      range = { from, to };
      const n = rangeDays(range);
      compare = { from: addDays(from, -n), to: addDays(from, -1) };
      break;
    }
    case "mtd":
    default: {
      const ms = startOfMonth(asOf);
      range = { from: ms, to: asOf };
      const pm = addMonths(ms, -1);
      const day = Number(asOf.slice(8, 10));
      compare = { from: pm, to: minDate(addDays(pm, day - 1), endOfMonth(pm)) };
      compareLabel = `vs prev month 1–${day} (same-day)`;
      compareIsPartialPeriod = true;
      preset = "mtd";
    }
  }
  return { preset, range, compare, compareLabel, partial: range.to >= today, compareIsPartialPeriod };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(d: ISODate, withYear = false) {
  if (!d) return "—";
  const s = `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
  return withYear ? `${s} ${d.slice(0, 4)}` : s;
}
export function fmtRange(r: Range) {
  return r.from === r.to ? fmtDate(r.from, true) : `${fmtDate(r.from)} – ${fmtDate(r.to, true)}`;
}
export const weekday = (d: ISODate) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dayOfWeek(d)];
