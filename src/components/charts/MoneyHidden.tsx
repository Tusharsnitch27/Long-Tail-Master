import { EyeOff } from "lucide-react";

/** Placeholder for a ₹ chart when the viewer's role has no revenue access. */
export function MoneyHidden({ height = 220, note }: { height?: number; note?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-paper/60 text-center text-[12px] text-zinc-500" style={{ height }}>
      <EyeOff className="size-4 text-zinc-400" />Revenue charts aren’t part of your access.{note && <span className="text-[11px] text-zinc-400">{note}</span>}
    </div>
  );
}
