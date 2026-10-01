"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { parseCsv, downloadCsv } from "@/lib/csv";
import { inr, num } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Thumb } from "@/components/ui";
import { INWARD_STATUSES, INWARD_STATUS_LABEL, type InwardStatus } from "./vmStages";

export interface InwardRow {
  id: number; category: string; categoryLabel: string; design: string; sku_group: string | null; kind: "new" | "repeat"; qty: number;
  expected_date: string | null; warehouse: string | null; status: string; note: string | null; created_by: string;
  image: string | null; name: string | null; overdue: boolean;
  // repeat
  stock: number | null; l30: number | null; doi: number | null; coverAfter: number | null;
  // new
  bench: { label: string; peers: number; medRate: number | null; daysToSell: number | null; asp: number | null } | null;
  value: number | null;
}

type Form = { id?: number; category: string; design: string; sku_group: string; kind: "new" | "repeat"; qty: string; expected_date: string; warehouse: string; status: InwardStatus; note: string };
const CSV_COLS = ["category", "design", "sku_group", "kind", "qty", "expected_date", "warehouse", "status", "note"];

export function InwardsManager({ rows, cats, admin, warehouses }: { rows: InwardRow[]; cats: { key: string; label: string }[]; admin: boolean; warehouses: string[] }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const blank: Form = { category: cats[0]?.key ?? "", design: "", sku_group: "", kind: "new", qty: "", expected_date: "", warehouse: warehouses[0] ?? "", status: "planned", note: "" };
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<"open" | "all">("open");

  async function post(body: unknown) {
    setBusy(true);
    try {
      const res = await fetch("/api/inwards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Failed" }); return false; }
      setMsg({ ok: true, text: j.created != null ? `${j.created} added, ${j.updated} updated.` : "Saved." });
      router.refresh();
      return true;
    } finally { setBusy(false); }
  }
  async function save() {
    if (!form) return;
    const ok = await post({ op: "save", source: "manual", rows: [{ id: form.id ?? null, category: form.category, design: form.design, sku_group: form.sku_group || null, kind: form.kind, qty: Math.round(Number(form.qty) || 0), expected_date: form.expected_date || null, warehouse: form.warehouse || null, status: form.status, note: form.note || null }] });
    if (ok) setForm(null);
  }
  async function upload(f: File) {
    const parsed = parseCsv(await f.text());
    const out = parsed.map((r) => ({
      category: r.category ?? "", design: r.design ?? r.design_name ?? "", sku_group: (r.sku_group ?? r.sku ?? "").toUpperCase() || null,
      kind: /^rep/i.test(r.kind ?? "") ? "repeat" : "new", qty: Math.round(Number(String(r.qty ?? r.quantity ?? "0").replace(/,/g, "")) || 0),
      expected_date: normDate(r.expected_date ?? r.date ?? ""), warehouse: r.warehouse || null,
      status: (INWARD_STATUSES as readonly string[]).includes((r.status ?? "").toLowerCase()) ? r.status.toLowerCase() : "planned", note: r.note || null,
    })).filter((r) => r.design && r.category);
    if (!out.length) return setMsg({ ok: false, text: "No rows with category and design found." });
    await post({ op: "save", source: "upload", rows: out });
  }
  const list = rows.filter((r) => show === "all" || !["received", "cancelled"].includes(r.status));
  const set = (k: keyof Form, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const input = "rounded-md border border-line bg-white px-2 py-1 text-[12px]";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setForm(blank)} className="flex items-center gap-1 rounded-md bg-brand-900 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-brand-800"><Plus className="size-3.5" />Add inward</button>
        <button onClick={() => file.current?.click()} className="flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[12px] text-zinc-700 hover:border-brand-300"><Upload className="size-3.5" />Upload CSV</button>
        <button onClick={() => downloadCsv("future-inwards-template.csv", [CSV_COLS, ["shoes", "Chelsea boot — tan suede", "", "new", "600", "2026-11-15", warehouses[0] ?? "SAPL-WH1", "planned", ""], ["perfumes", "Oud Noir 100ml repeat", "4MSFR0012-01", "repeat", "1200", "2026-10-28", warehouses[0] ?? "SAPL-WH1", "confirmed", ""]])}
          className="flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[12px] text-zinc-600 hover:border-brand-300"><Download className="size-3.5" />Template</button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        <span className="ml-auto flex gap-0.5 rounded-lg border border-line bg-white p-0.5 text-[11.5px]">
          {(["open", "all"] as const).map((k) => <button key={k} onClick={() => setShow(k)} className={cn("rounded-md px-2 py-0.5", show === k ? "bg-brand-900 text-white" : "text-zinc-600")}>{k === "open" ? "Open" : "All incl. received"}</button>)}
        </span>
        {msg && <span className={cn("w-full text-[12px]", msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</span>}
      </div>

      {form && (
        <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
          <div className="mb-2 flex items-center justify-between text-[12.5px] font-semibold">{form.id ? "Edit inward" : "New inward"}<button onClick={() => setForm(null)} className="text-zinc-400 hover:text-zinc-600"><X className="size-4" /></button></div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Category<select className={input} value={form.category} onChange={(e) => set("category", e.target.value)}>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
            <label className="col-span-2 flex flex-col gap-0.5 text-[11px] text-zinc-500">Design<input className={input} value={form.design} onChange={(e) => set("design", e.target.value)} placeholder="e.g. Chelsea boot — tan suede" /></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Kind<select className={input} value={form.kind} onChange={(e) => set("kind", e.target.value)}><option value="new">New design</option><option value="repeat">Repeat design</option></select></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">SKU group {form.kind === "repeat" ? "(required for cover)" : "(optional)"}<input className={input} value={form.sku_group} onChange={(e) => set("sku_group", e.target.value.toUpperCase())} placeholder="SH0173-01" /></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Qty<input className={input} type="number" min={0} value={form.qty} onChange={(e) => set("qty", e.target.value)} /></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Expected date<input className={input} type="date" value={form.expected_date} onChange={(e) => set("expected_date", e.target.value)} /></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Warehouse<input className={input} list="wh-list" value={form.warehouse} onChange={(e) => set("warehouse", e.target.value)} /><datalist id="wh-list">{warehouses.map((w) => <option key={w} value={w} />)}</datalist></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">Status<select className={input} value={form.status} onChange={(e) => set("status", e.target.value)}>{INWARD_STATUSES.map((s) => <option key={s} value={s}>{INWARD_STATUS_LABEL[s]}</option>)}</select></label>
            <label className="col-span-2 flex flex-col gap-0.5 text-[11px] text-zinc-500 md:col-span-3 xl:col-span-6">Note<input className={input} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Vendor, PO number, launch plan …" /></label>
            <div className="flex items-end"><button disabled={busy || !form.design || !form.category} onClick={save} className="w-full rounded-md bg-brand-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button></div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto scroll-thin">
        <table className="w-full whitespace-nowrap text-[12px]">
          <thead><tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-zinc-500">
            {["Design", "Category", "Kind", "Qty", "Expected", "Warehouse", "Status", "Stock now", "L30 units", "DOI now", "Cover after", "Similar-product benchmark", "Value ≈", ""].map((h, i) => <th key={i} className={cn("px-2 py-1.5 font-medium first:pl-0", i >= 3 && i !== 5 && i !== 6 && i !== 11 ? "text-right" : "text-left")}>{h}</th>)}
          </tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0 align-middle">
                <td className="py-1.5 pr-2">
                  <span className="flex items-center gap-2.5"><Thumb src={r.image} size={44} />
                    <span className="min-w-0 leading-tight"><span className="block max-w-[240px] truncate font-medium">{r.design}</span><span className="block font-mono text-[10.5px] text-zinc-400">{r.sku_group ?? "no SKU yet"}{r.note ? <span className="ml-1.5 font-sans text-zinc-500">· {r.note}</span> : null}</span></span>
                  </span>
                </td>
                <td className="px-2">{r.categoryLabel}</td>
                <td className="px-2"><span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-medium", r.kind === "new" ? "bg-brand-50 text-brand-700" : "bg-zinc-100 text-zinc-600")}>{r.kind === "new" ? "New" : "Repeat"}</span></td>
                <td className="tabular px-2 text-right font-medium">{num(r.qty)}</td>
                <td className={cn("tabular px-2 text-right", r.overdue && "text-rose-600")}>{r.expected_date ? fmtDate(r.expected_date, true) : "—"}{r.overdue ? " · late" : ""}</td>
                <td className="px-2">{r.warehouse ?? "—"}</td>
                <td className="px-2">{INWARD_STATUS_LABEL[r.status as InwardStatus] ?? r.status}</td>
                <td className="tabular px-2 text-right">{r.stock == null ? "—" : num(r.stock)}</td>
                <td className="tabular px-2 text-right">{r.l30 == null ? "—" : num(r.l30)}</td>
                <td className={cn("tabular px-2 text-right", r.doi != null && r.doi < 21 && "text-rose-600")}>{r.doi == null ? "—" : `${num(r.doi)} d`}</td>
                <td className={cn("tabular px-2 text-right", r.coverAfter != null && r.coverAfter > 150 && "text-amber-700")}>{r.coverAfter == null ? "—" : `${num(r.coverAfter)} d`}</td>
                <td className="px-2 text-[11.5px] text-zinc-600">{r.bench ? <>{r.bench.label} · {r.bench.peers} peers · median {num(r.bench.medRate, 2)}/day{r.bench.daysToSell != null ? <> · <b className={r.bench.daysToSell > 120 ? "text-amber-700" : "text-zinc-800"}>~{num(r.bench.daysToSell)} d</b> to sell qty</> : null}</> : r.kind === "new" ? "No comparable sellers" : ""}</td>
                <td className="tabular px-2 text-right">{inr(r.value)}</td>
                <td className="px-2 text-right">
                  <button title="Edit" onClick={() => setForm({ id: r.id, category: r.category, design: r.design, sku_group: r.sku_group ?? "", kind: r.kind, qty: String(r.qty), expected_date: r.expected_date ?? "", warehouse: r.warehouse ?? "", status: (r.status as InwardStatus) ?? "planned", note: r.note ?? "" })} className="p-1 text-zinc-400 hover:text-brand-700"><Pencil className="size-3.5" /></button>
                  {admin && <button title="Delete" disabled={busy} onClick={() => { if (confirm(`Delete "${r.design}"?`)) post({ op: "delete", id: r.id }); }} className="p-1 text-zinc-400 hover:text-rose-600"><Trash2 className="size-3.5" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="py-8 text-center text-[12.5px] text-zinc-500">No future inwards yet — add one or upload the CSV template (category, design, sku_group, kind, qty, expected_date, warehouse).</div>}
      </div>
    </div>
  );
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY. */
function normDate(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
