import { pageContext, loadFacts, withQs, type SP } from "@/server/context";
import { buildStoreModel, modelRanges } from "@/server/storeInsights";
import { catLabel } from "@/server/views";
import { PageHeader, Tabs, DataPrompt } from "@/components/ui";
import { StoreOverviewFilters, type StoreFilterDef } from "@/components/stores/StoreOverviewFilters";
import { fmtLt, fmtCt, LT_LABEL, CT_LABEL, titleCase } from "@/server/storeInsights";
import { SummaryTab } from "@/components/stores/SummaryTab";
import { StoresTab } from "@/components/stores/StoresTab";
import { FormatsTab } from "@/components/stores/FormatsTab";
import { DistributionTab } from "@/components/stores/DistributionTab";
import { DsrTab } from "@/components/stores/DsrTab";
import { StoreProductsTab } from "@/components/stores/StoreProductsTab";
import { GitTab } from "@/components/stores/GitTab";
import { StoreScopeFilter } from "@/components/stores/StoreScopeFilter";
import { metaOptions, storeMetaTotals, type MetaFilter } from "@/server/storeProducts";
import { CATEGORIES } from "@/lib/categories";
import { addDays, addMonths, fmtDate, fmtRange, startOfMonth } from "@/lib/dates";

export const metadata = { title: "Store Overview" };

const TABS = [
  { key: "summary", label: "Summary" },
  { key: "stores", label: "Stores" },
  { key: "products", label: "Store × product" },
  { key: "git", label: "Goods in transit" },
  { key: "formats", label: "States & formats" },
  { key: "distribution", label: "Distribution & expansion" },
  { key: "dsr", label: "DSR" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function StoreOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const base = await pageContext(searchParams);
  const tab: TabKey = (TABS.find((t) => t.key === base.sp.tab)?.key ?? "summary") as TabKey;
  const network = tab === "formats" || tab === "distribution";

  // store attribute filters (region, state, city, format, city type, model, status, AM) resolve to branch codes
  const known = base.stores.filter((s) => s.last_seen && s.last_seen >= "2000");
  const ATTRS: { key: string; label: string; get: (s: (typeof known)[number]) => string | null; width?: number }[] = [
    { key: "s_region", label: "Region", get: (s) => titleCase(s.region) }, { key: "s_state", label: "State", get: (s) => titleCase(s.state) },
    { key: "s_city", label: "City", get: (s) => titleCase(s.city) }, { key: "s_fmt", label: "Format", get: (s) => LT_LABEL[fmtLt(s.location_type) ?? ""] ?? fmtLt(s.location_type) },
    { key: "s_ctype", label: "City type", get: (s) => CT_LABEL[fmtCt(s.city_type) ?? ""] ?? fmtCt(s.city_type) }, { key: "s_om", label: "Model", get: (s) => s.operating_model?.trim().toUpperCase() || null },
    { key: "s_status", label: "Status", get: (s) => titleCase(s.store_status) }, { key: "s_am", label: "Area manager", get: (s) => titleCase(s.am), width: 280 },
  ];
  const sel = (k: string) => (typeof base.sp[k] === "string" ? String(base.sp[k]).split(",").filter(Boolean) : []);
  const attrOn = ATTRS.filter((a) => sel(a.key).length);
  const byAttr = known.filter((s) => attrOn.every((a) => sel(a.key).includes(a.get(s) ?? "")));
  const picked = base.filters.stores;
  const allowed = new Set(byAttr.map((s) => s.branch_code));
  // network views (formats, distribution) compare the network: attribute filters apply, individual store picks don't
  const storesFilter = network ? (attrOn.length ? [...allowed] : []) : picked.length ? picked.filter((b) => !attrOn.length || allowed.has(b)) : attrOn.length ? [...allowed] : [];
  const anyFilter = attrOn.length > 0 || (!network && picked.length > 0);
  // a filter that matches no store must show nothing, not everything
  const ctx = { ...base, filters: { ...base.filters, stores: anyFilter && !storesFilter.length ? ["__none__"] : storesFilter } };
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
    git: <>{scope} · stock allocated from the warehouse to stores and not yet in store stock — pipeline, ageing, stores and products</>,
    products: <>{scope} · every product at store level — what sells where, what sits, which metafields sell in which store · {fmtRange(ctx.period.range)}</>,
    formats: <>{scope} · state, high street vs mall, metro vs non-metro · {fmtRange(ctx.period.range)}</>,
    distribution: <>Where each category is live, where it is missing and where to launch next · store report {model.invDate ? fmtDate(model.invDate, true) : "—"}</>,
    dsr: <>{scope} · daily store report to {fmtDate(ctx.asOf, true)} · day vs last week, week vs prior, month vs last month</>,
  };
  // options narrow to the other attribute filters, so the lists stay relevant
  const optsFor = (a: (typeof ATTRS)[number]) => {
    const pool = known.filter((s) => attrOn.every((o) => o.key === a.key || sel(o.key).includes(o.get(s) ?? "")));
    const n = new Map<string, number>(); for (const s of pool) { const v = a.get(s); if (v) n.set(v, (n.get(v) ?? 0) + 1); }
    return [...n.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([v, c]) => ({ value: v, label: v, hint: String(c) }));
  };
  const fields: StoreFilterDef[] = [
    ...(network ? [] : [{ key: "store", label: "Store", width: 320, options: byAttr.slice().sort((a, b) => a.short_name.localeCompare(b.short_name)).map((s) => ({ value: s.branch_code, label: s.short_name, hint: titleCase(s.city) ?? undefined })) }]),
    ...ATTRS.map((a) => ({ key: a.key, label: a.label, width: a.width, options: optsFor(a) })),
  ];
  const matched = ctx.filters.stores.length ? ctx.filters.stores.filter((b) => b !== "__none__").length : known.length;

  return (
    <>
      <PageHeader title="Store Overview" subtitle={sub[tab]} />
      <Tabs active={tab} tabs={tabs} />
      <StoreOverviewFilters fields={fields} matched={matched} total={known.length} network={network} />
      {!model.stores.length ? (
        <DataPrompt title="No store data for this selection">No store sold or held stock of {scope.toLowerCase()} in {fmtRange(ctx.period.range)}. Try a longer period or another category.</DataPrompt>
      ) : tab === "summary" ? <SummaryTab ctx={ctx} facts={facts} model={model} />
        : tab === "stores" ? <><StoreScopeFilter categories={CATEGORIES.filter((c) => base.settings.enabledCategories.includes(c.key)).map((c) => ({ key: c.key, label: c.label })).sort((a, b) => a.label.localeCompare(b.label))} options={mOpts ?? {}} /><StoresTab ctx={ctx} model={model} meta={mTotals && mfOn ? { totals: mTotals, label: [mf.l1, mf.l2, mf.colour].filter(Boolean).join(" · ") } : null} /></>
        : tab === "products" ? <StoreProductsTab ctx={ctx} />
        : tab === "git" ? <GitTab ctx={ctx} />
        : tab === "formats" ? <FormatsTab ctx={ctx} model={model} />
        : tab === "distribution" ? <DistributionTab ctx={ctx} model={model} />
        : <DsrTab ctx={ctx} facts={facts} model={model} />}
      {!model.invDate && tab !== "distribution" && (
        <div className="mt-3"><DataPrompt compact title="Store report unavailable">Store stock, cover, penetration and live status from stock are missing — live status falls back to sales in the last 60 days.</DataPrompt></div>
      )}
    </>
  );
}
