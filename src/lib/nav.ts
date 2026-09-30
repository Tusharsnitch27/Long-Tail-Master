export interface NavItem { href: string; label: string; icon: string; minRole?: "admin"; group: "main" | "analyse" | "act" | "admin" | "wip"; badge?: string }

export const APP_NAME = "Snitch Longtail";
export const APP_TAGLINE = "Same style. A bigger universe.";

// Each page answers one management question (see docs/SNITCH_LONGTAIL.md).
export const NAV: NavItem[] = [
  { href: "/", label: "Executive Summary", icon: "executive", group: "main" },
  { href: "/overview", label: "Daily Overview", icon: "overview", group: "main" },
  { href: "/mitra", label: "Mitra", icon: "mitra", group: "main", badge: "AI" },
  { href: "/category", label: "Category Performance", icon: "category", group: "analyse" },
  { href: "/products", label: "Product Master", icon: "products", group: "analyse" },
  { href: "/channels", label: "Channel Overview", icon: "channels", group: "analyse" },
  { href: "/stores", label: "Store Overview", icon: "stores", group: "analyse" },
  { href: "/online", label: "Online", icon: "online", group: "analyse" },
  { href: "/marketplace", label: "Marketplace", icon: "marketplace", group: "analyse" },
  { href: "/merchandising", label: "Merchandising", icon: "merchandising", group: "analyse" },
  { href: "/actions", label: "Action Centre", icon: "actions", group: "act" },
  { href: "/vm", label: "VM Revamp", icon: "vm", group: "act" },
  { href: "/lab", label: "Admin Lab", icon: "lab", group: "admin", minRole: "admin" },
  { href: "/settings", label: "Control Centre", icon: "settings", group: "admin", minRole: "admin" },
  { href: "/planning", label: "Demand Planning", icon: "planning", group: "wip", badge: "WIP" },
  { href: "/inwards", label: "Future Inwards", icon: "inwards", group: "wip", badge: "WIP" },
  { href: "/ads", label: "Ads Spend & Insight", icon: "ads", group: "wip", badge: "Soon" },
];
export const NAV_GROUPS: { key: NavItem["group"]; label: string | null }[] = [
  { key: "main", label: null }, { key: "analyse", label: "Analyse" }, { key: "act", label: "Act" }, { key: "admin", label: "Admin" }, { key: "wip", label: "In the works" },
];

/** Which global context controls a route shows (channel only where it is a real choice). */
export function filterScope(path: string) {
  const none = { category: false, period: false, channel: false };
  if (path.startsWith("/mitra") || path.startsWith("/settings") || path.startsWith("/ads")) return none;
  if (path.startsWith("/actions") || path.startsWith("/merchandising") || path.startsWith("/planning") || path.startsWith("/inwards") || path.startsWith("/vm")) return { category: true, period: false, channel: false };
  if (path === "/" || path.startsWith("/overview") || path.startsWith("/category") || path.startsWith("/products") || path.startsWith("/lab")) return { category: true, period: true, channel: true };
  return { category: true, period: true, channel: false };
}
