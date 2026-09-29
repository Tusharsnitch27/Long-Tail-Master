import { requireUser } from "@/server/auth";
import { apiError } from "@/server/api";
import { conversationTurns, loadConversation } from "@/server/ai/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const conv = await loadConversation(id, u.username);
    if (!conv) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ id: conv.id, title: conv.title, turns: await conversationTurns(id, u.username) });
  } catch (e) { return apiError(e); }
}
