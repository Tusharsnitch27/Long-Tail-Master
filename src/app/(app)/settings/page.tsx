import Link from "next/link";
import { pageContext, withQs, type SP } from "@/server/context";
import { can } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { getFreshness } from "@/server/data/freshness";
import { channelFreshness, getChannelDaily } from "@/server/data/channels";
import { getFacts } from "@/server/data/facts";
import { getTargetBook, listMonthTargets, listSplits, changeLog } from "@/server/data/targetBook";
import { getStoreInventory } from "@/server/data/inventory";
import { getProducts } from "@/server/data/products";
import { channelMetrics, ucChannel, type ChKey } from "@/server/channelData";
import { ruleBook, TABLES } from "@/server/rulesDoc";
import { catColor, catLabel } from "@/server/views";
import { CATEGORIES } from "@/lib/categories";
import { addDays, addMonths, eachDay, endOfMonth, fmtDate, startOfMonth } from "@/lib/dates";
import { PageHeader, Tabs, Empty, Notice, Section, DataPrompt, Pill } from "@/components/ui";
import { SettingsForm, UsersForm } from "@/components/AdminForms";
import { MonthTargetGrid } from "@/components/control/MonthTargetGrid";
import { SplitEditor } from "@/components/control/SplitEditor";
import { StoreTargetEditor, type StoreTargetRow } from "@/components/control/StoreTargetEditor";
import { MetaUpload } from "@/components/control/MetaUpload";
import { cn } from "@/lib/cn";

export const metadata = { title: "Control Centre" };
const TABS = ["targets", "split", "stores", "attributes", "users", "rules", "log"] as const;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mLabel = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default async function ControlCentre({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  if (!can(ctx.user, "admin")) return <Empty title="Admin access required">The Control Centre (targets, access and rules) is managed by admins.</Empty>;
  const tab = (TABS as readonly string[]).includes(String(ctx.sp.tab)) ? (String(ctx.sp.tab) as (typeof TABS)[number]) : "targets";
  const ro = !dbConfigured();
  const cur = startOfMonth(ctx.asOf);
  const cats = CATEGORIES.filter((c) => ctx.settings.enabledCategories.includes(c.key));
  const catOpts = cats.map((c) => ({ key: c.key, label: c.label, color: c.color }));
  const monthParam = typeof ctx.sp.m === "string" && /^\d{4}-\d{2}$/.test(ctx.sp.m) ? `${ctx.sp.m}-01` : cur;
  const monthNav = (tabKey: string) => (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {Array.from({ length: 7 }, (_, i) => addMonths(cur, i - 3)).map((m) => (
        <Link key={m} href={`/settings?tab=${tabKey}&m=${m.slice(0, 7)}${tabKey === "stores" && typeof ctx.sp.tc === "string" ? `&tc=${ctx.sp.tc}` : ""}`}
          className={cn("rounded-full border px-2.5 py-1 text-[12px]", m === monthParam ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-zinc-600 hover:border-brand-300", m > cur && m !== monthParam && "border-dashed")}>
          {mLabel(m)}{m === cur ? " · now" : m > cur ? " · upcoming" : ""}
        </Link>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (tab === "targets") {
    // financial year Apr–Mar
    const fyStart = typeof ctx.sp.fy === "string" && /^\d{4}$/.test(ctx.sp.fy) ? `${ctx.sp.fy}-04-01` : Number(cur.slice(5, 7)) >= 4 ? `${cur.slice(0, 4)}-04-01` : `${Number(cur.slice(0, 4)) - 1}-04-01`;
    const months = Array.from({ length: 12 }, (_, i) => addMonths(fyStart, i));
    const [targets, facts, uc] = await Promise.all([
      listMonthTargets(months[0], months[11]),
      getFacts({ from: months[0], to: ctx.asOf < months[0] ? months[0] : ctx.asOf }, cats.map((c) => c.key)).catch(() => []),
      getChannelDaily({ from: months[0], to: ctx.asOf < months[0] ? months[0] : ctx.asOf }).catch(() => []),
    ]);
    const values: Record<string, number | null> = {};
    for (const t of targets) values[`${t.channel}|${t.category}|${t.month}`] = t.target;
    const actuals: Record<string, number> = {};
    for (const m of months.filter((x) => x <= cur)) for (const c of cats) {
      const f = facts.filter((x) => x.c === c.key), u = uc.filter((x) => x.c === c.key);
      const r = { from: m, to: m === cur ? ctx.asOf : endOfMonth(m) };
      for (const k of ["stores", "online", "marketplace"] as ChKey[]) actuals[`${k}|${c.key}|${m}`] = channelMetrics(f, u, r, k).revenue;
    }
    const fy = Number(fyStart.slice(0, 4));
    const upcomingMissing = months.filter((m) => m > cur && m <= addMonths(cur, 2)).flatMap((m) => cats.flatMap((c) => (["stores", "online", "marketplace"] as const).filter((k) => values[`${k}|${c.key}|${m}`] == null).map((k) => `${mLabel(m)} · ${c.label} · ${k}`)));
    body = (
      <>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {[fy - 1, fy, fy + 1].map((y) => <Link key={y} href={`/settings?tab=targets&fy=${y}`} className={cn("rounded-full border px-2.5 py-1 text-[12px]", y === fy ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-zinc-600 hover:border-brand-300")}>FY {String(y).slice(2)}-{String(y + 1).slice(2)}</Link>)}
          <span className="text-[11.5px] text-zinc-500">Month targets by channel and category · the FY 26-27 plan was loaded from the business plan sheet; edit anything here</span>
        </div>
        {upcomingMissing.length > 0 && <div className="mb-3"><DataPrompt compact title={`${upcomingMissing.length} upcoming target${upcomingMissing.length > 1 ? "s" : ""} not set (next 2 months)`}>{upcomingMissing.slice(0, 8).join(" · ")}{upcomingMissing.length > 8 ? " …" : ""}</DataPrompt></div>}
        <MonthTargetGrid months={months} cats={catOpts} values={values} actuals={actuals} current={cur} readOnly={ro} />
        <Notice><b>How targets are used.</b> Stores = “Offline” in the plan. The Stores target is always this plan figure — store targets (Snowflake or uploaded) only spread it across stores and days, and a mismatch is flagged. Each month target is phased by the daily split (Daily split tab), else by the shape of the store targets, else evenly. Slices without a target are never inferred; a target of 0 is kept as a deliberate 0. Targets and actuals are both gross sales (before returns): DSR SALES for Perfumes / Shoes, store sales lines for other categories, Unicommerce selling price online.</Notice>
      </>
    );
  } else if (tab === "split") {
    const days = eachDay(monthParam, endOfMonth(monthParam));
    const [rows, facts, uc] = await Promise.all([
      listSplits(monthParam),
      getFacts({ from: addDays(ctx.asOf, -55), to: ctx.asOf }, cats.map((c) => c.key)).catch(() => []),
      getChannelDaily({ from: addDays(ctx.asOf, -55), to: ctx.asOf }).catch(() => []),
    ]);
    const saved: Record<string, Record<string, number>> = {};
    for (const r of rows) (saved[`${r.channel}|${r.state}`] ??= {})[r.day] = r.weight;
    // weekday pattern of actual sales over the last 8 weeks
    const wd = (d: string) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
    const sug: Record<ChKey, number[]> = { stores: Array(7).fill(0), online: Array(7).fill(0), marketplace: Array(7).fill(0) };
    for (const f of facts) if (f.d >= addDays(ctx.asOf, -55)) sug.stores[wd(f.d)] += f.s;
    for (const r of uc) { const k = ucChannel(r.mp); if (k) sug[k][wd(r.d)] += r.revenue; }
    for (const k of Object.keys(sug) as ChKey[]) { const t = sug[k].reduce((a, x) => a + x, 0) || 1; sug[k] = sug[k].map((x) => x / t); }
    const states = [...new Set(ctx.stores.map((s) => s.state).filter(Boolean) as string[])].sort();
    body = (
      <>
        {monthNav("split")}
        <SplitEditor key={monthParam} month={monthParam} days={days} states={states} saved={saved} suggested={sug} readOnly={ro} />
        <Notice>Upload format: <span className="font-mono">date,weight_pct</span> for the selected channel / state, one row per day. Use state-level splits for Stores where festivals differ by region (e.g. Onam in Kerala); stores in states without their own split use All India.</Notice>
      </>
    );
  } else if (tab === "stores") {
    const cat = cats.find((c) => c.key === ctx.sp.tc)?.key ?? cats[0].key;
    const [facts, book, inv] = await Promise.all([
      getFacts({ from: addDays(monthParam, -60) < addDays(ctx.asOf, -60) ? addDays(monthParam, -60) : addDays(ctx.asOf, -60), to: endOfMonth(monthParam) }, [cat]),
      getTargetBook(monthParam), getStoreInventory([]).catch(() => []),
    ]);
    const me = endOfMonth(monthParam);
    const invBy = new Map<string, number>();
    for (const r of inv) if (r.cat && CATEGORIES.find((c) => c.key === cat)?.salesCategory.toLowerCase() === r.cat.toLowerCase()) invBy.set(r.b, (invBy.get(r.b) ?? 0) + r.units);
    const uploaded = new Map(book.stores.filter((t) => t.category === cat && t.month === monthParam).map((t) => [t.branch_code, t.target]));
    const rows: StoreTargetRow[] = ctx.stores.map((s) => {
      const fs = facts.filter((f) => f.b === s.branch_code);
      const snow = fs.filter((f) => f.d >= monthParam && f.d <= me).reduce((a, f) => a + (f.st ?? 0), 0);
      const sold60 = fs.some((f) => f.d >= addDays(ctx.asOf, -60) && f.d <= ctx.asOf && f.s > 0);
      const mtd = fs.filter((f) => f.d >= monthParam && f.d <= (ctx.asOf < me ? ctx.asOf : me)).reduce((a, f) => a + f.s, 0);
      return { branch_code: s.branch_code, store: s.short_name, city: s.city, state: s.state, uploaded: uploaded.get(s.branch_code) ?? null, snowflake: snow, mtd, live: (invBy.get(s.branch_code) ?? 0) > 0 || sold60 };
    }).filter((r) => r.live || r.uploaded != null || r.snowflake > 0).sort((a, b) => Number(b.live) - Number(a.live) || b.mtd - a.mtd);
    body = (
      <>
        {monthNav("stores")}
        <div className="mb-3 flex flex-wrap gap-1">{cats.map((c) => <Link key={c.key} href={`/settings?tab=stores&m=${monthParam.slice(0, 7)}&tc=${c.key}`} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]", c.key === cat ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-zinc-600 hover:border-brand-300")}><span className="size-1.5 rounded-full" style={{ background: c.key === cat ? "#fff" : c.color }} />{c.label}</Link>)}</div>
        {!CATEGORIES.find((c) => c.key === cat)?.dsrTable && <div className="mb-3"><DataPrompt compact title={`${catLabel(cat)} has no Snowflake store targets`}>Upload store targets here (CSV: branch_code, category, month, target), or rely on the category Stores target, which is phased at category level.</DataPrompt></div>}
        <StoreTargetEditor key={`${cat}-${monthParam}`} month={monthParam} cat={cat} catLabel={catLabel(cat)} cats={catOpts} rows={rows} categoryTarget={book.month("stores", [cat], monthParam)} readOnly={ro} />
      </>
    );
  } else if (tab === "attributes") {
    const ps = (await getProducts()).filter((p) => p.category && cats.some((c) => c.key === p.category) && ((p.sales.all ?? 0) > 0 || (p.invOffline ?? 0) > 0));
    const cov = cats.map((c) => {
      const xs = ps.filter((p) => p.category === c.key);
      return { c, n: xs.length, image: xs.filter((p) => p.image).length, l1: xs.filter((p) => p.l1).length, colour: xs.filter((p) => p.attrs.colour).length, attrs: xs.filter((p) => Object.keys(p.attrs).length >= 3).length };
    });
    const missing = ps.map((p) => ({ sku: p.sku, name: p.name ?? p.sku, category: catLabel(p.category!), gaps: [!p.image && "image", !p.l1 && "type (L1)", !p.attrs.colour && "colour"].filter(Boolean) as string[] })).filter((m) => m.gaps.length);
    body = (
      <>
        <Section title="Metafield coverage" tip="Products with sales or store stock" right={<MetaUpload missing={missing} />}>
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-[11px] text-zinc-500">{["Category", "Products", "Image", "Type (L1)", "Colour", "≥3 attributes"].map((h, i) => <th key={h} className={`pb-1.5 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>{cov.map((r) => (
              <tr key={r.c.key} className="border-t border-brand-50">
                <td className="py-1.5"><span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: catColor(r.c.key) }} />{r.c.label}</span></td>
                <td className="tabular text-right">{r.n}</td>
                {[r.image, r.l1, r.colour, r.attrs].map((v, i) => <td key={i} className="text-right"><Pill tone={!r.n ? "muted" : v / r.n >= 0.9 ? "good" : v / r.n >= 0.5 ? "warn" : "bad"}>{r.n ? Math.round((100 * v) / r.n) : 0}%</Pill></td>)}
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-zinc-500">Sources: GS_LONGTAIL_METAFIELD (L1 / L2, image), the Longtail Metafields workbook (shoe attributes; L1 / L2 not taken from it), and uploads here (win over both). Perfumes carry names only.</p>
        </Section>
        {missing.length > 0 && (
          <div className="mt-3"><Section title={`Products with gaps · ${missing.length}`} pad={false}>
            <div className="max-h-[420px] overflow-y-auto scroll-thin"><table className="w-full text-[12.5px]"><tbody>{missing.slice(0, 300).map((m) => (
              <tr key={m.sku} className="border-b border-brand-50"><td className="px-4 py-1.5"><Link href={`/products/${encodeURIComponent(m.sku)}`} className="font-medium hover:underline">{m.name}</Link> <span className="font-mono text-[10.5px] text-zinc-400">{m.sku}</span></td><td className="px-4 text-zinc-500">{m.category}</td><td className="px-4 text-right">{m.gaps.map((g) => <Pill key={g} tone="warn" className="ml-1">{g}</Pill>)}</td></tr>
            ))}</tbody></table></div>
          </Section></div>
        )}
      </>
    );
  } else if (tab === "users") {
    const users = dbConfigured()
      ? await q<{ username: string; name: string | null; role: string; active: boolean; has_password: boolean; last_seen_at: string | null; created_by: string | null }>(
          "select username, name, role, active, password_hash is not null has_password, last_seen_at::text, created_by from app_users order by role, username")
      : [];
    body = (<>{ro && <Notice tone="warn">DATABASE_URL is not configured — users can’t be managed.</Notice>}<UsersForm users={users} me={ctx.user!.username} readOnly={ro} /></>);
  } else if (tab === "rules") {
    const [fresh, ucTs] = await Promise.all([getFreshness(), channelFreshness()]);
    const book = ruleBook(ctx.settings);
    body = (
      <>
        <Section title="Rule book" tip="What each rule does, where it applies and the value in force" pad={false}>
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["Area", "Rule", "Where it applies", "Value", "Why"].map((h) => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>{book.map((r) => (
              <tr key={r.name} className="border-b border-brand-50 align-top"><td className="px-4 py-2"><Pill tone="info">{r.group}</Pill></td><td className="px-4 py-2 font-medium">{r.name}</td><td className="px-4 py-2 text-zinc-600">{r.where}</td><td className="px-4 py-2 font-medium text-brand-800">{r.value}</td><td className="px-4 py-2 text-zinc-500">{r.why}</td></tr>
            ))}</tbody>
          </table>
        </Section>
        <div className="mt-3"><SettingsForm initial={ctx.settings} categories={CATEGORIES.map((c) => ({ key: c.key, label: c.label, source: c.source }))} readOnly={ro} /></div>
        <div className="mt-3 grid gap-3 xl:grid-cols-[1.4fr_1fr]">
          <Section title="Tables used" pad={false}>
            <table className="w-full text-[12.5px]"><tbody>{TABLES.map((t) => <tr key={t.table} className="border-b border-brand-50 align-top"><td className="px-4 py-2 font-mono text-[11.5px] text-brand-800">{t.table}</td><td className="px-4 py-2 text-zinc-700">{t.use}</td><td className="px-4 py-2 text-[11.5px] text-zinc-500">{t.grain}</td></tr>)}</tbody></table>
          </Section>
          <Section title="Source freshness">
            <ul className="space-y-1 text-[12px]">
              {Object.entries(fresh.tables).map(([k, v]) => <li key={k} className="flex justify-between"><span className="font-mono text-zinc-600">{k}</span><span>{new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span></li>)}
              <li className="flex justify-between"><span className="font-mono text-zinc-600">UNICOMMERCE_FACT_ITEMS (latest item)</span><span>{ucTs ?? "—"}</span></li>
            </ul>
          </Section>
        </div>
      </>
    );
  } else {
    const log = await changeLog(200);
    body = (
      <Section title="Change log" tip="Every change made in the Control Centre and other admin actions" pad={false}>
        {!log.length ? <div className="p-6 text-center text-[12.5px] text-zinc-500">No changes yet.</div> : (
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-line text-[11px] text-zinc-500">{["When", "Who", "What", "Details"].map((h) => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>{log.map((l) => (
              <tr key={l.id} className="border-b border-brand-50 align-top">
                <td className="whitespace-nowrap px-4 py-2 text-zinc-500">{new Date(l.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                <td className="px-4 py-2 font-medium">{l.actor}</td>
                <td className="px-4 py-2"><Pill tone={l.action === "upload" ? "info" : l.action === "delete" ? "bad" : "muted"}>{l.action}</Pill> <span className="text-zinc-700">{l.entity.replace(/_/g, " ")}</span>{l.entity_id ? <span className="text-zinc-400"> · {l.entity_id.slice(0, 20)}</span> : null}</td>
                <td className="max-w-[560px] px-4 py-2 text-[11.5px] text-zinc-600">{describe(l.entity, l.detail)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Section>
    );
  }
  const tabs = [
    { key: "targets", label: "Month targets" }, { key: "split", label: "Daily split" }, { key: "stores", label: "Store targets" }, { key: "attributes", label: "Product attributes" },
    { key: "users", label: "Users & access" }, { key: "rules", label: "Rules & data" }, { key: "log", label: "Change log" },
  ].map((t) => ({ ...t, href: withQs(ctx, "/settings", { tab: t.key === "targets" ? null : t.key, m: null, tc: null, fy: null }) }));
  return (
    <>
      <PageHeader title="Control Centre" subtitle={<>Targets, phasing, store targets, product attributes, access and rules · data to {fmtDate(ctx.asOf, true)}</>} />
      <Tabs active={tab} tabs={tabs} />
      {ro && tab !== "rules" && tab !== "log" && <Notice tone="warn">PostgreSQL isn’t connected — the Control Centre is read-only.</Notice>}
      {body}
    </>
  );
}

function describe(entity: string, d: unknown): string {
  const x = (d ?? {}) as Record<string, unknown>;
  if (entity === "month_targets" && Array.isArray(x.changes)) {
    const ch = x.changes as { channel: string; category: string; month: string; from: number | null; to: number | null }[];
    const l = (v: number | null) => (v == null ? "—" : `${(v / 1e5).toFixed(2).replace(/\.?0+$/, "")}L`);
    return ch.slice(0, 6).map((c) => `${c.channel} · ${catLabel(c.category)} · ${c.month.slice(0, 7)}: ${l(c.from)} → ${l(c.to)}`).join("; ") + (ch.length > 6 ? `; +${ch.length - 6} more` : "");
  }
  if (entity === "day_splits") return `${x.channel} · ${x.state === "*" ? "All India" : x.state} · ${String(x.month).slice(0, 7)} · ${x.cleared ? "cleared (even phasing)" : `${x.days} days set`}`;
  if (entity === "store_month_targets") return `${x.rows} store targets · ${(x.categories as string[] | undefined)?.map(catLabel).join(", ")} · ${(x.months as string[] | undefined)?.map((m) => m.slice(0, 7)).join(", ")}`;
  return JSON.stringify(d ?? {}).slice(0, 220);
}
