"use client";
import { MultiSelect, type Option } from "@/components/filters/MultiSelect";
import { useQuery } from "@/components/filters/useQuery";

/** Store filter — options are only the stores that have data for the current context. */
export function StoreFilter({ options }: { options: Option[] }) {
  const { list, set } = useQuery();
  return <MultiSelect label="Store" width={300} options={options} value={list("store")} onChange={(v) => set({ store: v })} />;
}
