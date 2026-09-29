import type { Ctx } from "@/server/context";
import { dbConfigured } from "@/server/db";
import { getFacts } from "@/server/data/facts";
import { listOverrides, targetHistory } from "@/server/data/targets";
import { CATEGORIES } from "@/lib/categories";
import { addDays, addMonths, eachDay, endOfMonth, startOfMonth, startOfWeek } from "@/lib/dates";
import { Notice } from "@/components/ui";
import { TargetEditor, type EditorRow } from "@/components/TargetEditor";
import { ChannelTargetsForm } from "@/components/ChannelTargetsForm";
import { getChannelTargets } from "@/server/data/channelTargets";

export async function TargetsPanel({ ctx }: { ctx: Ctx }) {
  const sp = ctx.sp;
  const ms = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? `${sp.m}-01` : startOfMonth(ctx.asOf);
  const me = endOfMonth(ms);
  const cats = CATEGORIES.filter((c) => ctx.settings.enabledCategories.includes(c.key));
  const cat = cats.find((c) => c.key === sp.tc)?.key ?? cats[0].key;
  const grain = sp.g === "week" || sp.g === "day" ? sp.g : "month";
  const periods = grain === "month" ? [ms]
    : grain === "week" ? Array.from(new Set(eachDay(ms, me).map(startOfWeek)))
    : eachDay(ms, me);
  const ps = typeof sp.ps === "string" && periods.includes(sp.ps) ? sp.ps : grain === "day" ? (periods.includes(ctx.today) ? ctx.today : periods[0]) : periods[0];
  const pr = grain === "month" ? { from: ms, to: me } : grain === "week" ? { from: ps, to: addDays(ps, 6) } : { from: ps, to: ps };
  const [facts, overrides, history, chTargets] = await Promise.all([
    getFacts({ from: startOfMonth(pr.from), to: pr.to }, ctx.settings.enabledCategories),
    listOverrides(startOfMonth(pr.from), pr.to),
    targetHistory(150, { category: cat }),
    getChannelTargets(ms),
  ]);
  const rows: EditorRow[] = [];
  const inP = (d: string) => d >= pr.from && d <= pr.to;
  for (const s of ctx.stores) {
    const fs = facts.filter((f) => f.c === cat && f.b === s.branch_code && inP(f.d));
    const base = fs.reduce((a, f) => a + (f.st ?? 0), 0);
    const eff = fs.reduce((a, f) => a + (f.t ?? 0), 0);
    const actual = fs.filter((f) => f.d <= ctx.asOf).reduce((a, f) => a + f.s, 0);
    const o = overrides.find((x) => x.category === cat && x.branch_code === s.branch_code && x.grain === grain && x.period_start === ps);
    const recent = s.last_seen != null && s.last_seen >= addDays(ctx.asOf, -60);
    if (!recent && base === 0 && !o) continue;
    rows.push({ branch_code: s.branch_code, store: s.short_name, city: s.city, region: s.region, base, effective: eff, actual, override: o?.target ?? null, note: o?.note ?? null, updatedBy: o?.updated_by ?? null, updatedAt: o?.updated_at ?? null });
  }
  const catOverride = overrides.find((x) => x.category === cat && x.branch_code === "*" && x.period_start === ms) ?? null;
  const months = Array.from({ length: 6 }, (_, i) => addMonths(startOfMonth(ctx.asOf), 2 - i).slice(0, 7));

  return (
    <>
      <ChannelTargetsForm month={ms} cats={cats.map((c) => ({ key: c.key, label: c.label }))}
        initial={Object.fromEntries((["online", "marketplace"] as const).flatMap((ch) => cats.map((c) => [`${ch}|${c.key}`, chTargets.find((t) => t.channel === ch && t.category === c.key)?.target ?? null])))} />
            {!dbConfigured() && <Notice tone="warn">DATABASE_URL is not configured — targets are read-only (Snowflake base only) until PostgreSQL is connected.</Notice>}
      <Notice>
        <b>How targets resolve</b> (most specific wins): day override → week override → month override → Snowflake MTD_TARGET_* base. Week/month overrides are spread across days using the Snowflake daily
        phasing (so weekends keep their weight). A category-level month target scales all store targets in that category to the new total.
      </Notice>
      <TargetEditor
        rows={rows} month={ms.slice(0, 7)} months={months} cat={cat} cats={cats.map((c) => ({ key: c.key, label: c.label }))}
        grain={grain} periods={periods} period={ps} catOverride={catOverride ? { target: catOverride.target, note: catOverride.note } : null}
        history={history as never[]} readOnly={!dbConfigured()}
      />
    </>
  );
}
