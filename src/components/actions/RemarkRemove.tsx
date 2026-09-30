"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";

/** Deactivate a team remark (author or admin). */
export function RemarkRemove({ id, label = "Remove", confirmText }: { id: number; label?: string; confirmText?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setErr(null);
    const res = await fetch(`/api/remarks?id=${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return; }
    router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={go} disabled={busy} className="flex items-center gap-1 rounded-md border border-line bg-white px-2 py-0.5 text-[11.5px] text-zinc-600 hover:border-rose-200 hover:text-rose-700 disabled:opacity-40">
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />}{label}
      </button>
      {err && <span className="text-[11px] text-rose-700">{err}</span>}
    </span>
  );
}
