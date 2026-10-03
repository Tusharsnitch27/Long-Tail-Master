"use client";
import { ASSIGNABLE_ROLES, ROLE_HINT, ROLE_LABEL } from "@/lib/access";
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
        <p className="mb-3 text-[12px] text-zinc-500">DSR categories have bills and Snowflake targets. Other categories use store sales lines; set their targets in Target Setup.</p>
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

interface UserRow { username: string; name: string | null; role: string; active: boolean; has_password: boolean; last_seen_at: string | null; created_by: string | null }

export function UsersForm({ users, me, readOnly }: { users: UserRow[]; me: string; readOnly: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ username: "", name: "", password: "", role: "viewer" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");

  async function call(body: Record<string, unknown>, okText: string) {
    setMsg(null);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Request failed" }); return false; }
    setMsg({ ok: true, text: okText });
    router.refresh();
    return true;
  }
  const genPw = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 55]).join("");
  const input = "h-8 rounded-md border border-zinc-300 px-2 text-[13px]";

  return (
    <div className="space-y-4">
      <form onSubmit={async (e) => { e.preventDefault(); if (await call({ action: "create", ...form }, `User "${form.username}" created — share the password with them securely.`)) setForm({ username: "", name: "", password: "", role: "viewer" }); }}
        className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 text-[14px] font-semibold">Add user</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[12px] text-zinc-600">Username<input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, "") })} placeholder="e.g. rahul.k" className={`${input} mt-1 block w-44`} autoCapitalize="none" /></label>
          <label className="text-[12px] text-zinc-600">Display name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rahul K" className={`${input} mt-1 block w-44`} /></label>
          <label className="text-[12px] text-zinc-600">Password
            <span className="mt-1 flex gap-1"><input required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min 8 characters" className={`${input} w-44 font-mono`} />
              <button type="button" onClick={() => setForm({ ...form, password: genPw() })} className="h-8 rounded-md border border-zinc-300 px-2 text-[12px]">Generate</button></span>
          </label>
          <label className="text-[12px] text-zinc-600">Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={`${input} mt-1 block`}>{ASSIGNABLE_ROLES.map((r) => <option key={r} value={r} title={ROLE_HINT[r]}>{ROLE_LABEL[r]}</option>)}</select>
          </label>
          <button disabled={readOnly} className="h-8 rounded-md bg-zinc-900 px-3 text-[13px] font-medium text-white disabled:opacity-40">Create user</button>
        </div>
        <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-[11.5px] text-zinc-600 sm:grid-cols-2">{ASSIGNABLE_ROLES.map((r) => <li key={r}><b className="font-medium text-ink">{ROLE_LABEL[r]}</b> — {ROLE_HINT[r]}</li>)}<li><b className="font-medium text-ink">Super admin</b> — {ROLE_HINT.superadmin} (set on the server; one person)</li></ul>
        <p className="mt-2 text-[11.5px] text-zinc-500">Usernames: 3–80 characters — letters, digits, dot, underscore, hyphen, @ or + (an email address works; no spaces; stored in lowercase). Passwords are stored hashed and can’t be viewed later — copy it before creating.</p>
      </form>

      {msg && <div className={`rounded-md px-3 py-2 text-[13px] ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</div>}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white scroll-thin">
        <table className="w-full text-[13px]">
          <thead className="bg-zinc-50 text-[11px] uppercase text-zinc-500"><tr><th className="px-4 py-2 text-left">User</th><th className="px-2 text-left">Role</th><th className="px-2 text-left">Status</th><th className="px-2 text-left">Last seen</th><th className="px-4 text-right">Actions</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username} className="border-t border-zinc-100 align-top">
                <td className="px-4 py-2"><div className="font-medium">{u.username}{u.username === me && <span className="ml-1 text-[11px] font-normal text-zinc-400">(you)</span>}</div><div className="text-[11.5px] text-zinc-500">{u.name}{u.created_by ? ` · added by ${u.created_by}` : ""}</div></td>
                <td className="px-2 py-2">
                  <select disabled={readOnly || u.username === me} value={u.role} onChange={(e) => call({ action: "update", username: u.username, role: e.target.value }, `Role updated for ${u.username}`)} className="h-7 rounded border border-zinc-300 px-1 text-[12.5px]">
                    {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r} title={ROLE_HINT[r]}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2">{!u.active ? <span className="text-rose-700">Disabled</span> : !u.has_password ? <span className="text-amber-700">No password set</span> : "Active"}</td>
                <td className="px-2 py-2 text-zinc-500">{u.last_seen_at?.slice(0, 16) ?? "never"}</td>
                <td className="px-4 py-2 text-right">
                  {resetFor === u.username ? (
                    <span className="inline-flex items-center gap-1">
                      <input value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="new password" className={`${input} h-7 w-36 font-mono`} />
                      <button onClick={() => setNewPw(genPw())} className="text-[12px] text-zinc-600 hover:underline">Generate</button>
                      <button onClick={async () => { if (await call({ action: "reset_password", username: u.username, password: newPw }, `Password reset for ${u.username} — share it securely.`)) { setResetFor(null); } }} className="rounded bg-zinc-900 px-2 py-1 text-[12px] text-white">Save</button>
                      <button onClick={() => setResetFor(null)} className="text-[12px] text-zinc-500">Cancel</button>
                    </span>
                  ) : (
                    <span className="inline-flex gap-3 text-[12px]">
                      <button disabled={readOnly} onClick={() => { setResetFor(u.username); setNewPw(""); }} className="text-brand-600 hover:underline">{u.has_password ? "Reset password" : "Set password"}</button>
                      {u.username !== me && <button disabled={readOnly} onClick={() => call({ action: "update", username: u.username, active: !u.active }, `${u.username} ${u.active ? "disabled" : "enabled"}`)} className="text-brand-600 hover:underline">{u.active ? "Disable" : "Enable"}</button>}
                      {u.username !== me && <button disabled={readOnly} onClick={() => confirm(`Delete ${u.username}? This can't be undone.`) && call({ action: "delete", username: u.username }, `${u.username} deleted`)} className="text-rose-600 hover:underline">Delete</button>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
