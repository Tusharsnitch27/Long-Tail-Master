import "server-only";
import { cached, invalidate } from "@/lib/cache";
import { dbConfigured, q, tx } from "../db";
import { VM_STAGES, type VmStage, type VmStatus } from "@/components/wip/vmStages";
import { addDays, diffDays, minDate, type Range } from "@/lib/dates";
import { safeDiv } from "@/lib/metrics";
import { summarize } from "../analytics";
import { getFacts, type Fact } from "./facts";
import { getStoreCategoryMix, catKey } from "./inventory";
import type { Store } from "./stores";

/** VM revamps (Postgres vm_revamps): a store × category moving through the revamp process. */
export interface VmNote { at: string; by: string; text: string; kind?: "note" | "stage" | "status" | "created" }
export interface VmRevamp {
  id: number; branch_code: string; category: string; stage: VmStage; status: VmStatus;
  start_date: string | null; target_date: string | null; live_date: string | null; owner: string | null;
  notes: VmNote[]; created_by: string; created_at: string; updated_at: string;
}

const COLS = `id::int id, branch_code, category, stage, status, to_char(start_date,'YYYY-MM-DD') start_date, to_char(target_date,'YYYY-MM-DD') target_date,
  to_char(live_date,'YYYY-MM-DD') live_date, owner, notes, created_by, created_at::text created_at, updated_at::text updated_at`;

export function listRevamps(): Promise<VmRevamp[]> {
  if (!dbConfigured()) return Promise.resolve([]);
  return cached("vm:list", 30, () => q<Record<string, unknown>>(`select ${COLS} from vm_revamps order by updated_at desc`).then((r) => r as unknown as VmRevamp[]));
}

export async function getRevamp(id: number): Promise<VmRevamp | null> {
  if (!dbConfigured()) return null;
  const r = await q<Record<string, unknown>>(`select ${COLS} from vm_revamps where id = $1`, [id]);
  return (r[0] as unknown as VmRevamp) ?? null;
}

const log = (c: { query: (s: string, p: unknown[]) => Promise<unknown> }, actor: string, action: string, id: number | string, detail: unknown) =>
  c.query("insert into audit_log(actor, action, entity, entity_id, detail) values ($1,$2,'vm_revamps',$3,$4)", [actor, action, String(id), JSON.stringify(detail)]);

export async function createRevamp(r: { branch_code: string; category: string; owner?: string | null; target_date?: string | null; start_date?: string | null; stage?: VmStage; note?: string | null }, actor: string) {
  const now = new Date().toISOString();
  const notes: VmNote[] = [{ at: now, by: actor, text: r.note?.trim() || "Revamp created", kind: "created" }];
  const id = await tx(async (c) => {
    const res = await c.query(
      `insert into vm_revamps(branch_code, category, stage, status, start_date, target_date, owner, notes, created_by)
       values ($1,$2,$3,'on_track',coalesce($4::date, current_date),$5,$6,$7,$8) returning id::int id`,
      [r.branch_code, r.category, r.stage ?? "shortlisted", r.start_date ?? null, r.target_date ?? null, r.owner ?? null, JSON.stringify(notes), actor]);
    const newId = res.rows[0].id as number;
    await log(c, actor, "create", newId, r);
    return newId;
  });
  invalidate("vm:");
  return id;
}

export interface VmPatch { stage?: VmStage; status?: VmStatus; owner?: string | null; target_date?: string | null; live_date?: string | null; start_date?: string | null; note?: string | null }

/** Apply a patch; stage / status changes and free-text notes are appended to the note trail with author and time. */
export async function updateRevamp(id: number, p: VmPatch, actor: string) {
  await tx(async (c) => {
    const cur = (await c.query("select stage, status, live_date::text live_date from vm_revamps where id = $1 for update", [id])).rows[0];
    if (!cur) throw new Error("Revamp not found");
    const at = new Date().toISOString();
    const add: { at: string; by: string; text: string; kind: string }[] = [];
    const lbl = (s: string) => VM_STAGES.find((x) => x.key === s)?.label ?? s;
    if (p.stage && p.stage !== cur.stage) add.push({ at, by: actor, text: `Stage: ${lbl(cur.stage)} → ${lbl(p.stage)}`, kind: "stage" });
    if (p.status && p.status !== cur.status) add.push({ at, by: actor, text: `Status: ${cur.status.replace("_", " ")} → ${p.status.replace("_", " ")}`, kind: "status" });
    if (p.note?.trim()) add.push({ at, by: actor, text: p.note.trim(), kind: "note" });
    // reaching Live without a live date stamps today
    const live = p.live_date !== undefined ? p.live_date : p.stage && ["live", "review"].includes(p.stage) && !cur.live_date ? at.slice(0, 10) : undefined;
    const sets: string[] = ["updated_at = now()", "notes = notes || $2::jsonb"];
    const vals: unknown[] = [id, JSON.stringify(add)];
    const set = (col: string, v: unknown, cast = "") => { vals.push(v); sets.push(`${col} = $${vals.length}${cast}`); };
    if (p.stage) set("stage", p.stage);
    if (p.status) set("status", p.status);
    if (p.owner !== undefined) set("owner", p.owner);
    if (p.target_date !== undefined) set("target_date", p.target_date, "::date");
    if (p.start_date !== undefined) set("start_date", p.start_date, "::date");
    if (live !== undefined) set("live_date", live, "::date");
    await c.query(`update vm_revamps set ${sets.join(", ")} where id = $1`, vals);
    await log(c, actor, "update", id, { ...p, ...(live !== undefined ? { live_date: live } : {}) });
  });
  invalidate("vm:");
}

export async function deleteRevamp(id: number, actor: string) {
  await tx(async (c) => {
    const r = await c.query("delete from vm_revamps where id = $1 returning branch_code, category, stage", [id]);
    await log(c, actor, "delete", id, r.rows[0] ?? null);
  });
  invalidate("vm:");
}

/* ---------------- analytics: candidates and before / after performance */

const ACTIVE = (r: VmRevamp) => !["dropped"].includes(r.status) && r.stage !== "review";

export interface VmCandidate {
  b: string; store: string; city: string | null; c: string; storeUnits30: number; sizeRank: number; catUnits30: number; catInv: number;
  share: number; peerShare: number; salesPerDay: number; live: boolean; opportunity: number; reason: string;
}

/**
 * Suggested stores: top half of stores by total L30 units (all categories, apparel included = store size), where the
 * category is not live (no stock, no sales) or its share of the store's units is < 70% of the median share among stores
 * where it is live. Opportunity ≈ (median share × store units − category units) × category ASP, per month.
 */
export async function vmCandidates(facts: Fact[], cats: string[], asOf: string, byCode: Map<string, Store>, revamps: VmRevamp[]): Promise<VmCandidate[]> {
  const mix = await getStoreCategoryMix();
  const total = new Map<string, number>(), cat = new Map<string, { s30: number; inv: number }>();
  for (const r of mix.rows) {
    total.set(r.b, (total.get(r.b) ?? 0) + r.s30);
    const k = catKey(r.cat);
    if (!k) continue;
    const e = cat.get(`${r.b}|${k}`) ?? { s30: 0, inv: 0 };
    e.s30 += r.s30; e.inv += r.inv; cat.set(`${r.b}|${k}`, e);
  }
  const ranked = [...total.entries()].filter(([b, u]) => u > 0 && byCode.has(b)).sort((a, b) => b[1] - a[1]);
  const rank = new Map(ranked.map(([b], i) => [b, i + 1]));
  const strong = ranked.slice(0, Math.ceil(ranked.length / 2));
  const l28: Range = { from: addDays(asOf, -27), to: asOf };
  const busy = new Set(revamps.filter(ACTIVE).map((r) => `${r.branch_code}|${r.category}`));
  const out: VmCandidate[] = [];
  for (const c of cats) {
    const cf = facts.filter((f) => f.c === c);
    const m = summarize(cf, l28);
    const asp = safeDiv(m.sales, m.qty) ?? 0;
    const perStore = new Map<string, Fact[]>();
    for (const f of cf) { if (f.d < l28.from || f.d > l28.to) continue; const a = perStore.get(f.b) ?? []; a.push(f); perStore.set(f.b, a); }
    const shares = ranked.map(([b, u]) => ({ b, u, e: cat.get(`${b}|${c}`) })).filter((x) => x.e && (x.e.inv > 0 || x.e.s30 > 0)).map((x) => x.e!.s30 / x.u).sort((a, b) => a - b);
    const med = shares.length ? shares[shares.length >> 1] : 0;
    for (const [b, u] of strong) {
      if (busy.has(`${b}|${c}`)) continue;
      const e = cat.get(`${b}|${c}`) ?? { s30: 0, inv: 0 };
      const spd = (perStore.get(b) ?? []).reduce((a, f) => a + f.s, 0) / 28;
      const live = e.inv > 0 || e.s30 > 0 || spd > 0;
      const share = e.s30 / u;
      if (live && (med <= 0 || share >= med * 0.7)) continue;
      const opportunity = Math.max(0, med * u - e.s30) * asp;
      if (opportunity <= 0) continue;
      const st = byCode.get(b);
      out.push({
        b, store: st?.short_name ?? `Branch ${b}`, city: st?.city ?? null, c, storeUnits30: u, sizeRank: rank.get(b) ?? 0, catUnits30: e.s30, catInv: e.inv,
        share, peerShare: med, salesPerDay: spd, live, opportunity,
        reason: live ? `#${rank.get(b)} store by size; category share ${(share * 100).toFixed(1)}% vs ${(med * 100).toFixed(1)}% median` : `#${rank.get(b)} store by size; category not live`,
      });
    }
  }
  return out.sort((a, b) => b.opportunity - a.opportunity);
}

export interface VmPerf {
  id: number; live: string; afterDays: number; before: number; after: number; change: number | null;
  control: number | null; lift: number | null; incrementalPerDay: number | null; peers: number;
  series: { date: string; store: number; peer: number | null }[];
}

/**
 * 28 days before vs up to 28 days after the live date (the live day itself excluded), category sales / day (DSR gross sales for
 * Perfumes / Shoes, store SKU sales for the rest). Control = every other store selling the category in both windows
 * (stores with their own revamp in that category excluded). Lift = (1 + store change) ÷ (1 + control change) − 1.
 */
export async function vmPerformance(revamps: VmRevamp[], asOf: string, enabledCats: string[]): Promise<Map<number, VmPerf>> {
  const live = revamps.filter((r) => r.live_date && r.live_date < asOf);
  const out = new Map<number, VmPerf>();
  if (!live.length) return out;
  const from = addDays(live.map((r) => r.live_date!).sort()[0], -28);
  const facts = await getFacts({ from, to: asOf }, enabledCats);
  for (const r of live) {
    const L = r.live_date!;
    const before: Range = { from: addDays(L, -28), to: addDays(L, -1) };
    const after: Range = { from: addDays(L, 1), to: minDate(addDays(L, 28), asOf) };
    const afterDays = Math.max(0, diffDays(after.from, after.to) + 1);
    const cf = facts.filter((f) => f.c === r.category && f.d >= before.from && f.d <= after.to);
    const excluded = new Set(revamps.filter((x) => x.category === r.category).map((x) => x.branch_code));
    const sum = (b: (x: string) => boolean, rg: Range) => cf.reduce((a, f) => (b(f.b) && f.d >= rg.from && f.d <= rg.to ? a + f.s : a), 0);
    const mine = (x: string) => x === r.branch_code;
    const b0 = sum(mine, before) / 28, a0 = afterDays ? sum(mine, after) / afterDays : 0;
    const peerSet = new Set<string>();
    const pb = new Map<string, number>(), pa = new Map<string, number>();
    for (const f of cf) {
      if (excluded.has(f.b)) continue;
      if (f.d <= before.to) pb.set(f.b, (pb.get(f.b) ?? 0) + f.s); else if (f.d >= after.from) pa.set(f.b, (pa.get(f.b) ?? 0) + f.s);
    }
    for (const b of pb.keys()) if ((pb.get(b) ?? 0) > 0 && (pa.get(b) ?? 0) > 0) peerSet.add(b);
    const peerB = [...peerSet].reduce((a, b) => a + (pb.get(b) ?? 0), 0) / 28, peerA = afterDays ? [...peerSet].reduce((a, b) => a + (pa.get(b) ?? 0), 0) / afterDays : 0;
    const change = b0 > 0 && afterDays ? a0 / b0 - 1 : null;
    const control = peerB > 0 && afterDays ? peerA / peerB - 1 : null;
    const lift = change != null && control != null ? (1 + change) / (1 + control) - 1 : null;
    const days: string[] = []; for (let d = before.from; d <= after.to; d = addDays(d, 1)) days.push(d);
    const series = days.map((d) => {
      let s = 0, p = 0;
      for (const f of cf) if (f.d === d) { if (f.b === r.branch_code) s += f.s; else if (peerSet.has(f.b)) p += f.s; }
      return { date: d, store: s, peer: peerSet.size ? p / peerSet.size : null };
    });
    out.set(r.id, { id: r.id, live: L, afterDays, before: b0, after: a0, change, control, lift, incrementalPerDay: afterDays ? a0 - b0 * (1 + (control ?? 0)) : null, peers: peerSet.size, series });
  }
  return out;
}
