import { moneyMasked, MASK } from "./mask";
// Indian number formatting: ₹ with K / L / Cr.
export function inr(v: number | null | undefined, opts: { compact?: boolean; decimals?: number } = {}) {
  if (v == null || !Number.isFinite(v) || moneyMasked()) return MASK; // ₹ hidden for roles without revenue access
  const { compact = true } = opts;
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (!compact || a < 1000) return `${sign}₹${Math.round(a).toLocaleString("en-IN")}`;
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(opts.decimals ?? 2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(opts.decimals ?? 2)} L`;
  return `${sign}₹${(a / 1e3).toFixed(opts.decimals ?? 1)}K`;
}
export function num(v: number | null | undefined, decimals = 0) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}
export function compactNum(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return num(v);
}
export function pct(v: number | null | undefined, decimals = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}
export function signedPct(v: number | null | undefined, decimals = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`;
}
export const shortStore = (name: string) => (name ?? "").replace(/^SNITCH\s*-\s*/i, "");
