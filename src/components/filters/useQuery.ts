"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

export function useQuery() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const set = useCallback(
    (updates: Record<string, string | string[] | null | undefined>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(updates)) {
        const val = Array.isArray(v) ? v.join(",") : v;
        if (val == null || val === "") next.delete(k);
        else next.set(k, val);
      }
      const qs = next.toString();
      start(() => router.push(qs ? `${path}?${qs}` : path, { scroll: false }));
    },
    [sp, router, path],
  );
  const list = (k: string) => (sp.get(k) ?? "").split(",").filter(Boolean);
  return { sp, set, list, pending, path, qs: sp.toString() };
}
