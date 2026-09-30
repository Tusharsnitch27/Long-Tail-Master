// Ocean Teal theme. Channel colours are one teal scale; green / amber / red carry status meaning only.
export const CH_COLORS = { stores: "#0b5f6a", online: "#14a3ae", marketplace: "#8fd6da" } as const;
export const STATUS_COLORS = { good: "#15803d", ok: "#0e8a96", warn: "#d97706", bad: "#dc2626", muted: "#94a3b8" } as const;
/** Colour for an achievement ratio (1 = 100%) using the status thresholds. */
export const achColor = (a: number | null | undefined, th = { ahead: 1.05, onTrack: 0.95, atRisk: 0.8 }) =>
  a == null ? STATUS_COLORS.muted : a >= th.onTrack ? STATUS_COLORS.good : a >= th.atRisk ? STATUS_COLORS.warn : STATUS_COLORS.bad;
