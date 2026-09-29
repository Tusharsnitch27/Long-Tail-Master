import Papa from "papaparse";
import { requireUser } from "@/server/auth";
import { getFacts } from "@/server/data/facts";
import { getStoreMap } from "@/server/data/stores";
import { listOverrides } from "@/server/data/targets";
import { getSettings } from "@/server/settings";
import { endOfMonth } from "@/lib/dates";
import { apiError } from "@/server/api";

/** CSV template for a month: one row per store × category with the Snowflake base and current override. */
export async function GET(req: Request) {
  try {
    await requireUser("admin");
    const u = new URL(req.url);
    const m = /^\d{4}-\d{2}$/.test(u.searchParams.get("m") ?? "") ? `${u.searchParams.get("m")}-01` : null;
    if (!m) return new Response("m=YYYY-MM required", { status: 400 });
    const settings = await getSettings();
    const cats = (u.searchParams.get("cat") ?? "").split(",").filter((c) => settings.enabledCategories.includes(c));
    const useCats = cats.length ? cats : settings.enabledCategories;
    const [facts, { stores }, ovr] = await Promise.all([getFacts({ from: m, to: endOfMonth(m) }, settings.enabledCategories), getStoreMap(), listOverrides(m, endOfMonth(m))]);
    const rows = [];
    for (const c of useCats) {
      for (const s of stores) {
        const fs = facts.filter((f) => f.c === c && f.b === s.branch_code);
        const base = fs.reduce((a, f) => a + (f.st ?? 0), 0);
        const eff = fs.reduce((a, f) => a + (f.t ?? 0), 0);
        const o = ovr.find((x) => x.category === c && x.branch_code === s.branch_code && x.grain === "month" && x.period_start === m);
        if (base === 0 && !o && fs.every((f) => f.s === 0)) continue;
        rows.push({ category: c, branch_code: s.branch_code, store_name: s.store_name, grain: "month", period_start: m, snowflake_target: Math.round(base), current_effective: Math.round(eff), target: o ? o.target : "", note: o?.note ?? "" });
      }
    }
    const csv = Papa.unparse(rows);
    return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="targets-${m.slice(0, 7)}.csv"` } });
  } catch (e) {
    return apiError(e);
  }
}
