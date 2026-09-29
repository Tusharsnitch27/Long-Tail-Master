import { z } from "zod";
import { requireUser } from "@/server/auth";
import { apiError } from "@/server/api";
import { runTurn } from "@/server/ai/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ question: z.string().trim().min(2).max(2000), conversation_id: z.string().uuid().nullish() });

// simple per-user rate limit (process memory)
const g = globalThis as unknown as { __aiRate?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__aiRate ??= new Map());
const PER_HOUR = Number(process.env.AI_QUESTIONS_PER_HOUR ?? 60);

/** Streams newline-delimited JSON events: meta, status, tool, answer | error. */
export async function POST(req: Request) {
  try {
    const user = await requireUser("viewer");
    const p = Body.safeParse(await req.json());
    if (!p.success) return Response.json({ error: "question required (2–2000 chars)" }, { status: 400 });
    const now = Date.now();
    const recent = (hits.get(user.username) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= PER_HOUR) return Response.json({ error: `Limit of ${PER_HOUR} questions per hour reached.` }, { status: 429 });
    hits.set(user.username, [...recent, now]);

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const ev of runTurn({ user, question: p.data.question, conversationId: p.data.conversation_id })) {
            controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
          }
        } catch (e) {
          console.error("[ai/chat]", e);
          controller.enqueue(enc.encode(JSON.stringify({ type: "error", message: "Unexpected error" }) + "\n"));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  } catch (e) {
    return apiError(e);
  }
}
