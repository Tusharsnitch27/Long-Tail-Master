"use client";
import { useQuery } from "./filters/useQuery";

export function MonthPicker({ months, value }: { months: string[]; value: string }) {
  const { set } = useQuery();
  return (
    <select value={value} onChange={(e) => set({ m: e.target.value })} className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-[13px]" aria-label="Month">
      {months.map((m) => <option key={m} value={m}>{new Date(m + "-01T00:00:00Z").toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</option>)}
    </select>
  );
}
