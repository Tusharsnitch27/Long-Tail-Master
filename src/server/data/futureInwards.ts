import "server-only";
import { cached, invalidate } from "@/lib/cache";
import { dbConfigured, q, tx } from "../db";

/** Future inwards (Postgres future_inwards): planned new designs and repeat buys, entered or uploaded in the tool. */
export interface FutureInward {
  id: number; category: string; design: string; sku_group: string | null; kind: "new" | "repeat"; qty: number;
  expected_date: string | null; warehouse: string | null; status: string; note: string | null;
  created_by: string; created_at: string; updated_at: string;
}
export type InwardInput = Omit<FutureInward, "id" | "created_by" | "created_at" | "updated_at">;

export function listFutureInwards(): Promise<FutureInward[]> {
  if (!dbConfigured()) return Promise.resolve([]);
  return cached("finw:list", 30, () =>
    q<Record<string, unknown>>(
      `select id::int id, category, design, sku_group, kind, qty::int qty, to_char(expected_date,'YYYY-MM-DD') expected_date, warehouse, status, note,
              created_by, created_at::text created_at, updated_at::text updated_at
       from future_inwards order by expected_date nulls last, id`,
    ).then((r) => r as unknown as FutureInward[]).catch(() => []));
}

const log = (c: { query: (s: string, p: unknown[]) => Promise<unknown> }, actor: string, action: string, id: string | null, detail: unknown) =>
  c.query("insert into audit_log(actor, action, entity, entity_id, detail) values ($1,$2,'future_inwards',$3,$4)", [actor, action, id, JSON.stringify(detail)]);

export async function saveFutureInwards(rows: (InwardInput & { id?: number | null })[], actor: string, source: "manual" | "upload") {
  let created = 0, updated = 0;
  await tx(async (c) => {
    for (const r of rows) {
      const v = [r.category, r.design, r.sku_group?.toUpperCase() || null, r.kind, r.qty, r.expected_date || null, r.warehouse || null, r.status || "planned", r.note || null];
      if (r.id) {
        await c.query(`update future_inwards set category=$1, design=$2, sku_group=$3, kind=$4, qty=$5, expected_date=$6, warehouse=$7, status=$8, note=$9, updated_at=now() where id=$10`, [...v, r.id]);
        updated++;
      } else {
        await c.query(`insert into future_inwards(category, design, sku_group, kind, qty, expected_date, warehouse, status, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [...v, actor]);
        created++;
      }
    }
    await log(c, actor, source, rows.length === 1 && rows[0].id ? String(rows[0].id) : null, { created, updated, designs: rows.slice(0, 20).map((r) => r.design) });
  });
  invalidate("finw:");
  return { created, updated };
}

export async function deleteFutureInward(id: number, actor: string) {
  await tx(async (c) => {
    const r = await c.query("delete from future_inwards where id = $1 returning category, design, qty", [id]);
    await log(c, actor, "delete", String(id), r.rows[0] ?? null);
  });
  invalidate("finw:");
}
