import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { MobileNav } from "@/components/shell/MobileNav";
import { ContextBar, type ContextOptions } from "@/components/shell/ContextBar";
import { getUser, AuthError, sessionExpiry } from "@/server/auth";
import { SessionTimer } from "@/components/shell/SessionTimer";
import { getSettings } from "@/server/settings";
import { getFreshness } from "@/server/data/freshness";
import { getChannelDaily, channelFreshness } from "@/server/data/channels";
import { getWarehouseStock } from "@/server/data/warehouse";
import { storeInventoryDate } from "@/server/data/inventory";
import { APP_NAME } from "@/lib/nav";
import { getProductMap } from "@/server/data/products";
import { ucChannel } from "@/server/channelData";
import { buildActions } from "@/server/actions";
import { pageContext } from "@/server/context";
import { CATEGORIES } from "@/lib/categories";
import { addDays, fmtDate } from "@/lib/dates";

// every page depends on the signed-in user and live data
export const dynamic = "force-dynamic";

const time = (iso: string | null) => {
  if (!iso) return "—";
  // source timestamps without an offset are IST wall-clock times (never let the server's timezone decide)
  const hasTz = /([+-]\d{2}:?\d{2}|Z)$/.test(iso);
  const d = new Date(hasTz ? iso : iso.replace(" ", "T") + "+05:30");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await getUser();
  } catch (e) {
    redirect(`/login?error=${e instanceof AuthError && e.status === 403 ? "denied" : "session"}`);
  }
  if (!user) redirect("/login");

  let options: ContextOptions | null = null;
  let urgent = 0;
  let loadError: string | null = null;
  try {
    const [settings, fresh] = await Promise.all([getSettings(), getFreshness()]);
    const [uc, ucTs, pm, invDate] = await Promise.all([getChannelDaily({ from: addDays(fresh.asOf, -29), to: fresh.today }), channelFreshness(), getProductMap(), storeInventoryDate().catch(() => null)]);
    const wh = await getWarehouseStock(new Set(pm.keys()));
    // options come from the data: categories with sales in the last 30 days; marketplaces with sales
    const withData = new Set(uc.filter((r) => r.items > 0).map((r) => r.c));
    for (const c of CATEGORIES) if (c.source === "dsr") withData.add(c.key);
    const cats = CATEGORIES.filter((c) => settings.enabledCategories.includes(c.key) && withData.has(c.key));
    const mpsFor = (c: string | null) => {
      const rows = uc.filter((r) => ucChannel(r.mp) === "marketplace" && r.items > 0 && (c ? r.c === c : cats.some((x) => x.key === r.c)));
      const rev = new Map<string, number>(); for (const r of rows) rev.set(r.mp, (rev.get(r.mp) ?? 0) + r.revenue);
      return [...rev.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    };
    options = {
      categories: cats.map((c) => ({ key: c.key, label: c.label, color: c.color })),
      marketplaces: Object.fromEntries([["overall", mpsFor(null)], ...cats.map((c) => [c.key, mpsFor(c.key)])]),
      asOf: fresh.asOf, today: fresh.today,
      freshness: [
        { label: "Store sales", value: `to ${fmtDate(fresh.asOf)}`, tip: `DSR refreshed ${time(fresh.tables.LONG_TAIL_DSR_PERFUMES ?? null)}`, stale: fresh.asOf < addDays(fresh.today, -2) },
        { label: "Online", value: time(ucTs), tip: "Online & Marketplace — latest order item (Unicommerce)" },
        { label: "Inventory", value: time(wh.updated), tip: `Warehouse live ${time(wh.updated)} · store stock ${invDate ? fmtDate(invDate) : "—"} (latest store report)`, stale: !invDate || invDate < addDays(fresh.today, -1) },
      ],
    };
    const ctx = await pageContext(Promise.resolve({}));
    urgent = (await buildActions(ctx)).actions.filter((a) => a.priority === "urgent").length;
  } catch (e) {
    console.error("[layout] data source error", e);
    loadError = e instanceof Error ? e.message : String(e);
  }

  const exp = await sessionExpiry().catch(() => null);
  const nav = { role: user.role, name: user.name, username: user.username, actionCount: urgent };
  return (
    <div className="atelier flex h-dvh overflow-hidden">
      {exp && <SessionTimer exp={exp} />}
      <aside className="hidden w-[236px] shrink-0 md:block">
        <Suspense><Sidebar {...nav} /></Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 items-center gap-3 border-b border-line bg-paper/80 px-4 backdrop-blur md:hidden">
          <Suspense><MobileNav {...nav} /></Suspense>
          <span className="font-serif text-[16px] italic text-brand-500">{APP_NAME}</span>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {options && <Suspense><ContextBar options={options} /></Suspense>}
          <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6">
            {loadError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-[13px] text-rose-900">
                <div className="font-semibold">Could not reach Snowflake</div>
                <div className="mt-1 font-mono text-[12px]">{loadError}</div>
              </div>
            ) : children}
          </div>
        </main>
      </div>
    </div>
  );
}
