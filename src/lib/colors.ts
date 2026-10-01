// Atelier theme. Channel colours are one bronze scale; green / amber / red carry status meaning only.
export const CH_COLORS = { stores: "#6e4526", online: "#c08f60", marketplace: "#e2c9a6" } as const;
export const STATUS_COLORS = { good: "#15803d", ok: "#a8703f", warn: "#d97706", bad: "#dc2626", muted: "#b8a894" } as const;
/** Colour for an achievement ratio (1 = 100%) using the status thresholds. */
export const achColor = (a: number | null | undefined, th = { ahead: 1.05, onTrack: 0.95, atRisk: 0.8 }) =>
  a == null ? STATUS_COLORS.muted : a >= th.onTrack ? STATUS_COLORS.good : a >= th.atRisk ? STATUS_COLORS.warn : STATUS_COLORS.bad;
