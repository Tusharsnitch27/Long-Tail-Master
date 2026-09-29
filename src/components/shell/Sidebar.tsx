"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Gauge, LayoutGrid, Sparkles, Layers, Split, Store, Globe, ShoppingBag, Boxes, Zap, Settings, LogOut, ChevronsUpDown } from "lucide-react";
import { NAV, NAV_BOTTOM } from "@/lib/nav";
import { cn } from "@/lib/cn";

const ICONS = { executive: Gauge, overview: LayoutGrid, mitra: Sparkles, category: Layers, channels: Split, stores: Store, online: Globe, marketplace: ShoppingBag, merchandising: Boxes, actions: Zap, settings: Settings } as const;
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
    const Icon = ICONS[i.icon as keyof typeof ICONS];
    const on = active(i.href);
    return (
      <Link key={i.href} href={qs && i.href !== "/settings" ? `${i.href}?${qs}` : i.href}
        className={cn("group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
          on ? "bg-white font-medium text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgba(17,17,20,.04)]" : "text-zinc-600 hover:bg-white/70 hover:text-ink")}>
        <Icon className={cn("size-[15px] shrink-0", on ? "text-brand-500" : "text-zinc-400 group-hover:text-zinc-600")} strokeWidth={1.9} />
        <span className="flex-1 truncate whitespace-nowrap" title={i.label}>{i.label}</span>
        {i.href === "/actions" && actionCount ? <span className="tabular rounded bg-rose-50 px-1.5 text-[10.5px] font-semibold text-rose-700">{actionCount}</span> : null}
      </Link>
    );
  };
  return (
    <nav className="flex h-full flex-col px-3 py-4">
      <Link href={qs ? `/?${qs}` : "/"} className="mb-6 flex items-center gap-2 px-1.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-[12px] font-bold text-white">CM</span>
        <span className="leading-tight"><span className="block text-[13.5px] font-semibold tracking-tight">Category Mitra</span><span className="block text-[10.5px] text-zinc-500">Snitch</span></span>
      </Link>
      <div className="space-y-0.5">{NAV.slice(0, 3).map(item)}</div>
      <div className="mb-1 mt-4 px-2.5 text-[10.5px] font-medium uppercase tracking-wider text-zinc-400">Analyse</div>
      <div className="space-y-0.5">{NAV.slice(3, 9).map(item)}</div>
      <div className="mb-1 mt-4 px-2.5 text-[10.5px] font-medium uppercase tracking-wider text-zinc-400">Act</div>
      <div className="space-y-0.5">{NAV.slice(9).map(item)}</div>
      <div className="mt-auto space-y-0.5 pt-4">
        {NAV_BOTTOM.filter((i) => !i.minRole || role === "admin").map(item)}
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-white/70">
            <span className="flex size-6 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-semibold text-zinc-700">{name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[12.5px] font-medium">{name}</span><span className="block text-[10.5px] capitalize text-zinc-500">{role}</span></span>
            <ChevronsUpDown className="size-3.5 text-zinc-400" />
          </button>
          {menu && (
            <div className="absolute bottom-11 left-0 z-50 w-full rounded-lg border border-line bg-white p-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
              <div className="px-2 py-1.5 text-[11.5px] text-zinc-500">Signed in as <b className="font-medium text-zinc-700">{username}</b></div>
              <a href="/api/auth/logout" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"><LogOut className="size-3.5" />Sign out</a>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
