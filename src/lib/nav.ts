export interface NavItem { href: string; label: string; minRole?: "admin" }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: "Performance", items: [
    { href: "/", label: "Executive Overview" },
    { href: "/performance/daily", label: "Daily" },
    { href: "/performance/weekly", label: "Weekly" },
    { href: "/performance/mtd", label: "MTD" },
  ] },
  { label: "Stores", items: [
    { href: "/stores", label: "Store Performance" },
    { href: "/stores/matrix", label: "Store × Category" },
    { href: "/stores/sku", label: "Store × SKU" },
  ] },
  { label: "Products", items: [
    { href: "/products/skus", label: "SKU Performance" },
    { href: "/products/bible", label: "SKU Bible" },
    { href: "/products/categories", label: "Category Performance" },
    { href: "/products/ai", label: "AI Bot" },
  ] },
  { label: "Targets", items: [
    { href: "/targets", label: "Target Overview" },
    { href: "/targets/stores", label: "Store Targets" },
    { href: "/targets/daily", label: "Daily Targets" },
    { href: "/targets/weekly", label: "Weekly Targets" },
    { href: "/targets/setup", label: "Target Setup", minRole: "admin" },
  ] },
  { label: "Action Centre", items: [
    { href: "/exceptions", label: "Stores to Act On" },
    { href: "/exceptions/skus", label: "SKUs to Act On" },
    { href: "/exceptions/targets", label: "Target Misses" },
    { href: "/exceptions/zero-sale", label: "Zero-Sale Stores" },
  ] },
  { label: "Admin", items: [
    { href: "/admin/settings", label: "Settings", minRole: "admin" },
    { href: "/admin/users", label: "Users & Access", minRole: "admin" },
  ] },
];

/** Which global filter groups apply on a route. */
export function filterScope(path: string) {
  if (path.startsWith("/admin") || path.startsWith("/targets/setup") || path.startsWith("/products/ai")) return { date: false, store: false, sku: false };
  if (path.startsWith("/products/bible")) return { date: false, store: false, sku: true };
  const sku = path.startsWith("/products") || path.startsWith("/stores/sku") || path.startsWith("/exceptions/skus");
  return { date: true, store: true, sku };
}
