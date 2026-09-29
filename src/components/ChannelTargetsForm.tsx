"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Month targets for Online / Marketplace by category. Blank = not configured (the app never infers one). */
export function ChannelTargetsForm({ month, cats, initial }: { month: string; cats: { key: string; label: string }[]; initial: Record<string, number | null> }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v == null ? "" : String(v)])));
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    setMsg(null);
    const rows = (["online", "marketplace"] as const).flatMap((ch) => cats.map((c) => { const v = vals[`${ch}|${c.key}`] ?? ""; return { channel: ch, category: c.key, month, target: v.trim() === "" ? null : Number(v) }; }));
    const res = await fetch("/api/targets/channel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }) });
    const j = await res.json();
    setMsg(res.ok ? "Channel targets saved" : j.error);
    if (res.ok) router.refresh();
  }
  return (
    <div className="mb-4 rounded-xl border border-line bg-white p-4">
      <div className="text-[13px] font-semibold">Channel targets · {new Date(month + "T00:00:00Z").toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
      <p className="mt-0.5 text-[12px] text-zinc-500">Stores targets come from Snowflake (below). Online and Marketplace have no source target — enter a month target to enable achievement, pace and projection for them. Leave blank to keep “Target not configured”.</p>
      <table className="mt-3 text-[12.5px]">
        <thead><tr className="text-[11px] text-zinc-500"><th className="pr-6 text-left font-medium">Category</th><th className="px-2 text-left font-medium">Online (₹)</th><th className="px-2 text-left font-medium">Marketplace (₹)</th></tr></thead>
        <tbody>{cats.map((c) => (
          <tr key={c.key}><td className="py-1 pr-6">{c.label}</td>
            {(["online", "marketplace"] as const).map((ch) => (
              <td key={ch} className="px-2 py-1"><input inputMode="decimal" value={vals[`${ch}|${c.key}`] ?? ""} placeholder="not configured" onChange={(e) => setVals({ ...vals, [`${ch}|${c.key}`]: e.target.value.replace(/[^\d.]/g, "") })} className="h-8 w-40 rounded-md border border-line px-2 text-right tabular" /></td>
            ))}
          </tr>
        ))}</tbody>
      </table>
      <div className="mt-3 flex items-center gap-3"><button onClick={save} className="rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white">Save channel targets</button>{msg && <span className="text-[12px] text-zinc-600">{msg}</span>}</div>
    </div>
  );
}
