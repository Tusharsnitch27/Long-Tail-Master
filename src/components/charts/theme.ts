/** Shared Recharts styling for the Atelier theme. */
export const TOOLTIP = {
  contentStyle: { fontSize: 12, borderRadius: 12, border: "1px solid rgba(211,176,137,.35)", background: "linear-gradient(180deg, rgba(43,35,28,.97), rgba(27,23,18,.97))", color: "#f3ebe1", boxShadow: "0 18px 40px -16px rgba(60,40,20,.7)", padding: "8px 10px" },
  labelStyle: { color: "#e2c9a6", fontWeight: 600, marginBottom: 4, letterSpacing: ".02em" },
  itemStyle: { color: "#f3ebe1", padding: "1px 0" },
} as const;
export const CURSOR = { fill: "rgba(168,112,63,0.08)" } as const;
export const GRID = "#ece2d4";
/** id-safe gradient name */
export const gid = (prefix: string, key: string) => `${prefix}-${key}`.replace(/[^a-zA-Z0-9_-]/g, "");
