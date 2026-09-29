import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { dbConfigured, q } from "../db";
import type { ToolEnvelope } from "./tools";

/**
 * Conversation state is server-side so the model's history (incl. tool results and thinking blocks) is
 * append-only and can't be tampered with by the client. Falls back to process memory without Postgres.
 */
export interface Conversation {
  id: string;
  owner: string;
  title: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  results: Record<string, ToolEnvelope>;
}

const g = globalThis as unknown as { __aiMem?: Map<string, Conversation> };
const mem = (g.__aiMem ??= new Map());

export async function loadConversation(id: string, owner: string): Promise<Conversation | null> {
  if (!dbConfigured()) { const c = mem.get(id); return c && c.owner === owner ? c : null; }
  const rows = await q<{ id: string; owner: string; title: string; messages: Conversation["messages"]; results: Conversation["results"] }>(
    "select id, owner, title, messages, results from ai_conversations where id = $1 and owner = $2", [id, owner]);
  const r = rows[0];
  return r ? { id: r.id, owner: r.owner, title: r.title, messages: r.messages, results: r.results } : null;
}

export async function saveConversation(c: Conversation) {
  if (!dbConfigured()) { mem.set(c.id, c); return; }
  await q(
    `insert into ai_conversations(id, owner, title, messages, results, updated_at) values ($1,$2,$3,$4,$5, now())
     on conflict (id) do update set messages = excluded.messages, results = excluded.results, updated_at = now()`,
    [c.id, c.owner, c.title, JSON.stringify(c.messages), JSON.stringify(c.results)],
  );
}

export async function recordTurn(t: { conversationId: string; owner: string; question: string; response: unknown; tools: unknown; usage: unknown; model: string; latencyMs: number; error?: string | null }) {
  if (!dbConfigured()) return null;
  const rows = await q<{ id: string }>(
    `insert into ai_turns(conversation_id, owner, question, response, tools, usage, model, latency_ms, error) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [t.conversationId, t.owner, t.question, JSON.stringify(t.response ?? null), JSON.stringify(t.tools ?? null), JSON.stringify(t.usage ?? null), t.model, t.latencyMs, t.error ?? null],
  );
  return rows[0]?.id ?? null;
}

export async function listConversations(owner: string) {
  if (!dbConfigured()) return [...mem.values()].filter((c) => c.owner === owner).map((c) => ({ id: c.id, title: c.title, updated_at: null })).reverse();
  return q<{ id: string; title: string; updated_at: string }>("select id, title, updated_at::text from ai_conversations where owner = $1 order by updated_at desc limit 30", [owner]);
}

/** Rendered turns for re-opening a conversation in the UI. */
export async function conversationTurns(id: string, owner: string) {
  if (!dbConfigured()) return [];
  return q<{ id: string; question: string; response: unknown; created_at: string; feedback: number | null }>(
    "select id, question, response, created_at::text, feedback from ai_turns where conversation_id = $1 and owner = $2 and error is null order by id", [id, owner]);
}

export async function setFeedback(turnId: string, owner: string, value: -1 | 0 | 1) {
  if (!dbConfigured()) return;
  await q("update ai_turns set feedback = $1 where id = $2 and owner = $3", [value, turnId, owner]);
}
