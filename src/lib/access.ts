/**
 * Roles and what each may see. Shared by server and client.
 *  superadmin  — everything, the only role that can download (one person; set by SUPERADMIN_USERNAMES, never via the UI)
 *  admin       — everything incl. Control Centre / Admin Lab, no downloads
 *  viewer      — all analytics pages, no admin, no downloads
 *  store_actions  — store data only, no ₹ revenue / GP (percentages, units, discount); Online / Marketplace only as action insights
 *  online_actions — Online / Marketplace / Qcom data, no store data (stores only as action insights)
 *  designer    — product and category views without ₹ revenue or GP
 */
export type Role = "superadmin" | "admin" | "viewer" | "store_actions" | "online_actions" | "designer";
export const ASSIGNABLE_ROLES = ["admin", "viewer", "store_actions", "online_actions", "designer"] as const;
export const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super admin", admin: "Admin", viewer: "Viewer", store_actions: "Store actions", online_actions: "Online actions", designer: "Designer",
};
export const ROLE_HINT: Record<Role, string> = {
  superadmin: "Everything, including downloads", admin: "Everything except downloads", viewer: "All analytics, no admin, no downloads",
  store_actions: "Store pages and actions; no revenue or GP numbers; no Online / Marketplace pages",
  online_actions: "Online, Marketplace, Qcom and actions; no store pages",
  designer: "Products and categories without revenue or GP numbers",
};

export interface Access {
  role: Role; admin: boolean; download: boolean;
  revenue: boolean; gp: boolean;
  stores: boolean; online: boolean; marketplace: boolean; qcom: boolean; harvey: boolean;
}
export function accessFor(role: Role): Access {
  const all = { revenue: true, gp: true, stores: true, online: true, marketplace: true, qcom: true, harvey: true };
  switch (role) {
    case "superadmin": return { role, admin: true, download: true, ...all };
    case "admin": return { role, admin: true, download: false, ...all };
    case "viewer": return { role, admin: false, download: false, ...all };
    case "store_actions": return { role, admin: false, download: false, revenue: false, gp: false, stores: true, online: false, marketplace: false, qcom: false, harvey: false };
    case "online_actions": return { role, admin: false, download: false, revenue: true, gp: true, stores: false, online: true, marketplace: true, qcom: true, harvey: false };
    case "designer": return { role, admin: false, download: false, revenue: false, gp: false, stores: true, online: true, marketplace: true, qcom: true, harvey: false };
  }
}

/** Pages each restricted role may open (prefix match). Unrestricted roles see everything not admin-only. */
const PAGES: Partial<Record<Role, string[]>> = {
  store_actions: ["/stores", "/actions", "/vm"],
  online_actions: ["/online", "/marketplace", "/qcom", "/actions"],
  designer: ["/products", "/category", "/actions"],
};
const ADMIN_ONLY = ["/settings", "/lab"];
export function canOpen(role: Role, path: string) {
  if (path === "/no-access") return true;
  const a = accessFor(role);
  if (ADMIN_ONLY.some((p) => path === p || path.startsWith(p + "/"))) return a.admin;
  const allowed = PAGES[role];
  if (!allowed) return true;
  return allowed.some((p) => path === p || path.startsWith(p + "/"));
}
/** Where a role lands after sign-in / when opening "/". */
export const homeFor = (role: Role) => (PAGES[role]?.[0] ?? "/");
