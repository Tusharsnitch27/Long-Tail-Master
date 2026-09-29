import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import type { User } from "../auth";
import { SYSTEM_PROMPT } from "./prompt";
import { SUBMIT_TOOL, type Answer, type View } from "./answer";
import { TOOLS, aiBase, jsonSchema, toolByName, type ToolEnvelope } from "./tools";
import { loadConversation, recordTurn, saveConversation, type Conversation } from "./store";
import { aiClient, aiConfigured, providerFeatures } from "./provider";

export type AiEvent =
  | { type: "meta"; conversation_id: string }
  | { type: "status"; text: string }
  | { type: "tool"; id: string; name: string; label: string; state: "start" | "done" | "error"; detail?: string }
  | { type: "answer"; turn_id: string | null; answer: HydratedAnswer }
  | { type: "error"; message: string };

export interface HydratedView extends View { rows: Record<string, unknown>[]; formats: Record<string, string>; labels: Record<string, string>; kpiValues?: { label: string; value: unknown; format: string | null }[]; comparison?: { current: string; previous: string } }
export interface HydratedAnswer extends Omit<Answer, "visualizations"> { visualizations: HydratedView[]; data_freshness: { source: string; as_of: string | null; period?: string }[] }

const MODEL = process.env.AI_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.AI_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_STEPS = 10;
const MODEL_ROWS = 60; // rows of each tool result shown to the model (the UI gets the full set)

// Deterministic tool list (stable order → prompt cache hits). `strict` only where the provider accepts it;
// every input is validated with zod before a tool runs either way.
export const apiTools = (strict: boolean): Anthropic.Beta.BetaTool[] => [...TOOLS, SUBMIT_TOOL].map((t) => ({
  name: t.name, description: t.description, input_schema: jsonSchema(t.schema) as Anthropic.Beta.BetaTool.InputSchema, eager_input_streaming: true, ...(strict ? { strict: true } : {}),
}));

const LABEL: Record<string, (i: Record<string, unknown>) => string> = {
  resolve_product: (i) => `Finding product “${i.query}”`,
  resolve_location: (i) => `Finding location “${i.query}”`,
  get_performance: (i) => `Store performance${i.group_by && i.group_by !== "none" ? ` by ${String(i.group_by).replace("_", " ")}` : ""}`,
  get_sku_performance: (i) => `SKU sales${i.group_by ? ` by ${String(i.group_by).replace("_", " ")}` : ""}`,
  get_current_inventory: (i) => `Current inventory (${i.level})`,
  get_exceptions: (i) => `Exceptions: ${String(i.type).replaceAll("_", " ")}`,
  explain_change: () => "Decomposing the change",
  submit_answer: () => "Writing the answer",
};

/** What the model sees for a tool result: the envelope with rows capped. */
function forModel(id: string, env: ToolEnvelope) {
  const data = env.data;
  return JSON.stringify({ result_id: id, ...env, ...(data ? { data: data.slice(0, MODEL_ROWS), data_rows_shown: Math.min(data.length, MODEL_ROWS) } : {}) });
}

const get = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

function inferFormat(k: string, v: unknown): string {
  if (typeof v !== "number") return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? "date" : "text";
  if (/growth|change|vs_prior|wow|l7_vs/.test(k)) return "delta";
  if (/achievement|share|penetration|pct|rate/.test(k)) return "pct";
  if (/revenue|sales|target|gap|asp|atv|^l7$|^l30$|mtd|prior_7|required|projected|per_day|delta|current|previous/.test(k) && !/units|stores|count|days/.test(k)) return "inr";
  return Number.isInteger(v) ? "num" : "dec";
}

/** Attach real rows from stored tool results to each view; drop views whose references don't resolve. */
function hydrate(views: View[], results: Record<string, ToolEnvelope>): HydratedView[] {
  const out: HydratedView[] = [];
  for (const v of views) {
    const r = results[v.result_id];
    if (!r) continue;
    const formats: Record<string, string> = {}, labels: Record<string, string> = {};
    for (const c of r.columns ?? []) { formats[c.key] = c.format; labels[c.key] = c.label; }
    let rows = [...(r.data ?? [])];
    const has = (f: string | null | undefined) => !!f && rows.some((row) => row[f] !== undefined);
    if (v.sort_by && has(v.sort_by)) {
      const d = v.sort_dir === "asc" ? 1 : -1;
      rows.sort((a, b) => (((a[v.sort_by!] as number) ?? -Infinity) > ((b[v.sort_by!] as number) ?? -Infinity) ? d : -d));
    }
    if (v.limit) rows = rows.slice(0, v.limit);
    const sample = rows[0] ?? {};
    for (const k of Object.keys(sample)) { formats[k] ??= inferFormat(k, sample[k]); labels[k] ??= k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()); }
    if (v.type === "kpi" || v.type === "comparison") {
      const kpiValues = (v.kpis ?? []).map((k) => {
        const src = k.row_key ? rows.find((row) => String(row.key) === k.row_key) ?? (r.data ?? []).find((row) => String(row.key) === k.row_key) : r;
        const value = k.row_key ? (src as Record<string, unknown> | undefined)?.[k.field.replace(/^data\./, "")] : get(src, k.field);
        return { label: k.label, value, format: k.format ?? inferFormat(k.field.split(".").pop()!, value) };
      }).filter((k) => k.value !== undefined);
      if (kpiValues.length) out.push({ ...v, rows: [], formats, labels, kpiValues });
      continue;
    }
    const y = (v.y ?? []).filter(has);
    const columns = (v.columns ?? []).filter(has);
    if (["bar", "line", "area"].includes(v.type) && (!has(v.x) || !y.length)) continue;
    if (v.type === "heatmap" && (!has(v.x) || !has(v.group) || !y.length)) continue;
    if (!rows.length) continue;
    out.push({ ...v, y, columns: columns.length ? columns : (r.columns ?? []).map((c) => c.key).filter(has), rows, formats, labels });
  }
  return out;
}

export async function* runTurn(opts: { user: User; question: string; conversationId?: string | null }): AsyncGenerator<AiEvent> {
  const started = Date.now();
  if (!aiConfigured()) { yield { type: "error", message: "The AI Copilot is not configured (no Snowflake PAT or ANTHROPIC_API_KEY)." }; return; }
  const { client, provider } = aiClient();
  const feat = providerFeatures(provider);
  const tools = apiTools(feat.strictTools);
  let conv: Conversation | null = opts.conversationId ? await loadConversation(opts.conversationId, opts.user.username) : null;
  if (!conv) conv = { id: randomUUID(), owner: opts.user.username, title: opts.question.slice(0, 80), messages: [], results: {} };
  yield { type: "meta", conversation_id: conv.id };

  const base = await aiBase();
  const context = `<context>\nToday (IST): ${base.today} — partial day. Last complete day (as-of): ${base.asOf}. Enabled categories: ${base.settings.enabledCategories.join(", ")}. Status thresholds: ahead ≥${base.settings.thresholds.ahead}, on track ≥${base.settings.thresholds.onTrack}, at risk ≥${base.settings.thresholds.atRisk}. User: ${opts.user.name} (${opts.user.role}).\n</context>\n\n`;
  const messages = conv.messages; // append-only
  messages.push({ role: "user", content: context + opts.question });

  const toolLog: { name: string; input: unknown; result_id?: string; error?: string; ms: number }[] = [];
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, steps: 0 };
  let final: Answer | null = null;
  let error: string | null = null;
  let jsonRetries = 0;

  try {
    for (let step = 0; step < MAX_STEPS && !final; step++) {
      yield { type: "status", text: step === 0 ? "Understanding the question…" : "Analysing results…" };
      let msg: Anthropic.Beta.BetaMessage;
      try {
        const stream = client.beta.messages.stream({
          model: MODEL, max_tokens: 32000,
          // refusal fallback to another model — Anthropic API only (Cortex rejects the parameter)
          ...(feat.serverFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools, messages, thinking: { type: "adaptive" }, output_config: { effort: EFFORT }, cache_control: { type: "ephemeral" },
        });
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (e) {
        // eager input streaming: an unparseable tool input rejects finalMessage — retry that step (API errors propagate)
        if (e instanceof Anthropic.APIError || jsonRetries++ >= 2) throw e;
        step--; continue;
      }
      usage.steps++; usage.input += msg.usage.input_tokens; usage.output += msg.usage.output_tokens;
      usage.cache_read += msg.usage.cache_read_input_tokens ?? 0; usage.cache_write += msg.usage.cache_creation_input_tokens ?? 0;

      // A refusal can cut a tool_use off mid-input; keep it out of history so the next turn stays valid.
      if (msg.stop_reason === "refusal") { error = "The request was declined by the model's safety system."; break; }
      if (msg.stop_reason === "max_tokens") throw new Error("The response hit the token limit — try a narrower question.");
      messages.push({ role: "assistant", content: msg.content });

      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (!uses.length) {
        // Model answered in plain text instead of submit_answer — deliver it as-is.
        const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        if (text) final = { answer: text, metrics: [], insights: [], actions: [], visualizations: [], limitations: [], follow_up_questions: [], context: { products: [], skus: [], locations: [], categories: [], period: null } };
        break;
      }
      for (const u of uses) yield { type: "tool", id: u.id, name: u.name, label: (LABEL[u.name] ?? ((): string => u.name))(u.input as Record<string, unknown>), state: "start" };

      const results = await Promise.all(uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam & { _ev: AiEvent }> => {
        const t0 = Date.now();
        const label = (LABEL[u.name] ?? ((): string => u.name))(u.input as Record<string, unknown>);
        if (u.name === SUBMIT_TOOL.name) {
          const p = SUBMIT_TOOL.schema.safeParse(u.input);
          if (!p.success) return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `INVALID_INPUT: ${p.error.issues.slice(0, 5).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`, _ev: { type: "tool", id: u.id, name: u.name, label, state: "error" } };
          final = p.data;
          return { type: "tool_result", tool_use_id: u.id, content: "Delivered to the user.", _ev: { type: "tool", id: u.id, name: u.name, label, state: "done" } };
        }
        const tool = toolByName.get(u.name);
        if (!tool) return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Unknown tool ${u.name}`, _ev: { type: "tool", id: u.id, name: u.name, label, state: "error" } };
        const p = tool.schema.safeParse(u.input);
        if (!p.success) {
          toolLog.push({ name: u.name, input: u.input, error: "invalid input", ms: 0 });
          return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `INVALID_INPUT: ${p.error.issues.slice(0, 5).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`, _ev: { type: "tool", id: u.id, name: u.name, label, state: "error" } };
        }
        try {
          const env = await tool.run(p.data, base);
          const id = `r${Object.keys(conv!.results).length + 1}`;
          conv!.results[id] = env;
          toolLog.push({ name: u.name, input: p.data, result_id: id, ms: Date.now() - t0 });
          const detail = env.row_count != null ? `${env.row_count} rows` : typeof env.confidence === "string" ? `${env.confidence} confidence` : undefined;
          return { type: "tool_result", tool_use_id: u.id, content: forModel(id, env), _ev: { type: "tool", id: u.id, name: u.name, label, state: "done", detail } };
        } catch (e) {
          console.error(`[ai] tool ${u.name} failed`, e);
          toolLog.push({ name: u.name, input: p.data, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
          return { type: "tool_result", tool_use_id: u.id, is_error: true, content: "The data query failed. Tell the user this part could not be retrieved; do not estimate it.", _ev: { type: "tool", id: u.id, name: u.name, label, state: "error" } };
        }
      }));
      for (const r of results) yield r._ev;
      // all tool results for one assistant turn go back in a single user message
      messages.push({ role: "user", content: results.map(({ _ev, ...r }) => r) });
    }
  } catch (e) {
    console.error("[ai] turn failed", e);
    error = e instanceof Anthropic.RateLimitError ? "The AI service is busy — please retry in a moment."
      : e instanceof Anthropic.AuthenticationError ? "The AI service credentials are invalid."
      : e instanceof Anthropic.APIError ? `AI service error (${e.status}).`
      : e instanceof Error ? e.message : "Unexpected error";
  }

  if (!final && !error) error = "I couldn't finish this analysis within the step limit. Try a more specific question.";
  let hydrated: HydratedAnswer | null = null;
  if (final) {
    const f: Answer = final;
    const used = Array.from(new Set(toolLog.filter((t) => t.result_id).map((t) => t.result_id!)));
    hydrated = {
      ...f,
      visualizations: hydrate(f.visualizations, conv.results),
      data_freshness: used.map((id) => conv!.results[id]).filter((r) => r.as_of || r.period)
        .map((r) => ({ source: r.source, as_of: r.as_of, period: r.period ? `${(r.period as { from: string }).from} → ${(r.period as { to: string }).to}` : undefined }))
        .filter((x, i, a) => a.findIndex((y) => y.source === x.source && y.as_of === x.as_of && y.period === x.period) === i),
    };
  }
  await saveConversation(conv);
  const turnId = await recordTurn({ conversationId: conv.id, owner: conv.owner, question: opts.question, response: hydrated, tools: toolLog, usage, model: `${MODEL}@${provider}`, latencyMs: Date.now() - started, error }).catch((e) => { console.error("[ai] recordTurn", e); return null; });
  if (hydrated) yield { type: "answer", turn_id: turnId, answer: hydrated };
  else yield { type: "error", message: error ?? "Unknown error" };
}
