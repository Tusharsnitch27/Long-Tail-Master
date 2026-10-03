"use client";
import { createContext, useContext } from "react";
import { accessFor, type Access } from "@/lib/access";

/** What the signed-in user may see and do in the browser (downloads: super admin only; revenue / GP / channels by role). */
const Ctx = createContext<Access>(accessFor("viewer"));
export function PermissionsProvider({ access, children }: { access: Access; children: React.ReactNode }) {
  return <Ctx.Provider value={access}>{children}</Ctx.Provider>;
}
export const useAccess = () => useContext(Ctx);
export const useCanDownload = () => useContext(Ctx).download;
