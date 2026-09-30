/** VM revamp process definition — shared by the server (validation) and client forms. */
export const VM_STAGES = [
  { key: "shortlisted", label: "Shortlisted", hint: "Store picked as a candidate (data or field ask)" },
  { key: "approved", label: "Approved", hint: "Business case signed off, budget agreed" },
  { key: "design", label: "Design / planogram", hint: "Layout, fixture spec and planogram drafted" },
  { key: "fixtures", label: "Fixtures & stock", hint: "Fixtures ordered, launch stock allocated" },
  { key: "execution", label: "Execution", hint: "On-ground install and merchandising" },
  { key: "live", label: "Live", hint: "Revamp complete — performance clock starts" },
  { key: "review", label: "Review", hint: "28-day before / after read-out done" },
] as const;
export type VmStage = (typeof VM_STAGES)[number]["key"];

export const VM_STATUSES = [
  { key: "on_track", label: "On track", tone: "good" },
  { key: "at_risk", label: "At risk", tone: "warn" },
  { key: "blocked", label: "Blocked", tone: "bad" },
  { key: "on_hold", label: "On hold", tone: "muted" },
  { key: "done", label: "Done", tone: "info" },
  { key: "dropped", label: "Dropped", tone: "muted" },
] as const;
export type VmStatus = (typeof VM_STATUSES)[number]["key"];

export const stageIndex = (s: string) => Math.max(0, VM_STAGES.findIndex((x) => x.key === s));
export const stageLabel = (s: string) => VM_STAGES.find((x) => x.key === s)?.label ?? s;
/** Target go-live passed and not yet Live (ignores done / dropped). */
export const isOverdue = (r: { target_date: string | null; stage: string; status: string }, today: string) =>
  !!r.target_date && r.target_date < today && stageIndex(r.stage) < stageIndex("live") && !["done", "dropped"].includes(r.status);
export const statusMeta = (s: string) => VM_STATUSES.find((x) => x.key === s) ?? VM_STATUSES[0];

export const INWARD_STATUSES = ["planned", "confirmed", "in_transit", "received", "cancelled"] as const;
export type InwardStatus = (typeof INWARD_STATUSES)[number];
export const INWARD_STATUS_LABEL: Record<InwardStatus, string> = { planned: "Planned", confirmed: "PO confirmed", in_transit: "In transit", received: "Received", cancelled: "Cancelled" };
/** Statuses that still count as on-order for cover / OTB. */
export const OPEN_INWARD = new Set<string>(["planned", "confirmed", "in_transit"]);
