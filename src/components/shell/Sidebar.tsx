"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Gauge, CalendarDays, Sparkles, Layers, Package, Split, Store, Globe, ShoppingBag, Boxes, Zap, Settings, LogOut, ChevronsUpDown, FlaskConical, Paintbrush, LineChart, Truck, Megaphone } from "lucide-react";
import { NAV, NAV_GROUPS, APP_NAME } from "@/lib/nav";
import { cn } from "@/lib/cn";

const ICONS = {
  executive: Gauge, overview: CalendarDays, mitra: Sparkles, category: Layers, products: Package, channels: Split, stores: Store, online: Globe, marketplace: ShoppingBag,
  merchandising: Boxes, actions: Zap, vm: Paintbrush, lab: FlaskConical, settings: Settings, planning: LineChart, inwards: Truck, ads: Megaphone,
} as const;
// Global context carried across sections (page-local params like tab/sort are dropped).
const CARRY = ["cat", "p", "from", "to", "ch", "mp"];

export function Sidebar({ role, name, username, actionCount }: { role: "viewer" | "admin"; name: string; username: string; actionCount?: number }) {
  const path = usePathname();
  const sp = useSearchParams();
  const [menu, setMenu] = useState(false);
  const carried = new URLSearchParams();
  for (const k of CARRY) { const v = sp.get(k); if (v) carried.set(k, v); }
  const qs = carried.toString();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  const item = (i: (typeof NAV)[number]) => {
    const Icon = ICONS[i.icon as keyof typeof ICONS] ?? Layers;
    const on = active(i.href);
    return (
      <Link key={i.href} href={qs && !["/settings", "/ads"].includes(i.href) ? `${i.href}?${qs}` : i.href}
        className={cn("group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
          on ? "bg-white/12 font-medium text-white shadow-[inset_2px_0_0_#5cc0c7]" : "text-brand-100/75 hover:bg-white/6 hover:text-white")}>
        <Icon className={cn("size-[15px] shrink-0", on ? "text-brand-300" : "text-brand-100/50 group-hover:text-brand-100")} strokeWidth={1.9} />
        <span className="flex-1 truncate whitespace-nowrap" title={i.label}>{i.label}</span>
        {i.href === "/actions" && actionCount ? <span className="tabular rounded bg-rose-500/90 px-1.5 text-[10.5px] font-semibold text-white">{actionCount}</span> : null}
        {i.badge && <span className={cn("rounded px-1 text-[9.5px] font-semibold tracking-wide", i.badge === "AI" ? "bg-brand-400 text-brand-900" : "bg-white/10 text-brand-100/70")}>{i.badge}</span>}
      </Link>
    );
  };
  const visible = NAV.filter((i) => !i.minRole || role === "admin");
  return (
    <nav className="flex h-full flex-col overflow-y-auto bg-side px-3 py-4 scroll-thin">
      <Link href={qs ? `/?${qs}` : "/"} className="mb-5 flex items-center gap-2.5 px-1.5">
        <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300 to-brand-500 text-white shadow-[0_4px_14px_rgba(92,192,199,.35)]">
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17c4-1 7-4 9-9 1 3 3 6 9 7" /><path d="M12 8V3" /><path d="m9 6 3-3 3 3" /></svg>
        </span>
        <span className="leading-tight"><span className="block text-[14px] font-semibold tracking-tight text-white">{APP_NAME}</span><span className="block text-[10.5px] tracking-[0.3em] text-brand-200/70">SNITCH</span></span>
      </Link>
      {NAV_GROUPS.map((g) => {
        const items = visible.filter((i) => i.group === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key} className={g.label ? "mt-4" : ""}>
            {g.label && <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-100/40">{g.label}</div>}
            <div className="space-y-0.5">{items.map(item)}</div>
          </div>
        );
      })}
      <div className="mt-auto pt-4">
        <div className="relative flex items-center gap-1.5">
          <button onClick={() => setMenu((m) => !m)} className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-white/5 px-2 text-left hover:bg-white/10">
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-400 text-[11.5px] font-semibold text-brand-900">{name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[12.5px] font-medium text-white">{name}</span><span className="block text-[10.5px] capitalize text-brand-100/60">{role}</span></span>
            <ChevronsUpDown className="size-3.5 text-brand-100/50" />
          </button>
          <a href="/api/auth/logout" title="Log out" aria-label="Log out" className="flex h-11 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-brand-100/70 hover:bg-rose-500/80 hover:text-white"><LogOut className="size-4" /></a>
          {menu && (
            <div className="absolute bottom-12 left-0 z-50 w-full rounded-lg border border-line bg-white p-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
              <div className="px-2 py-1.5 text-[11.5px] text-zinc-500">Signed in as <b className="font-medium text-zinc-700">{username}</b></div>
              <a href="/api/auth/logout" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"><LogOut className="size-3.5" />Log out</a>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
