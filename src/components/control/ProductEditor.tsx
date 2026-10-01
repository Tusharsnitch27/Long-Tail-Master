"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Pencil, RotateCcw, ImageOff, Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface EditableProduct {
  sku: string; name: string | null; image: string | null; category: string; catLabel: string;
  l1: string | null; l2: string | null; collection: string | null; attrs: Record<string, string>;
  mrp: number | null; sellingPrice: number | null; status: string | null; liveDate: string | null;
  /** fields currently overridden in the tool (product_meta) */
  edited: string[];
  sold: boolean;
}

const BASE_FIELDS = [
  { k: "name", label: "Product name" }, { k: "image", label: "Image URL" }, { k: "l1", label: "Type (L1)" }, { k: "l2", label: "Sub-type (L2)" },
  { k: "colour", label: "Colour" }, { k: "collection", label: "Collection" }, { k: "material", label: "Material" },
] as const;
const CAT_FIELDS: Record<string, { k: string; label: string }[]> = {
  shoes: [{ k: "occasion", label: "Occasion" }, { k: "aesthetic", label: "Fashion aesthetic" }, { k: "bestWith", label: "Best with" }, { k: "closure", label: "Closure" }, { k: "upperMaterial", label: "Upper material" }, { k: "soleType", label: "Sole type" }, { k: "toeShape", label: "Toe shape" }, { k: "construction", label: "Construction" }, { k: "season", label: "Season" }, { k: "soleMaterial", label: "Sole material" }],
  sunglasses: [{ k: "shape", label: "Frame shape" }],
  perfumes: [{ k: "notes", label: "Fragrance notes" }, { k: "concentration", label: "Concentration" }, { k: "volume", label: "Volume (ml)" }],
  bags: [{ k: "size", label: "Size" }], luggage: [{ k: "size", label: "Size" }],
};
const current = (p: EditableProduct, k: string) => (k === "name" ? p.name : k === "image" ? p.image : k === "l1" ? p.l1 : k === "l2" ? p.l2 : k === "collection" ? p.collection : p.attrs[k] ?? null) ?? "";
const gapsOf = (p: EditableProduct) => [!p.name && "name", !p.image && "image", !p.l1 && "type", !p.attrs.colour && "colour"].filter(Boolean) as string[];
const PAGE = 60;

/**
 * Control Centre product editor: find a product, see what every source currently says, and correct name, image,
 * type, colour, collection and category attributes. Edits win over Shopify and the master sheets, are logged, and
 * can be reset to the source value. Cost price is never shown or edited.
 */
export function ProductEditor({ products, categories }: { products: EditableProduct[]; categories: { key: string; label: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [only, setOnly] = useState<"all" | "gaps" | "edited">("gaps");
  const [n, setN] = useState(PAGE);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return products.filter((p) => (!cat || p.category === cat) && (only === "all" || (only === "gaps" ? gapsOf(p).length > 0 : p.edited.length > 0))
      && t.every((w) => `${p.sku} ${p.name ?? ""} ${p.l1 ?? ""} ${p.attrs.colour ?? ""}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(b.sold) - Number(a.sold) || a.sku.localeCompare(b.sku));
  }, [products, q, cat, only]);
  const p = products.find((x) => x.sku === sel) ?? null;
  const fields = p ? [...BASE_FIELDS, ...(CAT_FIELDS[p.category] ?? [])] : [];
  const open = (x: EditableProduct) => { setSel(x.sku); setForm({}); setMsg(null); };
  const val = (k: string) => (k in form ? form[k] : p ? current(p, k) : "");
  const changed = p ? fields.filter((f) => k(f) in form && form[k(f)].trim() !== current(p, k(f))) : [];
  function k(f: { k: string }) { return f.k; }

  async function save(reset?: string) {
    if (!p) return;
    const attrs: Record<string, string> = reset ? { [reset]: "" } : Object.fromEntries(changed.map((f) => [f.k, form[f.k].trim()]));
    if (!Object.keys(attrs).length) return;
    setBusy(true); setMsg(null);
    const res = await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "meta", rows: [{ sku: p.sku, attrs }] }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: j.error ?? "Save failed" });
    setMsg({ ok: true, text: reset ? "Reset to the source value." : `${Object.keys(attrs).length} field${Object.keys(attrs).length > 1 ? "s" : ""} saved and logged.` });
    setForm({}); router.refresh();
  }

  const input = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-[12.5px] text-ink shadow-[inset_0_1px_1px_rgba(60,40,20,.05)] outline-none transition placeholder:text-zinc-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15";
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="rounded-[16px] border border-line bg-paper">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15">
            <Search className="size-4 text-zinc-400" /><input value={q} onChange={(e) => { setQ(e.target.value); setN(PAGE); }} placeholder="Search SKU, name, type, colour" className="w-full bg-transparent text-[12.5px] outline-none" />
          </div>
          <select value={cat} onChange={(e) => setCat(e.target.value)} className={cn("h-9 rounded-lg border px-2 text-[12.5px] outline-none", cat ? "border-brand-500 bg-brand-50 font-medium text-brand-900" : "border-zinc-300 bg-white")}>
            <option value="">All categories</option>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <div className="flex rounded-lg border border-zinc-300 bg-white p-0.5 text-[12px]">
            {([["gaps", "Has gaps"], ["edited", "Edited here"], ["all", "All"]] as const).map(([k2, l]) => <button key={k2} onClick={() => setOnly(k2)} className={cn("rounded-md px-2.5 py-1", only === k2 ? "bg-brand-900 font-medium text-canvas" : "text-zinc-600 hover:bg-brand-50")}>{l}</button>)}
          </div>
          <span className="text-[11.5px] text-zinc-500">{list.length.toLocaleString("en-IN")} products</span>
        </div>
        <ul className="max-h-[640px] divide-y divide-line overflow-y-auto scroll-thin">
          {list.slice(0, n).map((x) => {
            const gaps = gapsOf(x);
            return (
              <li key={x.sku}>
                <button onClick={() => open(x)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-brand-50/60", sel === x.sku && "bg-brand-50 shadow-[inset_3px_0_0_#a8703f]")}>
                  {x.image ? <img src={x.image} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg border border-line bg-white object-cover" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400"><ImageOff className="size-4" /></span>}
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className={cn("block truncate text-[12.5px] font-medium", !x.name && "italic text-rose-600")}>{x.name ?? "No name"}</span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-zinc-500">{x.sku} · <span className="font-sans">{x.catLabel}{x.l1 ? ` · ${x.l1}` : ""}</span></span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {x.edited.length > 0 && <span className="rounded bg-brand-900 px-1.5 py-0.5 text-[10px] font-medium text-canvas">edited</span>}
                    {gaps.map((g) => <span key={g} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200">no {g}</span>)}
                  </span>
                </button>
              </li>
            );
          })}
          {!list.length && <li className="px-4 py-10 text-center text-[12.5px] text-zinc-500">No products match.</li>}
        </ul>
        {list.length > n && <button onClick={() => setN(n + PAGE)} className="w-full border-t border-line py-2 text-[12px] font-medium text-brand-700 hover:bg-brand-50">Show more ({list.length - n} left)</button>}
      </div>

      <div className="rounded-[16px] border border-line bg-paper p-4 lg:sticky lg:top-16 lg:self-start">
        {!p ? (
          <div className="flex flex-col items-center py-16 text-center text-[12.5px] text-zinc-500"><Pencil className="mb-2 size-5 text-brand-400" />Pick a product on the left to edit its name, image and attributes.</div>
        ) : (
          <>
            <div className="flex gap-3">
              {val("image") ? <img src={val("image")} alt="" className="size-24 shrink-0 rounded-xl border border-line bg-white object-cover" /> : <span className="flex size-24 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400"><ImageOff className="size-5" /></span>}
              <div className="min-w-0">
                <div className="font-serif text-[18px] leading-tight">{val("name") || p.sku}</div>
                <div className="mt-1 font-mono text-[11px] text-zinc-500">{p.sku} · <span className="font-sans">{p.catLabel}</span></div>
                <div className="mt-1.5 text-[11.5px] text-zinc-500">{[p.mrp != null && `MRP ₹${p.mrp.toLocaleString("en-IN")}`, p.sellingPrice != null && `Selling ₹${p.sellingPrice.toLocaleString("en-IN")}`, p.status, p.liveDate && `live ${p.liveDate.slice(0, 10)}`].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              {fields.map((f) => {
                const isEdited = p.edited.includes(f.k), dirty = f.k in form && form[f.k].trim() !== current(p, f.k);
                return (
                  <label key={f.k} className="block">
                    <span className="mb-1 flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                      <span>{f.label}{dirty && <span className="ml-1.5 normal-case tracking-normal text-brand-700">· changed</span>}</span>
                      {isEdited && !dirty && <button type="button" onClick={() => save(f.k)} className="flex items-center gap-1 normal-case tracking-normal text-zinc-500 hover:text-ink" title="Remove the edit and use the source value"><RotateCcw className="size-3" />Reset to source</button>}
                    </span>
                    <input value={val(f.k)} onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))} placeholder={`Add ${f.label.toLowerCase()}`}
                      className={cn(input, dirty && "border-brand-500 bg-brand-50/60", isEdited && !dirty && "border-l-4 border-l-brand-500")} />
                  </label>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className={cn("text-[11.5px]", msg ? (msg.ok ? "text-emerald-700" : "text-rose-600") : "text-zinc-500")}>{msg ? <span className="flex items-center gap-1">{msg.ok && <Check className="size-3.5" />}{msg.text}</span> : "Edits win over Shopify and the master sheets. A bronze edge marks an edited field."}</span>
              <button type="button" onClick={() => save()} disabled={!changed.length || busy} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-900 px-3.5 py-2 text-[12.5px] font-medium text-canvas hover:bg-brand-800 disabled:opacity-40">{busy && <Loader2 className="size-3.5 animate-spin" />}Save {changed.length ? changed.length : ""} change{changed.length === 1 ? "" : "s"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
