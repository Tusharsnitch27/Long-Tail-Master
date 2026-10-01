import { MixBar } from "@/components/ui";

/** The three inventory phases as one hoverable bar: Stores · In transit · Warehouse. */
export const INV_COLORS = { store: "#6e4526", git: "#c08f60", wh: "#e2c9a6" } as const;
export function InvMix({ store, git, wh, title = "Inventory", className = "w-28" }: { store: number; git: number; wh: number; title?: string; className?: string }) {
  return <MixBar className={className} barClass="h-2.5" format="num" title={title}
    parts={[{ label: "Stores", value: Math.max(0, store), color: INV_COLORS.store }, { label: "In transit", value: Math.max(0, git), color: INV_COLORS.git }, { label: "Warehouse", value: Math.max(0, wh), color: INV_COLORS.wh }]} />;
}
