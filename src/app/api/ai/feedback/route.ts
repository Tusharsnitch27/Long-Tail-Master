import { z } from "zod";
import { requireUser } from "@/server/auth";
import { apiError } from "@/server/api";
import { setFeedback } from "@/server/ai/store";

const Body = z.object({ turn_id: z.string(), value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

export async function POST(req: Request) {
  try {
    const u = await requireUser();
    const p = Body.safeParse(await req.json());
    if (!p.success) return Response.json({ error: "invalid" }, { status: 400 });
    await setFeedback(p.data.turn_id, u.username, p.data.value);
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
