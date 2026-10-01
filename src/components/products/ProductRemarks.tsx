"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Tag } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRODUCT_TAGS, PRODUCT_TAG_KEYS, type ProductTag } from "@/lib/productTags";
import { RemarkRemove } from "@/components/actions/RemarkRemove";

export interface ProductRemark { id: number; tag: string | null; text: string; by: string; at: string; canRemove: boolean }

/** Product-level team remarks: pick a tag (or none) and add a note. Tags change which actions apply to this SKU. */
export function ProductRemarks({ sku, category, remarks }: { sku: string; category: string | null; remarks: ProductRemark[] }) {
  const router = useRouter();
  const [tag, setTag] = useState<ProductTag | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = new Set(remarks.map((r) => r.tag).filter(Boolean));
  async function save() {
    const note = text.trim() || (tag ? PRODUCT_TAGS[tag].label : "");
    if (note.length < 3) return setErr("Pick a tag or write a note.");
    setBusy(true); setErr(null);
    const res = await fetch("/api/remarks", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "product", scope_id: sku, category, kind: "context", tag, text: note }) });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); return setErr(j.error ?? "Could not save"); }
    setTag(null); setText(""); router.refresh();
  }
  return (
    <div className="space-y-3">
      {remarks.length > 0 ? (
        <ul className="space-y-1.5">{remarks.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2">
            <div className="min-w-0 text-[12.5px]">
              {r.tag && r.tag in PRODUCT_TAGS && <span className="mr-1.5 inline-flex items-center gap-1 rounded-md bg-brand-900 px-1.5 py-0.5 text-[11px] font-medium text-canvas"><Tag className="size-3" />{PRODUCT_TAGS[r.tag as ProductTag].label}</span>}
              {r.text !== (r.tag && r.tag in PRODUCT_TAGS ? PRODUCT_TAGS[r.tag as ProductTag].label : "") && <span>{r.text}</span>}
              <span className="block text-[11px] text-zinc-400">{r.by} · {new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
            </div>
            {r.canRemove && <RemarkRemove id={r.id} />}
          </li>
        ))}</ul>
      ) : <div className="text-[12px] text-zinc-500">No remarks on this product yet.</div>}
      <div className="rounded-xl border-2 border-dashed border-brand-200 bg-brand-50/50 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-700">Add a remark</div>
        <div className="flex flex-wrap gap-1.5">
          {PRODUCT_TAG_KEYS.map((k) => (
            <button key={k} type="button" disabled={active.has(k)} title={PRODUCT_TAGS[k].hint} onClick={() => setTag(tag === k ? null : k)}
              className={cn("rounded-full border px-2.5 py-1 text-[11.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40", tag === k ? "border-brand-900 bg-brand-900 text-canvas" : "border-brand-200 bg-white text-zinc-700 hover:border-brand-500")}>
              {PRODUCT_TAGS[k].label}
            </button>
          ))}
        </div>
        {tag && <div className="mt-1.5 text-[11.5px] text-brand-800">{PRODUCT_TAGS[tag].hint}.</div>}
        <div className="mt-2 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={600} placeholder={tag ? "Add detail (optional) — e.g. until the new batch arrives" : "Note for the team, e.g. stores report sizing runs small"}
            className="h-9 min-w-0 flex-1 rounded-lg border border-brand-200 bg-white px-3 text-[12.5px] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15" />
          <button type="button" onClick={save} disabled={busy} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-900 px-3 text-[12px] font-medium text-canvas hover:bg-brand-800 disabled:opacity-50">{busy && <Loader2 className="size-3.5 animate-spin" />}Save</button>
        </div>
        {err && <div role="alert" className="mt-1.5 text-[11.5px] text-rose-700">{err}</div>}
      </div>
    </div>
  );
}
