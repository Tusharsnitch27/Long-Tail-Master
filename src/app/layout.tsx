import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Sidebar } from "@/components/shell/Sidebar";
import { MobileNav } from "@/components/shell/MobileNav";
import { FilterBar, type FilterOptions } from "@/components/filters/FilterBar";
import { getUser, AuthError } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { getFreshness } from "@/server/data/freshness";
import { getStores } from "@/server/data/stores";
import { CATEGORIES } from "@/lib/categories";
import { STORE_DIMS } from "@/lib/filters";
import { fmtDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Long-Tail Ops · Snitch", description: "Perfumes & Shoes store performance, targets and SKU tracking" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await getUser();
  } catch (e) {
    return <Gate title="Access disabled" body={e instanceof AuthError ? e.message : "Unable to verify your access."} />;
  }
  if (!user) return <Gate title="Sign-in required" body="Open this tool through Snitch SSO (Cloudflare Access) with your @snitch.com account." />;

  let options: FilterOptions | null = null;
  let fresh: Awaited<ReturnType<typeof getFreshness>> | null = null;
  let loadError: string | null = null;
  try {
    const [settings, f, stores] = await Promise.all([getSettings(), getFreshness(), getStores()]);
    fresh = f;
    const dims: Record<string, string[]> = {};
    for (const d of STORE_DIMS) {
      dims[d.key] = Array.from(new Set(stores.map((s) => s[d.field as keyof typeof s]).filter(Boolean) as string[])).sort();
    }
    options = {
      cats: CATEGORIES.filter((c) => settings.enabledCategories.includes(c.key)).map((c) => ({ key: c.key, label: c.label, color: c.color })),
      stores: stores.map((s) => ({ value: s.branch_code, label: s.short_name, hint: s.city ?? undefined })),
      dims,
      asOf: f.asOf,
      today: f.today,
    };
  } catch (e) {
    console.error("[layout] data source error", e);
    loadError = e instanceof Error ? e.message : String(e);
  }

  const refreshed = fresh?.refreshedAt
    ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(fresh.refreshedAt))
    : null;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-[208px] shrink-0 border-r border-zinc-200 bg-white md:block">
        <Suspense><Sidebar role={user.role} /></Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 text-[12px] text-zinc-500">
          <div className="flex items-center gap-3">
            <Suspense><MobileNav role={user.role} /></Suspense>
            <span className="font-semibold text-zinc-800 md:hidden">Long-Tail Ops</span>
            {fresh && (
              <span className="hidden items-center gap-1.5 sm:flex">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Complete data to <b className="font-medium text-zinc-700">{fmtDate(fresh.asOf, true)}</b>
                {refreshed && <> · Snowflake refreshed {refreshed} IST</>}
              </span>
            )}
          </div>
          <span className="truncate">{user.email} · <span className="capitalize">{user.role}</span></span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {options && <Suspense><FilterBar options={options} /></Suspense>}
          <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-5">
            {loadError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-[13px] text-rose-900">
                <div className="font-semibold">Could not reach Snowflake</div>
                <div className="mt-1 font-mono text-[12px]">{loadError}</div>
                <div className="mt-2">Check SNOWFLAKE_* environment variables and network access, then reload.</div>
              </div>
            ) : children}
          </div>
        </main>
      </div>
    </div>
  );
}

function Gate({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-dvh items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-zinc-200 bg-white p-6 text-center">
        <div className="text-[15px] font-semibold">{title}</div>
        <p className="mt-2 text-[13px] text-zinc-600">{body}</p>
      </div>
    </div>
  );
}
