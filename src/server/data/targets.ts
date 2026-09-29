import "server-only";
import { randomUUID } from "node:crypto";
import { cached, invalidate } from "@/lib/cache";
import { dbConfigured, q, tx } from "../db";

export type Grain = "month" | "week" | "day";
export interface TargetOverride {
  id: number;
  category: string;
  branch_code: string; // '*' = category level
  grain: Grain;
  period_start: string;
  target: number;
  note: string | null;
  updated_by: string;
  updated_at: string;
}

export interface OverrideInput {
  category: string;
  branch_code: string;
  grain: Grain;
  period_start: string;
  target: number | null; // null = delete
  note?: string | null;
}

export async function listOverrides(from: string, to: string): Promise<TargetOverride[]> {
  if (!dbConfigured()) return [];
  return cached(`ovr:${from}:${to}`, 30, async () => {
    const rows = await q<Record<string, unknown>>(
      `select id, category, branch_code, grain, to_char(period_start, 'YYYY-MM-DD') period_start, target::float8 target, note, updated_by, updated_at::text
       from target_overrides where period_start between ($1::date - 40) and $2::date order by period_start, category, branch_code`,
      [from, to],
    );
    return rows as unknown as TargetOverride[];
  });
}

export async function targetHistory(limit = 200, filter?: { category?: string; branch_code?: string }) {
  if (!dbConfigured()) return [];
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter?.category) { params.push(filter.category); conds.push(`category = $${params.length}`); }
  if (filter?.branch_code) { params.push(filter.branch_code); conds.push(`branch_code = $${params.length}`); }
  params.push(limit);
  return q(
    `select id, category, branch_code, grain, to_char(period_start,'YYYY-MM-DD') period_start, old_target::float8 old_target, new_target::float8 new_target,
            action, note, batch_id, changed_by, changed_at::text
     from target_history ${conds.length ? "where " + conds.join(" and ") : ""} order by changed_at desc, id desc limit $${params.length}`,
    params,
  );
}

/** Upsert/delete overrides atomically; every change is written to target_history. */
export async function applyOverrides(inputs: OverrideInput[], actor: string, action: "manual" | "upload" = "manual") {
  const batch = action === "upload" ? randomUUID() : null;
  const res = await tx(async (c) => {
    let created = 0, updated = 0, deleted = 0, unchanged = 0;
    for (const i of inputs) {
      const cur = await c.query(
        "select id, target::float8 target from target_overrides where category=$1 and branch_code=$2 and grain=$3 and period_start=$4 for update",
        [i.category, i.branch_code, i.grain, i.period_start],
      );
      const old = cur.rows[0] as { id: number; target: number } | undefined;
      const hist = (id: number | null, oldT: number | null, newT: number | null, a: string) =>
        c.query(
          `insert into target_history(override_id, category, branch_code, grain, period_start, old_target, new_target, action, note, batch_id, changed_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id, i.category, i.branch_code, i.grain, i.period_start, oldT, newT, action === "upload" ? "upload" : a, i.note ?? null, batch, actor],
        );
      if (i.target == null) {
        if (old) { await c.query("delete from target_overrides where id=$1", [old.id]); await hist(old.id, old.target, null, "delete"); deleted++; }
        continue;
      }
      if (old) {
        if (Math.abs(old.target - i.target) < 0.005) { unchanged++; continue; }
        await c.query("update target_overrides set target=$1, note=coalesce($2, note), updated_by=$3, updated_at=now() where id=$4", [i.target, i.note ?? null, actor, old.id]);
        await hist(old.id, old.target, i.target, "update");
        updated++;
      } else {
        const ins = await c.query(
          `insert into target_overrides(category, branch_code, grain, period_start, target, note, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
          [i.category, i.branch_code, i.grain, i.period_start, i.target, i.note ?? null, actor],
        );
        await hist(ins.rows[0].id, null, i.target, "create");
        created++;
      }
    }
    await c.query("insert into audit_log(actor, action, entity, entity_id, detail) values ($1,$2,'targets',$3,$4)", [
      actor, action, batch, JSON.stringify({ created, updated, deleted, unchanged, rows: inputs.length }),
    ]);
    return { created, updated, deleted, unchanged, batch };
  });
  invalidate("ovr:");
  invalidate("facts:");
  return res;
}
