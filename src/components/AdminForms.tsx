"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

type Settings = { thresholds: { ahead: number; onTrack: number; atRisk: number }; exceptions: { wowDecline: number; lowPenetration: number; highRunRateMultiple: number; fewStores: number }; enabledCategories: string[] };

function Field({ label, hint, value, onChange, suffix }: { label: string; hint?: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="block text-[13px]">
      <span className="font-medium">{label}</span>
      {hint && <span className="block text-[11.5px] text-zinc-500">{hint}</span>}
      <span className="mt-1 flex items-center gap-1">
        <input type="number" step="any" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} className="h-8 w-28 rounded-md border border-zinc-300 px-2 tabular" />
        {suffix && <span className="text-zinc-500">{suffix}</span>}
      </span>
    </label>
  );
}

export function SettingsForm({ initial, categories, readOnly }: { initial: Settings; categories: { key: string; label: string; source: string }[]; readOnly: boolean }) {
  const router = useRouter();
  // percentages are edited as whole numbers
  const [t, setT] = useState({ ahead: initial.thresholds.ahead * 100, onTrack: initial.thresholds.onTrack * 100, atRisk: initial.thresholds.atRisk * 100 });
  const [x, setX] = useState({ wowDecline: initial.exceptions.wowDecline * 100, lowPenetration: initial.exceptions.lowPenetration * 100, highRunRateMultiple: initial.exceptions.highRunRateMultiple, fewStores: initial.exceptions.fewStores });
  const [cats, setCats] = useState<string[]>(initial.enabledCategories);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setMsg(null);
    const res = await fetch("/api/admin/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      thresholds: { ahead: t.ahead / 100, onTrack: t.onTrack / 100, atRisk: t.atRisk / 100 },
      exceptions: { wowDecline: x.wowDecline / 100, lowPenetration: x.lowPenetration / 100, highRunRateMultiple: x.highRunRateMultiple, fewStores: Math.round(x.fewStores) },
      enabledCategories: cats,
    }) });
    const j = await res.json();
    setMsg(res.ok ? { ok: true, text: "Settings saved" } : { ok: false, text: j.error });
    if (res.ok) router.refresh();
  }
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-[14px] font-semibold">Target status thresholds</h2>
        <div className="flex flex-wrap gap-6">
          <Field label="Ahead" hint="achievement at or above" value={t.ahead} onChange={(v) => setT({ ...t, ahead: v })} suffix="%" />
          <Field label="On track" hint="at or above" value={t.onTrack} onChange={(v) => setT({ ...t, onTrack: v })} suffix="%" />
          <Field label="At risk" hint="at or above; below = Behind" value={t.atRisk} onChange={(v) => setT({ ...t, atRisk: v })} suffix="%" />
        </div>
      </section>
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-[14px] font-semibold">Exception rules</h2>
        <div className="flex flex-wrap gap-6">
          <Field label="Major decline" hint="WoW / L7-vs-P7 change at or below" value={x.wowDecline} onChange={(v) => setX({ ...x, wowDecline: v })} suffix="%" />
          <Field label="Low penetration / productivity" hint="SKU store penetration, or store vs network, below" value={x.lowPenetration} onChange={(v) => setX({ ...x, lowPenetration: v })} suffix="%" />
          <Field label="High required run rate" hint="required ÷ current daily rate at or above" value={x.highRunRateMultiple} onChange={(v) => setX({ ...x, highRunRateMultiple: v })} suffix="×" />
          <Field label="Few stores" hint="SKU selling in this many stores or fewer" value={x.fewStores} onChange={(v) => setX({ ...x, fewStores: v })} />
        </div>
      </section>
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-1 text-[14px] font-semibold">Categories</h2>
        <p className="mb-3 text-[12px] text-zinc-500">DSR categories have bills and Snowflake targets. Sales-derived categories use HORIZONTAL_SALES_CATEGORIES store sales; set their targets in Target Setup.</p>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button key={c.key} onClick={() => setCats((s) => (s.includes(c.key) ? s.filter((k) => k !== c.key) : [...s, c.key]))}
              className={cn("rounded-md border px-3 py-1.5 text-[13px]", cats.includes(c.key) ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white")}>
              {c.label} <span className="text-[11px] opacity-60">{c.source === "dsr" ? "DSR" : "sales"}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="flex items-center gap-3">
        <button disabled={readOnly} onClick={save} className="rounded-md bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">Save settings</button>
        {msg && <span className={cn("text-[13px]", msg.ok ? "text-emerald-700" : "text-rose-700")}>{msg.text}</span>}
      </div>
    </div>
  );
}

export function UsersForm({ users, me, readOnly }: { users: { email: string; role: string; active: boolean; last_seen_at: string | null }[]; me: string; readOnly: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [msg, setMsg] = useState<string | null>(null);
  async function upsert(body: { email: string; role: string; active: boolean }) {
    setMsg(null);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) setMsg(j.error); else { setEmail(""); router.refresh(); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@snitch.com" className="h-8 w-64 rounded-md border border-zinc-300 px-2 text-[13px]" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="h-8 rounded-md border border-zinc-300 px-2 text-[13px]">
          <option value="viewer">Viewer</option><option value="editor">Editor (targets)</option><option value="admin">Admin</option>
        </select>
        <button disabled={readOnly || !email} onClick={() => upsert({ email, role, active: true })} className="h-8 rounded-md bg-zinc-900 px-3 text-[13px] font-medium text-white disabled:opacity-40">Add / update</button>
        {msg && <span className="text-[13px] text-rose-700">{msg}</span>}
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-[13px]">
          <thead className="bg-zinc-50 text-[11px] uppercase text-zinc-500"><tr><th className="px-4 py-2 text-left">User</th><th className="px-2 text-left">Role</th><th className="px-2 text-left">Status</th><th className="px-2 text-left">Last seen</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email} className="border-t border-zinc-100">
                <td className="px-4 py-2">{u.email}{u.email === me && <span className="ml-1 text-[11px] text-zinc-400">(you)</span>}</td>
                <td className="px-2">
                  <select disabled={readOnly || u.email === me} value={u.role} onChange={(e) => upsert({ email: u.email, role: e.target.value, active: u.active })} className="h-7 rounded border border-zinc-300 px-1 text-[12.5px]">
                    <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-2">{u.active ? "Active" : <span className="text-rose-700">Disabled</span>}</td>
                <td className="px-2 text-zinc-500">{u.last_seen_at?.slice(0, 16) ?? "never"}</td>
                <td className="px-4 text-right">{u.email !== me && <button disabled={readOnly} onClick={() => upsert({ email: u.email, role: u.role, active: !u.active })} className="text-[12px] text-brand-600 hover:underline">{u.active ? "Disable" : "Enable"}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
