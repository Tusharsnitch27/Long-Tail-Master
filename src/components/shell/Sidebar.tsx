"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { SavedViews } from "./SavedViews";

const RANK = { viewer: 0, admin: 1 } as const;
// Filters carried across pages (page-local params like tab/sort are dropped).
const CARRY = ["p", "from", "to", "cat", "store", "region", "state", "city", "om", "sst", "am", "ct", "lt", "ch", "pb"];

export function Sidebar({ role }: { role: keyof typeof RANK }) {
  const path = usePathname();
  const sp = useSearchParams();
  const carried = new URLSearchParams();
  for (const k of CARRY) { const v = sp.get(k); if (v) carried.set(k, v); }
  const qs = carried.toString();
  const all = NAV.flatMap((g) => g.items.map((i) => i.href));
  const best = all.filter((h) => (h === "/" ? path === "/" : path === h || path.startsWith(h + "/"))).sort((a, b) => b.length - a.length)[0];
  const active = (href: string) => href === best;

  return (
    <nav className="flex h-full flex-col overflow-y-auto px-3 py-4 scroll-thin">
      <Link href={qs ? `/?${qs}` : "/"} className="mb-5 block px-2">
        <div className="text-[15px] font-semibold tracking-tight">Long-Tail Ops</div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">Snitch · Offline</div>
      </Link>
      {NAV.map((g) => {
        const items = g.items.filter((i) => RANK[role] >= RANK[i.minRole ?? "viewer"]);
        if (!items.length) return null;
        return (
          <div key={g.label} className="mb-4">
            <div className="mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">{g.label}</div>
            {items.map((i) => (
              <Link key={i.href} href={qs && !i.href.startsWith("/admin") ? `${i.href}?${qs}` : i.href}
                className={cn("block rounded-md px-2 py-1.5 text-[13px]", active(i.href) ? "bg-zinc-900 font-medium text-white" : "text-zinc-700 hover:bg-zinc-100")}>
                {i.label}
              </Link>
            ))}
          </div>
        );
      })}
      <SavedViews />
    </nav>
  );
}
