"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download } from "lucide-react";
import { parseCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/cn";

const COLS = ["sku_group", "image", "l1", "l2", "colour", "occasion", "aesthetic", "bestWith", "closure", "upperMaterial", "soleType", "toeShape", "construction", "season", "soleMaterial", "material", "shape"];

/** Upload product attributes (metafields). Columns other than sku_group become attributes; blanks are ignored. */
export function MetaUpload({ missing }: { missing: { sku: string; name: string; category: string; gaps: string[] }[] }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function upload(f: File) {
    const rows = parseCsv(await f.text());
    const out = rows.map((r) => {
      const sku = (r.sku_group ?? r.sku ?? r.skugroup ?? "").toUpperCase();
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) if (!["sku_group", "sku", "skugroup"].includes(k) && v) attrs[COLS.find((c) => c.toLowerCase() === k.replace(/_/g, "")) ?? k] = v;
      return { sku, attrs };
    }).filter((r) => r.sku && Object.keys(r.attrs).length);
    if (!out.length) return setMsg({ ok: false, text: "No rows with sku_group and at least one attribute." });
    const res = await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "meta", rows: out }) });
    const j = await res.json();
    setMsg(res.ok ? { ok: true, text: `${j.rows} products updated and logged.` } : { ok: false, text: j.error });
    if (res.ok) router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => downloadCsv("product-attributes-template.csv", [COLS, ...missing.slice(0, 500).map((m) => [m.sku])])} className="flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[12px] text-zinc-600 hover:border-brand-300"><Download className="size-3.5" />Template (products with gaps)</button>
      <button onClick={() => file.current?.click()} className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-brand-800"><Upload className="size-3.5" />Upload attributes CSV</button>
      <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      {msg && <span className={cn("text-[12px]", msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</span>}
    </div>
  );
}
