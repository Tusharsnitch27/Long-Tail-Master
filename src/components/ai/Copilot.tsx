"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, CircleAlert, Loader2, MessageSquarePlus, Sparkles, ThumbsDown, ThumbsUp, History, Database } from "lucide-react";
import { cn } from "@/lib/cn";
import { View, type ViewData } from "./Views";

interface Answer {
  answer: string;
  metrics: { label: string; value: string; basis: string }[];
  insights: { text: string; kind: string }[];
  actions: { text: string; priority: string; evidence: string }[];
  visualizations: ViewData[];
  limitations: string[];
  follow_up_questions: string[];
  data_freshness: { source: string; as_of: string | null; period?: string }[];
}
interface Step { id: string; label: string; state: "start" | "done" | "error"; detail?: string }
interface Turn { key: string; question: string; running: boolean; status?: string; steps: Step[]; answer?: Answer; error?: string; turnId?: string | null; feedback?: number }

const SUGGESTED = [
  "How are perfumes performing this week?",
  "Which stores missed perfume target yesterday?",
  "Show top shoe SKUs this month",
  "Where are Classic Chelsea Boots currently available?",
  "What should we focus on for perfumes this week?",
  "Why did perfume sales fall last week?",
];

/** Minimal safe markdown: paragraphs, "- " bullets, **bold**. Rendered as React text (no HTML injection). */
function Md({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i} className="font-semibold">{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed text-zinc-800">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) return <ul key={i} className="list-disc space-y-0.5 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ""))}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

export function Copilot({ firstName }: { firstName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<{ id: string; title: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const busy = turns.some((t) => t.running);
  const endRef = useRef<HTMLDivElement>(null);
  const loadHistory = useCallback(() => fetch("/api/ai/conversations").then((r) => r.json()).then((j) => setHistory(j.rows ?? [])).catch(() => {}), []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns.length, turns.at(-1)?.steps.length, turns.at(-1)?.answer]);

  const update = (key: string, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.key === key ? fn(t) : t)));

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    const key = crypto.randomUUID();
    setTurns((ts) => [...ts, { key, question, running: true, steps: [], status: "Starting…" }]);
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, conversation_id: conversationId }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `Request failed (${res.status})`); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "meta") setConversationId(ev.conversation_id);
          else if (ev.type === "status") update(key, (t) => ({ ...t, status: ev.text }));
          else if (ev.type === "tool" && ev.name !== "submit_answer") update(key, (t) => {
            const steps = t.steps.some((s) => s.id === ev.id) ? t.steps.map((s) => (s.id === ev.id ? { ...s, state: ev.state, detail: ev.detail } : s)) : [...t.steps, { id: ev.id, label: ev.label, state: ev.state }];
            return { ...t, steps };
          });
          else if (ev.type === "tool" && ev.name === "submit_answer") update(key, (t) => ({ ...t, status: "Writing the answer…" }));
          else if (ev.type === "answer") update(key, (t) => ({ ...t, running: false, answer: ev.answer, turnId: ev.turn_id }));
          else if (ev.type === "error") update(key, (t) => ({ ...t, running: false, error: ev.message }));
        }
      }
      update(key, (t) => (t.running ? { ...t, running: false, error: t.answer ? undefined : "The connection closed before an answer arrived." } : t));
      loadHistory();
    } catch (e) {
      update(key, (t) => ({ ...t, running: false, error: e instanceof Error ? e.message : "Request failed" }));
    }
  }

  async function openConversation(id: string) {
    setShowHistory(false);
    const j = await fetch(`/api/ai/conversations/${id}`).then((r) => r.json());
    if (!j.turns) return;
    setConversationId(id);
    setTurns(j.turns.map((t: { id: string; question: string; response: Answer; feedback: number | null }) => ({ key: t.id, question: t.question, running: false, steps: [], answer: t.response, turnId: t.id, feedback: t.feedback ?? 0 })));
  }

  function newChat() { setTurns([]); setConversationId(null); setShowHistory(false); }

  async function feedback(t: Turn, value: number) {
    if (!t.turnId) return;
    const v = t.feedback === value ? 0 : value;
    update(t.key, (x) => ({ ...x, feedback: v }));
    await fetch("/api/ai/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turn_id: t.turnId, value: v }) });
  }

  const composer = (
    <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex items-end gap-2 rounded-xl border border-zinc-300 bg-white p-2 shadow-sm focus-within:border-brand-500">
      <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="Ask anything about perfume & shoe performance, stores, SKUs, targets or inventory…"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
        className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] outline-none" aria-label="Question" />
      <button type="submit" disabled={busy || input.trim().length < 2} aria-label="Ask" className="flex size-9 items-center justify-center rounded-lg bg-zinc-900 text-white disabled:opacity-30">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
      </button>
    </form>
  );

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2"><Sparkles className="size-5 text-brand-500" /><h1 className="text-[20px] font-semibold tracking-tight">AI Business Copilot</h1></div>
        <div className="relative flex gap-1">
          <button onClick={() => setShowHistory((s) => !s)} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[12.5px] text-zinc-600 hover:bg-zinc-100"><History className="size-3.5" />History</button>
          <button onClick={newChat} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[12.5px] text-zinc-600 hover:bg-zinc-100"><MessageSquarePlus className="size-3.5" />New chat</button>
          {showHistory && (
            <div className="absolute right-0 top-9 z-30 max-h-96 w-80 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg scroll-thin">
              {history.length === 0 && <div className="px-3 py-3 text-[12.5px] text-zinc-500">No saved conversations yet.</div>}
              {history.map((h) => <button key={h.id} onClick={() => openConversation(h.id)} className="block w-full truncate px-3 py-1.5 text-left text-[12.5px] hover:bg-zinc-50">{h.title}</button>)}
            </div>
          )}
        </div>
      </div>

      {turns.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6">
          <div className="text-[15px] font-medium">Hi {firstName} — ask anything about your business data</div>
          <p className="mt-1 text-[12.5px] text-zinc-500">Answers come only from governed Snowflake data (store DSR, targets, SKU sales, product master, inventory snapshots) with the period and snapshot time stated.</p>
          <div className="mt-4">{composer}</div>
          <div className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Suggested</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {SUGGESTED.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-[13px] text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50">{s}</button>)}
          </div>
        </div>
      ) : (
        <div className="space-y-6 pb-28">
          {turns.map((t) => (
            <div key={t.key} className="space-y-3">
              <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-sm bg-zinc-900 px-4 py-2 text-[13.5px] text-white">{t.question}</div></div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                {(t.running || (!t.answer && t.steps.length > 0)) && (
                  <div className="space-y-1">
                    {t.steps.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-[12.5px] text-zinc-600">
                        {s.state === "start" ? <Loader2 className="size-3.5 animate-spin text-brand-500" /> : s.state === "done" ? <Check className="size-3.5 text-emerald-600" /> : <CircleAlert className="size-3.5 text-rose-600" />}
                        {s.label}{s.detail && <span className="text-zinc-400">· {s.detail}</span>}
                      </div>
                    ))}
                    {t.running && <div className="flex items-center gap-2 text-[12.5px] text-zinc-500"><Loader2 className="size-3.5 animate-spin" />{t.status}</div>}
                  </div>
                )}
                {t.error && <div role="alert" className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900">{t.error}</div>}
                {t.answer && <AnswerView a={t.answer} onAsk={ask} />}
                {t.answer && t.turnId && (
                  <div className="mt-3 flex items-center gap-1 border-t border-zinc-100 pt-2 text-[11.5px] text-zinc-400">
                    Was this useful?
                    <button aria-label="Helpful" onClick={() => feedback(t, 1)} className={cn("rounded p-1 hover:bg-zinc-100", t.feedback === 1 && "text-emerald-600")}><ThumbsUp className="size-3.5" /></button>
                    <button aria-label="Not helpful" onClick={() => feedback(t, -1)} className={cn("rounded p-1 hover:bg-zinc-100", t.feedback === -1 && "text-rose-600")}><ThumbsDown className="size-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      {turns.length > 0 && <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-[#f7f7f8] via-[#f7f7f8] to-transparent px-1 pb-3 pt-6">{composer}</div>}
    </div>
  );
}

function AnswerView({ a, onAsk }: { a: Answer; onAsk: (q: string) => void }) {
  const tag = (k: string) => ({ fact: "Fact", calculated: "Calculated", interpretation: "Interpretation" })[k] ?? k;
  return (
    <div className="space-y-4">
      <Md text={a.answer} />
      {a.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {a.metrics.map((m) => (
            <div key={m.label} className="rounded-lg border border-zinc-200 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">{m.label}</div>
              <div className="tabular mt-0.5 text-[17px] font-semibold">{m.value}</div>
              {m.basis === "calculated" && <div className="text-[10.5px] text-zinc-400">calculated</div>}
            </div>
          ))}
        </div>
      )}
      {a.visualizations.length > 0 && <div className="grid gap-3">{a.visualizations.map((v, i) => <View key={i} v={v} />)}</div>}
      {a.insights.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">What stands out</div>
          <ul className="space-y-1">{a.insights.map((x, i) => (
            <li key={i} className="flex gap-2 text-[13px]"><span className={cn("mt-0.5 h-fit shrink-0 rounded px-1.5 text-[10.5px] font-medium", x.kind === "interpretation" ? "bg-amber-50 text-amber-800" : x.kind === "calculated" ? "bg-sky-50 text-sky-800" : "bg-zinc-100 text-zinc-700")}>{tag(x.kind)}</span><span>{x.text}</span></li>
          ))}</ul>
        </div>
      )}
      {a.actions.length > 0 && (
        <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-700">Recommended actions</div>
          <ol className="space-y-1.5">{a.actions.map((x, i) => (
            <li key={i} className="text-[13px]"><span className={cn("mr-1.5 rounded px-1.5 text-[10.5px] font-semibold uppercase", x.priority === "high" ? "bg-rose-100 text-rose-800" : x.priority === "medium" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600")}>{x.priority}</span>
              {x.text}<div className="ml-1 text-[11.5px] text-zinc-500">Evidence: {x.evidence}</div></li>
          ))}</ol>
        </div>
      )}
      {a.limitations.length > 0 && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-900"><b className="font-semibold">Data limitations:</b> {a.limitations.join(" · ")}</div>
      )}
      {a.data_freshness.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500"><Database className="size-3" />
          {a.data_freshness.map((f, i) => <span key={i}>{f.source.split(" (")[0]}{f.period ? ` · ${f.period}` : ""}{f.as_of ? ` · as of ${f.as_of.includes("T") ? new Date(f.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST" : f.as_of}` : ""}</span>)}
        </div>
      )}
      {a.follow_up_questions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{a.follow_up_questions.slice(0, 4).map((q) => <button key={q} onClick={() => onAsk(q)} className="rounded-full border border-zinc-300 px-3 py-1 text-[12px] text-zinc-700 hover:border-brand-500 hover:text-brand-700">{q}</button>)}</div>
      )}
    </div>
  );
}
