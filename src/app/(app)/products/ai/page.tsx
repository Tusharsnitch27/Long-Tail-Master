import { getUser } from "@/server/auth";
import { Copilot } from "@/components/ai/Copilot";
import { Notice } from "@/components/ui";

export const metadata = { title: "AI Bot · Long-Tail Ops" };
// env (API key) and the signed-in user are read per request, never at build time
export const dynamic = "force-dynamic";

export default async function AiBot() {
  const user = await getUser();
  if (!process.env.ANTHROPIC_API_KEY) {
    return <Notice tone="warn">The AI Copilot isn’t configured yet — set <b>ANTHROPIC_API_KEY</b> in the environment and redeploy.</Notice>;
  }
  return <Copilot firstName={user?.name.split(" ")[0] ?? "there"} />;
}
