"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Gauge, CalendarDays, Sparkles, Layers, Package, Split, Store, Globe, ShoppingBag, Boxes, Zap, Settings, LogOut, ChevronsUpDown, FlaskConical, Paintbrush, LineChart, Truck, Megaphone } from "lucide-react";
import { NAV, NAV_GROUPS, APP_NAME } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { accessFor, canOpen, ROLE_LABEL, type Role } from "@/lib/access";

const ICONS = {
  executive: Gauge, overview: CalendarDays, harvey: Sparkles, category: Layers, products: Package, channels: Split, stores: Store, online: Globe, marketplace: ShoppingBag, qcom: Zap,
  merchandising: Boxes, actions: Zap, vm: Paintbrush, lab: FlaskConical, settings: Settings, planning: LineChart, inwards: Truck, ads: Megaphone,
} as const;
// Global context carried across sections (page-local params like tab/sort are dropped).
const CARRY = ["cat", "p", "from", "to", "ch", "mp"];

export function Sidebar({ role, name, username, actionCount }: { role: Role; name: string; username: string; actionCount?: number }) {
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
        className={cn("group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-all duration-200",
          on ? "bg-gradient-to-r from-[#c08f60]/25 via-[#c08f60]/10 to-transparent font-medium text-[#f7efe4] shadow-[inset_0_1px_0_rgba(255,255,255,.06)]" : "text-[#f3ebe1]/65 hover:translate-x-0.5 hover:bg-white/[0.05] hover:text-[#f3ebe1]")}>
        {on && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-gradient-to-b from-[#f3dcb8] to-[#a8703f] shadow-[0_0_10px_rgba(211,176,137,.8)]" />}
        <Icon className={cn("size-[15px] shrink-0", on ? "text-brand-300" : "text-[#f3ebe1]/40 group-hover:text-[#f3ebe1]/80")} strokeWidth={1.9} />
        <span className="flex-1 truncate whitespace-nowrap" title={i.label}>{i.label}</span>
        {i.href === "/actions" && actionCount ? <span className="tabular rounded bg-rose-500/90 px-1.5 text-[10.5px] font-semibold text-white">{actionCount}</span> : null}
        {i.badge && <span className={cn("rounded px-1 text-[9.5px] font-semibold tracking-wide", i.badge === "AI" ? "bg-gradient-to-r from-[#f3dcb8] to-[#c08f60] text-brand-900 shadow-[0_0_10px_-2px_rgba(211,176,137,.7)]" : "bg-white/10 text-[#f3ebe1]/60")}>{i.badge}</span>}
      </Link>
    );
  };
  const visible = NAV.filter((i) => canOpen(role, i.href) && (!i.minRole || accessFor(role).admin));
  return (
    <nav className="relative flex h-full flex-col overflow-y-auto bg-side bg-[radial-gradient(460px_300px_at_0%_0%,rgba(192,143,96,.30),transparent_70%),radial-gradient(380px_420px_at_100%_100%,rgba(168,112,63,.16),transparent_70%),linear-gradient(180deg,#261e17_0%,#1b1712_45%,#140f0b_100%)] px-3 py-5 shadow-[inset_-1px_0_0_rgba(211,176,137,.18)] scroll-thin">
      <Link href={qs ? `/?${qs}` : "/"} className="mb-6 block px-2.5 leading-none">
        <span className="block text-[10px] font-semibold tracking-[0.55em] text-[#f3ebe1]/80">SNITCH</span>
        <span className="text-gilded-light mt-1.5 block font-serif text-[28px] italic tracking-[-0.02em]">{APP_NAME}</span>
        <span className="mt-3 block h-px w-24 bg-gradient-to-r from-brand-300/70 to-transparent" />
      </Link>
      {NAV_GROUPS.map((g) => {
        const items = visible.filter((i) => i.group === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key} className={g.label ? "mt-4" : ""}>
            {g.label && <div className="mb-1.5 px-2.5 text-[9.5px] font-semibold uppercase tracking-[0.32em] text-[#f3ebe1]/35">{g.label}</div>}
            <div className="space-y-0.5">{items.map(item)}</div>
          </div>
        );
      })}
      <div className="mt-auto pt-4">
        <div className="relative flex items-center gap-1.5">
          <button onClick={() => setMenu((m) => !m)} className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-white/5 px-2 text-left hover:bg-white/10">
            <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[#f3dcb8] to-[#a8703f] font-serif text-[13px] text-brand-900 shadow-[0_0_0_2px_rgba(243,220,184,.15)]">{name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[12.5px] font-medium text-white">{name}</span><span className="block text-[10.5px] text-[#f3ebe1]/50">{ROLE_LABEL[role]}</span></span>
            <ChevronsUpDown className="size-3.5 text-[#f3ebe1]/40" />
          </button>
          <a href="/api/auth/logout" title="Log out" aria-label="Log out" className="flex h-11 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[#f3ebe1]/60 hover:bg-rose-500/80 hover:text-white"><LogOut className="size-4" /></a>
          {menu && (
            <div className="absolute bottom-12 left-0 z-50 w-full rounded-lg border border-line bg-paper p-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
              <div className="px-2 py-1.5 text-[11.5px] text-zinc-500">Signed in as <b className="font-medium text-zinc-700">{username}</b></div>
              <a href="/api/auth/logout" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"><LogOut className="size-3.5" />Log out</a>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
