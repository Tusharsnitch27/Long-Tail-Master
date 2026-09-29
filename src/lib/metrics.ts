export const safeDiv = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0 ? null : a / b;

export const growth = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur == null || prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev);

export type TargetStatus = "ahead" | "on_track" | "at_risk" | "behind" | "no_target";

export interface Thresholds { ahead: number; onTrack: number; atRisk: number }
export const DEFAULT_THRESHOLDS: Thresholds = { ahead: 1.05, onTrack: 0.95, atRisk: 0.8 };

export function targetStatus(actual: number, target: number | null | undefined, t: Thresholds): TargetStatus {
  if (!target || target <= 0) return "no_target";
  const a = actual / target;
  if (a >= t.ahead) return "ahead";
  if (a >= t.onTrack) return "on_track";
  if (a >= t.atRisk) return "at_risk";
  return "behind";
}

export const STATUS_META: Record<TargetStatus, { label: string; icon: string; cls: string }> = {
  ahead: { label: "Ahead", icon: "▲", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  on_track: { label: "On Track", icon: "●", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  at_risk: { label: "At Risk", icon: "◆", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  behind: { label: "Behind", icon: "▼", cls: "bg-rose-50 text-rose-800 ring-rose-200" },
  no_target: { label: "No Target", icon: "○", cls: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
};
