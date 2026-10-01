/** Rule filters for DataTable: column · operator · value, e.g. "Total stock > 100", "# stores ≤ 10", "Colour contains black". */
export type NumOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "empty" | "notempty";
export type TextOp = "contains" | "ncontains" | "is" | "isnot" | "empty" | "notempty";
export type Op = NumOp | TextOp;
export interface Rule { key: string; op: Op; value: string }

export const NUM_OPS: { op: NumOp; label: string }[] = [
  { op: "gt", label: ">" }, { op: "gte", label: "≥" }, { op: "lt", label: "<" }, { op: "lte", label: "≤" }, { op: "eq", label: "=" }, { op: "neq", label: "≠" },
  { op: "between", label: "between" }, { op: "empty", label: "is empty" }, { op: "notempty", label: "has a value" },
];
export const TEXT_OPS: { op: TextOp; label: string }[] = [
  { op: "contains", label: "contains" }, { op: "ncontains", label: "doesn't contain" }, { op: "is", label: "is" }, { op: "isnot", label: "is not" },
  { op: "empty", label: "is empty" }, { op: "notempty", label: "has a value" },
];
export const needsValue = (op: Op) => op !== "empty" && op !== "notempty";

/** "1.5L" → 150000, "2cr" → 2e7, "10k" → 10000, "12%" → 0.12 (when the column is a ratio). */
export function parseNum(s: string, ratio: boolean): number | null {
  const m = s.trim().toLowerCase().replace(/[₹,\s]/g, "").match(/^(-?\d*\.?\d+)(k|l|lakh|lakhs|cr|crore|%)?$/);
  if (!m) return null;
  let v = Number(m[1]);
  const u = m[2];
  if (u === "k") v *= 1e3; else if (u && u.startsWith("l")) v *= 1e5; else if (u && u.startsWith("cr")) v *= 1e7;
  if (ratio) v = v / 100; // ratio columns are typed as percentages
  return Number.isFinite(v) ? v : null;
}

export function passRule(v: unknown, r: Rule, numeric: boolean, ratio: boolean): boolean {
  const isEmpty = v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));
  if (r.op === "empty") return isEmpty;
  if (r.op === "notempty") return !isEmpty;
  if (!r.value.trim()) return true; // incomplete rule = no filter yet
  if (numeric) {
    if (isEmpty) return false;
    const n = Number(v);
    if (r.op === "between") {
      const [a, b] = r.value.split(/\s*(?:-|to|and|…|\.\.)\s*/).map((x) => parseNum(x, ratio));
      return a == null || b == null ? true : n >= Math.min(a, b) && n <= Math.max(a, b);
    }
    const x = parseNum(r.value, ratio);
    if (x == null) return true;
    switch (r.op) { case "gt": return n > x; case "gte": return n >= x; case "lt": return n < x; case "lte": return n <= x; case "eq": return Math.abs(n - x) < 1e-9; case "neq": return Math.abs(n - x) >= 1e-9; default: return true; }
  }
  const s = String(v ?? "").toLowerCase(), t = r.value.trim().toLowerCase();
  switch (r.op) { case "contains": return s.includes(t); case "ncontains": return !s.includes(t); case "is": return s === t; case "isnot": return s !== t; default: return true; }
}

export const encodeRules = (rs: Rule[]) => rs.filter((r) => r.key).map((r) => [r.key, r.op, r.value].map(encodeURIComponent).join("~")).join("|");
export const decodeRules = (s: string | null): Rule[] =>
  (s ?? "").split("|").filter(Boolean).map((x) => { const [key, op, value = ""] = x.split("~").map(decodeURIComponent); return { key, op: op as Op, value }; }).filter((r) => r.key && r.op);
