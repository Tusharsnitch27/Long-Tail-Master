import "server-only";
import { cached, invalidate } from "@/lib/cache";
import { dbConfigured, q } from "../db";

export interface ChannelTarget { channel: "online" | "marketplace"; category: string; month: string; target: number; note: string | null; updated_by: string; updated_at: string }

export async function getChannelTargets(month: string): Promise<ChannelTarget[]> {
  if (!dbConfigured()) return [];
  return cached(`chtgt:${month}`, 60, () =>
    q<Record<string, unknown>>("select channel, category, to_char(month,'YYYY-MM-DD') month, target::float8 target, note, updated_by, updated_at::text from channel_targets where month = $1", [month])
      .then((r) => r as unknown as ChannelTarget[]).catch(() => []));
}

/** Month target for a channel over the categories in scope; null = not configured for every category (never partial-filled). */
export function channelMonthTarget(targets: ChannelTarget[], channel: "online" | "marketplace", cats: string[]): number | null {
  const all = targets.find((t) => t.channel === channel && t.category === "*");
  if (all && cats.length > 1) return all.target;
  const per = cats.map((c) => targets.find((t) => t.channel === channel && t.category === c)?.target);
  if (per.every((x) => x != null)) return per.reduce((a, x) => a + (x as number), 0);
  return all && cats.length === 1 ? null : null;
}

export async function saveChannelTargets(rows: { channel: string; category: string; month: string; target: number | null }[], actor: string) {
  for (const r of rows) {
    if (r.target == null) await q("delete from channel_targets where channel=$1 and category=$2 and month=$3", [r.channel, r.category, r.month]);
    else await q(`insert into channel_targets(channel, category, month, target, updated_by) values ($1,$2,$3,$4,$5)
                  on conflict (channel, category, month) do update set target = excluded.target, updated_by = excluded.updated_by, updated_at = now()`, [r.channel, r.category, r.month, r.target, actor]);
  }
  await q("insert into audit_log(actor, action, entity, detail) values ($1,'update','channel_targets',$2)", [actor, JSON.stringify(rows)]);
  invalidate("chtgt:");
}
