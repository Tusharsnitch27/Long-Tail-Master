import { getUser } from "@/server/auth";
import { Copilot } from "@/components/ai/Copilot";
import { Notice } from "@/components/ui";
import { aiConfigured } from "@/server/ai/provider";

export const metadata = { title: "Mitra" };
// env (provider credentials) and the signed-in user are read per request, never at build time
export const dynamic = "force-dynamic";

export default async function Mitra() {
  const user = await getUser();
  if (!aiConfigured()) return <Notice tone="warn">Mitra isn’t configured — it needs <b>SNOWFLAKE_PAT</b> + <b>SNOWFLAKE_ACCOUNT</b> (Snowflake Cortex) or <b>ANTHROPIC_API_KEY</b>.</Notice>;
  return <Copilot firstName={user?.name.split(" ")[0] ?? "there"} />;
}
