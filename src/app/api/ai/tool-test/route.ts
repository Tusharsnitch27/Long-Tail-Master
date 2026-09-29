import { toolByName, aiBase } from "@/server/ai/tools";

/** Dev-only: run an approved tool directly with JSON input (no LLM). */
export async function POST(req: Request) {
  if (process.env.AUTH_MODE !== "dev" || process.env.NODE_ENV === "production") return new Response("not found", { status: 404 });
  const { name, input } = (await req.json()) as { name: string; input: unknown };
  const tool = toolByName.get(name);
  if (!tool) return Response.json({ error: "unknown tool" }, { status: 400 });
  const p = tool.schema.safeParse(input);
  if (!p.success) return Response.json({ error: p.error.issues }, { status: 422 });
  const t0 = Date.now();
  const out = await tool.run(p.data, await aiBase());
  return Response.json({ ms: Date.now() - t0, ...out });
}

/** Dev-only: the exact tool definitions sent to the API. */
export async function GET() {
  if (process.env.AUTH_MODE !== "dev" || process.env.NODE_ENV === "production") return new Response("not found", { status: 404 });
  const { apiTools } = await import("@/server/ai/orchestrator");
  return Response.json(apiTools(true));
}
