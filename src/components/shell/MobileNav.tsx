"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./Sidebar";

export function MobileNav(props: { role: "viewer" | "admin"; name: string; username: string; actionCount?: number }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="md:hidden">
      <button aria-label="Open navigation" onClick={() => setOpen(true)} className="-ml-1 rounded p-1 text-zinc-700 hover:bg-zinc-100"><Menu className="size-5" /></button>
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-60 bg-canvas shadow-xl"><div className="flex justify-end p-2"><button aria-label="Close navigation" onClick={() => setOpen(false)}><X className="size-5" /></button></div><Sidebar {...props} /></div>
          <button aria-label="Close navigation" className="flex-1 bg-black/30" onClick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
