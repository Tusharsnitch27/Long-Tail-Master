import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { buildStoreModel, modelRanges } from "@/server/storeInsights";
import { catLabel } from "@/server/views";
import { PageHeader, Tabs, DataPrompt } from "@/components/ui";
import { StoreFilter } from "@/components/StoreFilter";
import { SummaryTab } from "@/components/stores/SummaryTab";
import { StoresTab } from "@/components/stores/StoresTab";
import { FormatsTab } from "@/components/stores/FormatsTab";
import { DistributionTab } from "@/components/stores/DistributionTab";
import { DsrTab } from "@/components/stores/DsrTab";
import { StoreProductsTab } from "@/components/stores/StoreProductsTab";
import { StoreScopeFilter } from "@/components/stores/StoreScopeFilter";
import { metaOptions, storeMetaTotals, type MetaFilter } from "@/server/storeProducts";
import { CATEGORIES } from "@/lib/categories";
import { addDays, addMonths, fmtDate, fmtRange, startOfMonth } from "@/lib/dates";

export const metadata = { title: "Store Overview" };

const TABS = [
  { key: "summary", label: "Summary" },
  { key: "stores", label: "Stores" },
  { key: "products", label: "Store × product" },
  { key: "formats", label: "States & formats" },
  { key: "distribution", label: "Distribution & expansion" },
  { key: "dsr", label: "DSR" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function StoreOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const base = await pageContext(searchParams);
  const tab: TabKey = (TABS.find((t) => t.key === base.sp.tab)?.key ?? "summary") as TabKey;
  // network views (formats, distribution) always compare the whole network — the store filter doesn't apply
  const ctx = tab === "formats" || tab === "distribution" ? { ...base, filters: { ...base.filters, stores: [] } } : base;
  const ms = startOfMonth(ctx.asOf), pms = addMonths(ms, -1);
  // period + compare + MTD, the 60-day live window, last month (same days / daily chart), last & prior 7 days
  const facts = await loadFacts(ctx, [...modelRanges(ctx), { from: pms, to: addDays(ms, -1) }, { from: addDays(ctx.asOf, -36), to: ctx.asOf }]);
  const model = await buildStoreModel(ctx, facts);
  const str = (k: string) => (typeof ctx.sp[k] === "string" && ctx.sp[k] ? String(ctx.sp[k]) : null);
  const mf: MetaFilter = { l1: str("mf_l1"), l2: str("mf_l2"), colour: str("mf_colour") };
  const mfOn = !!(mf.l1 || mf.l2 || mf.colour);
  const [mOpts, mTotals] = tab === "stores" ? await Promise.all([metaOptions(ctx).catch(() => ({} as Record<string, string[]>)), mfOn ? storeMetaTotals(ctx, mf).catch(() => null) : Promise.resolve(null)]) : [null, null];

  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, href: withQs(ctx, "/stores", { tab: t.key === "summary" ? null : t.key, dc: null }) }));
  const scope = ctx.filters.cat ? catLabel(ctx.filters.cat) : "All long-tail categories";
  const sub: Record<TabKey, React.ReactNode> = {
    summary: <>{scope} · {fmtRange(ctx.period.range)} <span className="text-zinc-400">· {ctx.period.compareLabel} · month plan as of {fmtDate(ctx.asOf, true)}</span></>,
    stores: <>{scope} · store ranking · {fmtRange(ctx.period.range)} <span className="text-zinc-400">· {ctx.period.compareLabel}</span></>,
    products: <>{scope} · every product at store level — what sells where, what sits, which metafields sell in which store · {fmtRange(ctx.period.range)}</>,
    formats: <>{scope} · state, high street vs mall, metro vs non-metro · {fmtRange(ctx.period.range)}</>,
    distribution: <>Where each category is live, where it is missing and where to launch next · store report {model.invDate ? fmtDate(model.invDate, true) : "—"}</>,
    dsr: <>{scope} · daily store report to {fmtDate(ctx.asOf, true)} · day vs last week, week vs prior, month vs last month</>,
  };
  const showStoreFilter = tab === "stores" || tab === "dsr" || tab === "summary" || tab === "products";
  const filterOpts = [...model.stores].sort((a, b) => a.store.localeCompare(b.store)).map((s) => ({ value: s.b, label: s.store, hint: s.city ?? undefined }));

  return (
    <>
      <PageHeader title="Store Overview" subtitle={sub[tab]} right={showStoreFilter && filterOpts.length ? <StoreFilter options={filterOpts} /> : undefined} />
      <Tabs active={tab} tabs={tabs} />
      {!model.stores.length ? (
        <DataPrompt title="No store data for this selection">No store sold or held stock of {scope.toLowerCase()} in {fmtRange(ctx.period.range)}. Try a longer period or another category.</DataPrompt>
      ) : tab === "summary" ? <SummaryTab ctx={ctx} facts={facts} model={model} />
        : tab === "stores" ? <><StoreScopeFilter categories={CATEGORIES.filter((c) => base.settings.enabledCategories.includes(c.key)).map((c) => ({ key: c.key, label: c.label })).sort((a, b) => a.label.localeCompare(b.label))} options={mOpts ?? {}} /><StoresTab ctx={ctx} model={model} meta={mTotals && mfOn ? { totals: mTotals, label: [mf.l1, mf.l2, mf.colour].filter(Boolean).join(" · ") } : null} /></>
        : tab === "products" ? <StoreProductsTab ctx={ctx} />
        : tab === "formats" ? <FormatsTab ctx={ctx} model={model} />
        : tab === "distribution" ? <DistributionTab ctx={ctx} model={model} />
        : <DsrTab ctx={ctx} facts={facts} model={model} />}
      {!model.invDate && tab !== "distribution" && (
        <div className="mt-3"><DataPrompt compact title="Store report unavailable">Store stock, cover, penetration and live status from stock are missing — live status falls back to sales in the last 60 days.</DataPrompt></div>
      )}
    </>
  );
}
