import "server-only";
import { z } from "zod";
import { CATEGORIES } from "@/lib/categories";
import { startOfWeek } from "@/lib/dates";
import type { Store } from "./data/stores";
import type { OverrideInput } from "./data/targets";

const iso = /^\d{4}-\d{2}-\d{2}$/;
export const OverrideSchema = z.object({
  category: z.string().refine((c) => CATEGORIES.some((x) => x.key === c), "unknown category"),
  branch_code: z.string().min(1),
  grain: z.enum(["month", "week", "day"]),
  period_start: z.string().regex(iso, "period_start must be YYYY-MM-DD"),
  target: z.number().min(0).max(1e9).nullable(),
  note: z.string().max(500).nullish(),
});

/** Normalise + validate. Returns per-row errors (1-based row numbers). */
export function validateOverrides(raw: unknown[], byCode: Map<string, Store>, byName: Map<string, Store>) {
  const ok: OverrideInput[] = [];
  const errors: { row: number; message: string }[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const o = { ...(r as Record<string, unknown>) };
    // accept store names in place of branch codes
    if (typeof o.branch_code === "string" && !byCode.has(o.branch_code) && o.branch_code !== "*") {
      const s = byName.get(o.branch_code.toUpperCase()) ?? byName.get(`SNITCH - ${o.branch_code}`.toUpperCase());
      if (s) o.branch_code = s.branch_code;
    }
    const p = OverrideSchema.safeParse(o);
    if (!p.success) return errors.push({ row: i + 1, message: p.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
    const v = p.data;
    if (v.branch_code !== "*" && !byCode.has(v.branch_code)) return errors.push({ row: i + 1, message: `unknown store/branch "${v.branch_code}"` });
    if (v.branch_code === "*" && v.grain !== "month") return errors.push({ row: i + 1, message: "category-level ('*') targets must be monthly" });
    if (v.grain === "month" && !v.period_start.endsWith("-01")) return errors.push({ row: i + 1, message: "monthly period_start must be the 1st of the month" });
    if (v.grain === "week" && startOfWeek(v.period_start) !== v.period_start) return errors.push({ row: i + 1, message: "weekly period_start must be a Monday" });
    const key = `${v.category}|${v.branch_code}|${v.grain}|${v.period_start}`;
    if (seen.has(key)) return errors.push({ row: i + 1, message: "duplicate row for the same store/category/period" });
    seen.add(key);
    ok.push({ ...v, note: v.note ?? null });
  });
  return { ok, errors };
}
