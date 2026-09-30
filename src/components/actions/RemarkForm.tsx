"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lightbulb, MessageSquareText, Ban, AlarmClockOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { CATEGORIES } from "@/lib/categories";

const ALL_CATS = [...CATEGORIES].map((c) => ({ key: c.key, label: c.label })).sort((a, b) => a.label.localeCompare(b.label));

/**
 * Team remark form. Remarks are read by the Action Centre (hide / annotate actions, mark anomaly days) and by Mitra.
 * Used inline on an action card (scopes derived from the action) or standalone (pick a store / category / date).
 */
export type Kind = "context" | "not_applicable" | "snooze";
export type Scope = "action" | "store" | "store_category" | "product" | "category" | "date" | "general";

export interface RemarkTarget {
  actionKey?: string;
  actionTitle?: string;
  store?: { code: string; name: string } | null;
  category?: string | null;
  product?: { sku: string; name: string | null } | null;
  period?: { from: string; to: string } | null;
}

const KINDS: { k: Kind; label: string; hint: string; icon: typeof MessageSquareText }[] = [
  { k: "context", label: "Context note", hint: "Keep the item; show the note to everyone", icon: MessageSquareText },
  { k: "not_applicable", label: "Not applicable", hint: "Hide matching actions from now on", icon: Ban },
  { k: "snooze", label: "Snooze", hint: "Hide matching actions until a date", icon: AlarmClockOff },
];

interface Suggestion { text: string; kind: Kind; scope: Scope; days?: number; needs?: ("store" | "category" | "product")[] }
const SUGGESTIONS: Suggestion[] = [
  { text: "Store has no stock of this category — not planned here", kind: "not_applicable", scope: "store_category", needs: ["store", "category"] },
  { text: "Category not part of this store's range", kind: "not_applicable", scope: "store_category", needs: ["store", "category"] },
  { text: "Store closed for renovation", kind: "snooze", scope: "store", days: 14, needs: ["store"] },
  { text: "VM revamp in progress — display being rebuilt", kind: "snooze", scope: "store_category", days: 14, needs: ["store", "category"] },
  { text: "Stock in transit — dispatched from warehouse", kind: "snooze", scope: "action", days: 7 },
  { text: "Already actioned with the store / channel team", kind: "context", scope: "action" },
  { text: "Festival / Snitch birthday spike on <date>", kind: "context", scope: "date" },
  { text: "Price change on <date>", kind: "context", scope: "date" },
  { text: "Marketplace listing was down on <date>", kind: "context", scope: "date" },
  { text: "Product being discontinued — no reorder planned", kind: "not_applicable", scope: "product", needs: ["product"] },
  { text: "Staff shortage at the store this week", kind: "snooze", scope: "store", days: 7, needs: ["store"] },
  { text: "Target will be revised in Control Centre", kind: "context", scope: "action" },
];

const EXAMPLES = [
  { say: "“Hilite Mall has no perfumes”", as: "Not applicable · Store × category", effect: "push-sales actions disappear and Perfumes counts as not live there" },
  { say: "“27 Sep was Snitch birthday”", as: "Context · Date", effect: "that day is left out of week-on-week baselines and shown on affected actions" },
  { say: "“Stock dispatched on Monday”", as: "Snooze · This action · 1 week", effect: "the action comes back if it is still true after a week" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const monthEnd = () => { const d = new Date(); return iso(new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0))); };
const fmt = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function RemarkForm({ target, stores, categories = ALL_CATS, onDone, compact }: {
  target?: RemarkTarget;
  /** standalone mode: pick lists */
  stores?: { code: string; name: string }[];
  categories?: { key: string; label: string }[];
  onDone?: () => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const t = target ?? {};
  const standalone = !t.actionKey;
  const catLabel = (k: string | null | undefined) => categories.find((c) => c.key === k)?.label ?? k ?? "";
  const [kind, setKind] = useState<Kind>("context");
  const [scope, setScope] = useState<Scope>(standalone ? "date" : t.store && t.category ? "store_category" : "action");
  const [text, setText] = useState("");
  const [day, setDay] = useState<string>("");
  const [until, setUntil] = useState<string>(plusDays(7));
  const [store, setStore] = useState<string>(t.store?.code ?? "");
  const [cat, setCat] = useState<string>(t.category ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const storeName = t.store?.name ?? stores?.find((s) => s.code === store)?.name ?? store;
  const scopes = useMemo(() => {
    const out: { s: Scope; label: string }[] = [];
    if (t.actionKey) out.push({ s: "action", label: "This action" });
    if ((t.store || standalone) && (t.category || standalone)) out.push({ s: "store_category", label: t.store && t.category ? `${t.store.name} × ${catLabel(t.category)}` : "Store × category" });
    if (t.store || standalone) out.push({ s: "store", label: t.store ? `Store: ${t.store.name}` : "Store" });
    if (t.product) out.push({ s: "product", label: `Product: ${t.product.name ?? t.product.sku}` });
    if (t.category || standalone) out.push({ s: "category", label: t.category ? `All ${catLabel(t.category)}` : "Category" });
    out.push({ s: "date", label: "A date (anomaly day)" });
    out.push({ s: "general", label: "General note" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.actionKey, t.store?.code, t.category, t.product?.sku, standalone]);

  const kindAllowed = (k: Kind) => !(k === "not_applicable" && (scope === "date" || scope === "general")) && !(k === "snooze" && (scope === "date" || scope === "general"));
  const chips = SUGGESTIONS.filter((s) => (!s.needs || s.needs.every((n) => (n === "store" ? t.store || standalone : n === "category" ? t.category || standalone : t.product))) && (s.scope !== "action" || t.actionKey));

  function pick(s: Suggestion) {
    setScope(s.scope); setKind(s.kind);
    if (s.days) setUntil(plusDays(s.days));
    setText(s.text.replace("<date>", day ? fmt(day) : "<date>"));
  }

  const effect = (() => {
    const who = scope === "action" ? "this action" : scope === "store_category" ? `${storeName || "the store"} × ${catLabel(cat) || "the category"}` : scope === "store" ? `every action for ${storeName || "the store"}` : scope === "product" ? `every action for ${t.product?.name ?? "this product"}` : scope === "category" ? `every ${catLabel(cat) || "category"} action` : scope === "date" ? (day ? fmt(day) : "the date") : "the team";
    if (scope === "general") return "Shown under Team remarks and read by Mitra as background.";
    if (scope === "date") return `Marks ${who} as an anomaly day${cat ? ` for ${catLabel(cat)}` : ""}: left out of week-on-week and best-run baselines, and shown on actions that cover it. Mitra reads it too.`;
    if (kind === "not_applicable") return scope === "store_category" ? `Hides store actions for ${who} and treats ${catLabel(cat) || "the category"} as not live there (no push-sales, no expansion nudges).` : `Hides ${who} from now on (you can undo it under Team remarks).`;
    if (kind === "snooze") return `Hides ${who} until ${fmt(until)}; it comes back afterwards if still true.`;
    return `Keeps ${who} and shows your note on it as “Team note”. Mitra reads it too.`;
  })();

  async function save() {
    setErr(null);
    if (text.trim().length < 3) { setErr("Write a short remark (or pick a suggestion)."); return; }
    if (text.includes("<date>")) { setErr("Replace <date> with the actual date."); return; }
    if (scope === "date" && !day) { setErr("Pick the date this remark is about."); return; }
    if ((scope === "store" || scope === "store_category") && !store) { setErr("Pick a store."); return; }
    if ((scope === "store_category" || scope === "category") && !cat) { setErr("Pick a category."); return; }
    setBusy(true);
    const body = {
      scope, kind: kindAllowed(kind) ? kind : "context", text: text.trim(), action_key: t.actionKey ?? null,
      scope_id: scope === "action" ? t.actionKey : scope === "store" || scope === "store_category" ? store : scope === "product" ? t.product?.sku : scope === "category" ? cat : scope === "date" ? day : null,
      category: scope === "store_category" || scope === "category" ? cat : scope === "date" ? cat || null : t.category ?? null,
      day: scope === "date" ? day : null,
      until: kind === "snooze" && kindAllowed(kind) ? until : null,
    };
    const res = await fetch("/api/remarks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Could not save (${res.status})`); return; }
    setSaved(true); setText("");
    router.refresh();
    onDone?.();
  }

  const lbl = "mb-1 block text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400";
  const seg = (on: boolean) => cn("rounded-md border px-2 py-1 text-[11.5px] transition-colors", on ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-zinc-600 hover:border-brand-300");
  return (
    <div className={cn("rounded-xl border border-brand-100 bg-brand-50/40", compact ? "p-3" : "p-4")}>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <span className={lbl}>What kind of remark?</span>
          <div className="grid grid-cols-3 gap-1.5">
            {KINDS.map(({ k, label, hint, icon: I }) => (
              <button key={k} type="button" disabled={!kindAllowed(k)} onClick={() => setKind(k)} title={hint}
                className={cn("flex flex-col items-start gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-colors disabled:opacity-35", kind === k && kindAllowed(k) ? "border-brand-500 bg-white ring-2 ring-brand-100" : "border-line bg-white hover:border-brand-300")}>
                <span className="flex items-center gap-1 text-[12px] font-medium text-ink"><I className="size-3.5 text-brand-600" />{label}</span>
                <span className="text-[10.5px] leading-tight text-zinc-500">{hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={lbl}>Applies to</span>
          <div className="flex flex-wrap gap-1.5">
            {scopes.map(({ s, label }) => <button key={s} type="button" onClick={() => setScope(s)} className={seg(scope === s)}>{label}</button>)}
          </div>
        </div>
      </div>

      {(standalone && (scope === "store" || scope === "store_category")) || scope === "date" || (standalone && scope === "category") || kind === "snooze" ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {standalone && (scope === "store" || scope === "store_category") && (
            <label className="text-[12px]"><span className={lbl}>Store</span>
              <select value={store} onChange={(e) => setStore(e.target.value)} className="h-8 w-56 rounded-md border border-line bg-white px-2 text-[12.5px]">
                <option value="">Choose a store…</option>
                {(stores ?? []).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
          )}
          {(scope === "store_category" || scope === "category" || scope === "date") && (standalone || scope === "date") && (
            <label className="text-[12px]"><span className={lbl}>Category{scope === "date" ? " (optional)" : ""}</span>
              <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-8 w-40 rounded-md border border-line bg-white px-2 text-[12.5px]">
                <option value="">{scope === "date" ? "All categories" : "Choose…"}</option>
                {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          )}
          {scope === "date" && (
            <label className="text-[12px]"><span className={lbl}>Date</span>
              <input type="date" value={day} max={plusDays(60)} onChange={(e) => { setDay(e.target.value); if (text.includes("<date>") && e.target.value) setText(text.replace("<date>", fmt(e.target.value))); }} className="h-8 rounded-md border border-line bg-white px-2 text-[12.5px]" />
            </label>
          )}
          {kind === "snooze" && kindAllowed(kind) && (
            <div className="text-[12px]"><span className={lbl}>Snooze until</span>
              <div className="flex items-center gap-1.5">
                <input type="date" value={until} min={plusDays(1)} onChange={(e) => setUntil(e.target.value)} className="h-8 rounded-md border border-line bg-white px-2 text-[12.5px]" />
                {[["3 days", plusDays(3)], ["1 week", plusDays(7)], ["2 weeks", plusDays(14)], ["Month end", monthEnd()]].map(([l, v]) => <button key={l} type="button" onClick={() => setUntil(v)} className={seg(until === v)}>{l}</button>)}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-3">
        <span className={lbl}>Remark</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={600}
          placeholder={scope === "date" ? "e.g. Snitch birthday sale — stores did 10× perfumes" : scope === "store_category" ? "e.g. This store doesn't carry perfumes" : "What should the team (and Mitra) keep in mind?"}
          className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-brand-500" />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((s) => <button key={s.text} type="button" onClick={() => pick(s)} className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[11.5px] text-zinc-600 hover:border-brand-400 hover:text-brand-800">{s.text}</button>)}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-xl items-start gap-1.5 text-[11.5px] text-brand-900"><Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand-600" /><span><b className="font-semibold">Effect:</b> {effect}</span></div>
        <div className="flex items-center gap-2">
          {saved && !err && <span className="text-[11.5px] text-emerald-700">Saved — the team will see it.</span>}
          {err && <span role="alert" className="text-[11.5px] text-rose-700">{err}</span>}
          {onDone && <button type="button" onClick={onDone} className="rounded-md px-2.5 py-1.5 text-[12px] text-zinc-600 hover:bg-white">Cancel</button>}
          <button type="button" disabled={busy} onClick={save} className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy && <Loader2 className="size-3.5 animate-spin" />}Save remark</button>
        </div>
      </div>

      {!compact && (
        <details className="mt-3 text-[11.5px] text-zinc-500">
          <summary className="cursor-pointer select-none text-zinc-600">Examples — how remarks change what you see</summary>
          <ul className="mt-1.5 space-y-1">
            {EXAMPLES.map((e) => <li key={e.say}><b className="font-medium text-zinc-700">{e.say}</b> → {e.as}: {e.effect}.</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
