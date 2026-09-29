export interface NavItem { href: string; label: string; icon: string; minRole?: "admin" }

// Each page answers one management question (see docs/CATEGORY_MITRA.md).
export const NAV: NavItem[] = [
  { href: "/", label: "Executive Summary", icon: "executive" },
  { href: "/overview", label: "Overview", icon: "overview" },
  { href: "/mitra", label: "Mitra", icon: "mitra" },
  { href: "/category", label: "Category Overview", icon: "category" },
  { href: "/channels", label: "Channel Overview", icon: "channels" },
  { href: "/stores", label: "Store Overview", icon: "stores" },
  { href: "/online", label: "Online Overview", icon: "online" },
  { href: "/marketplace", label: "Marketplace Overview", icon: "marketplace" },
  { href: "/merchandising", label: "Merchandising Overview", icon: "merchandising" },
  { href: "/actions", label: "Action Centre", icon: "actions" },
];
export const NAV_BOTTOM: NavItem[] = [{ href: "/settings", label: "Settings", icon: "settings", minRole: "admin" }];

/** Which global context controls a route shows (channel only where it is a real choice). */
export function filterScope(path: string) {
  if (path.startsWith("/mitra") || path.startsWith("/settings")) return { category: false, period: false, channel: false };
  if (path.startsWith("/actions") || path.startsWith("/merchandising")) return { category: true, period: false, channel: false };
  // Executive Summary has its own in-page channel control
  if (path === "/") return { category: true, period: true, channel: false };
  if (path.startsWith("/overview") || path.startsWith("/category") || path.startsWith("/products")) return { category: true, period: true, channel: true };
  return { category: true, period: true, channel: false };
}
