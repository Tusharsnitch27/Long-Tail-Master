import { requireUser } from "@/server/auth";
import { apiError } from "@/server/api";
import { listConversations } from "@/server/ai/store";

export async function GET() {
  try {
    const u = await requireUser();
    return Response.json({ rows: await listConversations(u.username) });
  } catch (e) { return apiError(e); }
}
