import "server-only";
import { cached, invalidate } from "@/lib/cache";
import { dbConfigured, q } from "../db";

/**
 * Team remarks: context the team wants the tool (Action Centre + Mitra) to take into account.
 *  - kind "context": keep the item, show the note ("Team note: …"). A scope=date context remark marks an anomaly day
 *    (festival, Snitch birthday, sale) — excluded from week-on-week baselines where the engine can do so.
 *  - kind "not_applicable": suppress matching actions permanently (e.g. "this store has no perfumes" on store × category,
 *    which also makes the category NOT live in that store).
 *  - kind "snooze": hide matching actions until `until`.
 * Scope: action (scope_id = action key) · store (branch code) · store_category (branch code + category) · product (SKU) ·
 * category (category key) · date (day) · general.
 */
export type RemarkScope = "action" | "store" | "store_category" | "product" | "category" | "date" | "general";
export type RemarkKind = "context" | "not_applicable" | "snooze";
export const REMARK_SCOPES: RemarkScope[] = ["action", "store", "store_category", "product", "category", "date", "general"];
export const REMARK_KINDS: RemarkKind[] = ["context", "not_applicable", "snooze"];

export type Remark = {
  id: number;
  scope: RemarkScope;
  scope_id: string | null;
  category: string | null;
  kind: RemarkKind;
  until: string | null;
  day: string | null;
  text: string;
  action_key: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
};

export interface NewRemark {
  scope: RemarkScope;
  scope_id?: string | null;
  category?: string | null;
  kind: RemarkKind;
  until?: string | null;
  day?: string | null;
  text: string;
  action_key?: string | null;
}

const COLS = `id::int as id, scope, scope_id, category, kind, to_char(until,'YYYY-MM-DD') as "until", to_char(day,'YYYY-MM-DD') as "day", text, action_key, active, created_by, created_at::text as created_at`;

/** All active remarks (newest first). Snoozes past their date are still returned; use `effectiveRemarks` to drop them. */
export function listRemarks(): Promise<Remark[]> {
  if (!dbConfigured()) return Promise.resolve([]);
  return cached("remarks:active", 60, () =>
    q<Remark>(`select ${COLS} from remarks where active order by created_at desc limit 1000`).catch(() => [] as Remark[]));
}

/** Active remarks that still have an effect on `today` (expired snoozes dropped). */
export async function effectiveRemarks(today: string): Promise<Remark[]> {
  const rs = await listRemarks();
  return rs.filter((r) => r.kind !== "snooze" || (r.until != null && r.until >= today));
}

/** Recently deactivated remarks (for the audit view). */
export function listInactiveRemarks(limit = 30): Promise<Remark[]> {
  if (!dbConfigured()) return Promise.resolve([]);
  return cached("remarks:inactive", 60, () =>
    q<Remark>(`select ${COLS} from remarks where not active order by created_at desc limit $1`, [limit]).catch(() => [] as Remark[]));
}

export async function addRemark(r: NewRemark, actor: string): Promise<Remark> {
  const rows = await q<Remark>(
    `insert into remarks(scope, scope_id, category, kind, until, day, text, action_key, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${COLS}`,
    [r.scope, r.scope_id ?? null, r.category ?? null, r.kind, r.until ?? null, r.day ?? null, r.text.trim(), r.action_key ?? null, actor],
  );
  const row = rows[0];
  await q("insert into audit_log(actor, action, entity, entity_id, detail) values ($1,$2,$3,$4,$5)",
    [actor, "add", "remarks", String(row.id), JSON.stringify({ scope: row.scope, scope_id: row.scope_id, category: row.category, kind: row.kind, until: row.until, day: row.day, text: row.text, action_key: row.action_key })]).catch(() => {});
  bust();
  return row;
}

/** Deactivate (never hard-delete) a remark. Returns the remark, or null when it doesn't exist. */
export async function deactivateRemark(id: number, actor: string): Promise<Remark | null> {
  const rows = await q<Remark>(`update remarks set active = false where id = $1 returning ${COLS}`, [id]);
  if (!rows[0]) return null;
  await q("insert into audit_log(actor, action, entity, entity_id, detail) values ($1,$2,$3,$4,$5)",
    [actor, "deactivate", "remarks", String(id), JSON.stringify({ text: rows[0].text, scope: rows[0].scope, scope_id: rows[0].scope_id })]).catch(() => {});
  bust();
  return rows[0];
}

export async function getRemark(id: number): Promise<Remark | null> {
  if (!dbConfigured()) return null;
  const rows = await q<Remark>(`select ${COLS} from remarks where id = $1`, [id]);
  return rows[0] ?? null;
}

function bust() {
  invalidate("remarks:");
  // the action engine keys its cache on the remark signature, so no need to drop it — but pages built from it must refresh
}

/** Stable signature of the remarks that change action computation (cache key component). */
export const remarksSig = (rs: Remark[]) => {
  let h = 0;
  const s = rs.map((r) => `${r.id}:${r.until ?? ""}`).sort().join(",");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${rs.length}.${(h >>> 0).toString(36)}`;
};
