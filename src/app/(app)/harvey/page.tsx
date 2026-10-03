import { getUser } from "@/server/auth";
import { redirect } from "next/navigation";
import { accessFor } from "@/lib/access";
import { Copilot } from "@/components/ai/Copilot";
import { Notice } from "@/components/ui";
import { aiConfigured } from "@/server/ai/provider";

export const metadata = { title: "Ask Harvey" };
// env (provider credentials) and the signed-in user are read per request, never at build time
export const dynamic = "force-dynamic";

export default async function Harvey({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([getUser(), searchParams]);
  if (user && !accessFor(user.role).harvey) redirect("/no-access?from=/harvey");
  if (!aiConfigured()) return <Notice tone="warn">Harvey isn’t configured — it needs <b>SNOWFLAKE_PAT</b> + <b>SNOWFLAKE_ACCOUNT</b> (Snowflake Cortex) or <b>ANTHROPIC_API_KEY</b>.</Notice>;
  // ?q= prefills the composer (e.g. "Ask Harvey" on an action card); it is never sent automatically
  const q = typeof sp.q === "string" ? sp.q.slice(0, 500) : undefined;
  return <Copilot firstName={user?.name.split(" ")[0] ?? "there"} initialQuestion={q} />;
}
