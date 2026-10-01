import { redirect } from "next/navigation";

// Mitra was renamed Harvey; keep old links (bookmarks, ?q= prefills) working.
export default async function LegacyMitra({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? `?q=${encodeURIComponent(sp.q)}` : "";
  redirect(`/harvey${q}`);
}
