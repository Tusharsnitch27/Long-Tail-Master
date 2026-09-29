import Link from "next/link";
import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { summarize, monthOutlook } from "@/server/analytics";
import { loadSkus } from "@/server/skus";
import { catColor, catLabel } from "@/server/views";
import { CATEGORIES } from "@/lib/categories";
import { PageHeader, Section, StatusBadge, Delta } from "@/components/ui";
import { BarList } from "@/components/charts/BarList";
import { inr, num, pct } from "@/lib/format";
import { fmtRange } from "@/lib/dates";
import { growth, safeDiv, targetStatus } from "@/lib/metrics";

export default async function Categories({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  const [facts, sku] = await Promise.all([loadFacts(ctx), loadSkus(ctx)]);
  const { range, compare } = ctx.period;
  const th = ctx.settings.thresholds;
  const disabled = CATEGORIES.filter((c) => !ctx.settings.enabledCategories.includes(c.key));
  return (
    <>
      <PageHeader title="Category Performance" subtitle={<>{fmtRange(range)} · {ctx.period.compareLabel}</>} />
      <div className="grid gap-4 xl:grid-cols-2">
        {ctx.filters.cats.map((c) => {
          const fs = facts.filter((f) => f.c === c);
          const m = summarize(fs, range), p = summarize(fs, compare), mo = monthOutlook(fs, ctx.asOf);
          const skus = sku.skus.filter((s) => s.c === c);
          const selling = skus.filter((s) => s.qty > 0);
          const stats: [string, React.ReactNode, string?][] = [
            ["Revenue", <>{inr(m.sales)} <Delta v={growth(m.sales, p.sales)} className="text-[11px]" /></>],
            ["Units", <>{num(m.qty)} <Delta v={growth(m.qty, p.qty)} className="text-[11px]" /></>],
            ["Target", inr(m.target)],
            ["Achievement", <StatusBadge key="s" status={targetStatus(m.sales, m.target, th)} ach={m.ach} />],
            ["Stores selling", `${m.storesSelling} / ${m.stores}`],
            ["Avg revenue / store", inr(m.salesPerStore)],
            ["Avg units / store", num(m.unitsPerStore, 1)],
            ["ASP", inr(m.asp, { compact: false })],
            ["Discount", pct(m.disc), "1 − revenue ÷ MRP value"],
            ["Active SKUs", `${selling.length} selling · ${skus.length} in 90d`],
            ["MTD ach / projected", `${pct(safeDiv(mo.mtdSales, mo.mtdTarget), 0)} / ${pct(mo.projectedAch, 0)}`],
            ["Required / day", inr(mo.requiredRunRate)],
          ];
          return (
            <Section key={c} title={<span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: catColor(c) }} />{catLabel(c)}</span>}
              right={<Link className="text-[12px] text-brand-600 hover:underline" href={withQs(ctx, "/products/skus", { cat: c })}>SKUs →</Link>}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
                {stats.map(([k, v, tip]) => (
                  <div key={k} title={tip}><dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt><dd className="tabular mt-0.5 text-[14px] font-semibold">{v}</dd></div>
                ))}
              </dl>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div><div className="mb-1 text-[12px] font-semibold text-zinc-600">Top SKUs</div>
                  <BarList color={catColor(c)} items={selling.slice(0, 5).map((s) => ({ label: s.name ?? s.sku, value: s.sales, sub: `${s.qty}u`, href: withQs(ctx, `/products/skus/${encodeURIComponent(s.sku)}`) }))} /></div>
                <div><div className="mb-1 text-[12px] font-semibold text-zinc-600">Bottom selling SKUs</div>
                  <BarList color="#a1a1aa" items={selling.slice(-5).reverse().map((s) => ({ label: s.name ?? s.sku, value: s.sales, sub: `${s.qty}u`, href: withQs(ctx, `/products/skus/${encodeURIComponent(s.sku)}`) }))} /></div>
              </div>
            </Section>
          );
        })}
      </div>
      {disabled.length > 0 && (
        <p className="mt-4 text-[12.5px] text-zinc-500">
          Also available: {disabled.map((d) => d.label).join(", ")} — enable in <Link className="text-brand-600 hover:underline" href="/admin/settings">Admin → Settings</Link>. These use store sales from HORIZONTAL_SALES_CATEGORIES; targets can be set in Target Setup.
        </p>
      )}
    </>
  );
}
