"use client";
import { useEffect } from "react";

/** Sends an open tab to sign-in the moment the 8-hour session runs out (the proxy enforces it on every request too). */
export function SessionTimer({ exp }: { exp: number }) {
  useEffect(() => {
    const go = () => { window.location.href = `/login?error=session&next=${encodeURIComponent(location.pathname + location.search)}`; };
    const check = () => { if (Date.now() >= exp * 1000) go(); };
    // timers pause while a laptop sleeps, so also check whenever the tab becomes visible again
    const t = setTimeout(go, Math.max(0, exp * 1000 - Date.now()));
    document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", check); };
  }, [exp]);
  return null;
}
