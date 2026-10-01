"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp, Check, CircleAlert, Loader2, MessageSquarePlus, ThumbsDown, ThumbsUp, History, Database, Square,
  Zap, GitCompareArrows, Lightbulb, Target, Timer, ShieldCheck, NotebookPen, Copy, ChevronRight,
} from "lucide-react";
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
interface Turn { key: string; question: string; running: boolean; status?: string; steps: Step[]; answer?: Answer; error?: string; turnId?: string | null; feedback?: number; startedAt?: number; ms?: number }

const CATS = ["Accessories", "Bags", "Belts", "Perfumes", "Shoes", "Sunglasses", "Trolleys"];

/** Suggested questions — all answerable with Harvey's governed tools. */
const GROUPS: { key: string; title: string; hint: string; icon: typeof Zap; qs: string[] }[] = [
  { key: "quick", title: "Quick answers", hint: "One number, one list", icon: Zap, qs: [
    "How are we doing MTD against target, by category?",
    "Top 10 perfumes by revenue in the last 30 days",
    "How much Stryker stock do we have — stores vs warehouse (North / South)?",
    "Which stores sold no shoes this week?",
  ] },
  { key: "compare", title: "Compare", hint: "Charts, tables, X vs Y", icon: GitCompareArrows, qs: [
    "Give me a chart of Perfumes vs Shoes revenue by week for the last 8 weeks",
    "Table: Stores vs Online vs Marketplace revenue this month vs the same days last month",
    "Compare Bengaluru vs Mumbai stores on perfumes MTD — table with achievement",
    "Comparison view of this week vs last week by category",
  ] },
  { key: "explain", title: "Explain", hint: "What changed and why", icon: Lightbulb, qs: [
    "Why are marketplace sales down this week?",
    "What drove the change in shoe sales vs last month?",
    "Which perfume SKUs are declining, and is stock the reason?",
    "Which stores are furthest behind their MTD target, and what explains it?",
  ] },
  { key: "act", title: "Act", hint: "Decide the next step", icon: Target, qs: [
    "What should I focus on this week? Top 3 actions with ₹ impact",
    "Where should Stryker be allocated next?",
    "Which SKUs have high warehouse stock but low sales?",
    "Which strong stores don't carry sunglasses yet?",
  ] },
];

/** Minimal safe markdown: paragraphs, "- " bullets, **bold**. Rendered as React text (no HTML injection). */
function Md({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i} className="font-semibold text-ink">{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed text-zinc-800">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) return <ul key={i} className="space-y-1 pl-1">{lines.map((l, j) => <li key={j} className="flex gap-2"><span className="mt-[9px] size-1 shrink-0 rounded-full bg-brand-500" /><span>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ""))}</span></li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

function Avatar({ size = 32 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-brand-900 font-serif italic leading-none text-brand-300 shadow-[0_6px_16px_-6px_rgba(60,40,20,.5)] ring-1 ring-brand-300/40" style={{ width: size, height: size, fontSize: size * 0.52 }}>
      H
    </span>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return <span className="tabular">{Math.max(0, Math.round((now - since) / 1000))}s</span>;
}

export function Copilot({ firstName, initialQuestion }: { firstName: string; initialQuestion?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState(initialQuestion ?? "");
  const [history, setHistory] = useState<{ id: string; title: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const busy = turns.some((t) => t.running);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadHistory = useCallback(() => fetch("/api/ai/conversations").then((r) => r.json()).then((j) => setHistory(j.rows ?? [])).catch(() => {}), []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns.length, turns.at(-1)?.steps.length, turns.at(-1)?.answer]);
  useEffect(() => { if (initialQuestion) inputRef.current?.focus(); }, [initialQuestion]);
  // auto-grow the composer
  useEffect(() => { const el = inputRef.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } }, [input]);

  const update = (key: string, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.key === key ? fn(t) : t)));

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    const key = crypto.randomUUID();
    const startedAt = Date.now();
    setTurns((ts) => [...ts, { key, question, running: true, steps: [], status: "Reading your question…", startedAt }]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, conversation_id: conversationId }), signal: ac.signal });
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
          else if (ev.type === "answer") update(key, (t) => ({ ...t, running: false, answer: ev.answer, turnId: ev.turn_id, ms: Date.now() - startedAt }));
          else if (ev.type === "error") update(key, (t) => ({ ...t, running: false, error: ev.message, ms: Date.now() - startedAt }));
        }
      }
      update(key, (t) => (t.running ? { ...t, running: false, error: t.answer ? undefined : "The connection closed before an answer arrived." } : t));
      loadHistory();
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      update(key, (t) => ({ ...t, running: false, error: aborted ? "Stopped. The analysis may still finish in the background and appear in History." : e instanceof Error ? e.message : "Request failed" }));
    } finally {
      abortRef.current = null;
    }
  }

  async function openConversation(id: string) {
    setShowHistory(false);
    const j = await fetch(`/api/ai/conversations/${id}`).then((r) => r.json());
    if (!j.turns) return;
    setConversationId(id);
    setTurns(j.turns.map((t: { id: string; question: string; response: Answer; feedback: number | null }) => ({ key: t.id, question: t.question, running: false, steps: [], answer: t.response, turnId: t.id, feedback: t.feedback ?? 0 })));
  }

  function newChat() { if (busy) return; setTurns([]); setConversationId(null); setShowHistory(false); setInput(""); }

  async function feedback(t: Turn, value: number) {
    if (!t.turnId) return;
    const v = t.feedback === value ? 0 : value;
    update(t.key, (x) => ({ ...x, feedback: v }));
    await fetch("/api/ai/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turn_id: t.turnId, value: v }) });
  }

  const composer = (hero: boolean) => (
    <form onSubmit={(e) => { e.preventDefault(); ask(input); }}
      className={cn("flex items-end gap-2 rounded-2xl border bg-white p-2 transition-shadow focus-within:border-brand-500 focus-within:shadow-[0_0_0_4px_rgba(168,112,63,.12)]", hero ? "border-white/40 shadow-[0_10px_30px_rgba(60,40,20,.25)]" : "border-line shadow-[0_6px_20px_rgba(60,40,20,.08)]")}>
      <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} rows={1}
        placeholder={hero ? "Ask about sales, targets, stores, channels, products or inventory…" : "Ask a follow-up — e.g. “only Bengaluru”, “as a chart”, “vs last month”"}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
        className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 text-[14px] text-ink outline-none placeholder:text-zinc-400" aria-label="Question" />
      {busy ? (
        <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop" title="Stop waiting" className="flex size-10 items-center justify-center rounded-xl border border-line bg-white text-zinc-600 hover:border-rose-200 hover:text-rose-700"><Square className="size-3.5 fill-current" /></button>
      ) : (
        <button type="submit" disabled={input.trim().length < 2} aria-label="Ask" className="flex size-10 items-center justify-center rounded-xl bg-brand-900 text-canvas transition-colors hover:bg-brand-800 disabled:bg-zinc-200 disabled:text-zinc-400"><ArrowUp className="size-4" /></button>
      )}
    </form>
  );

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col">
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Avatar size={34} />
          <div className="leading-tight">
            <h1 className="font-serif text-[26px] leading-none tracking-[-0.02em] text-ink">Ask <span className="text-gilded italic">Harvey</span></h1>
            <div className="mt-1 text-[11.5px] text-zinc-500">Your Long Tail analyst · governed data only</div>
          </div>
        </div>
        <div className="relative flex gap-1">
          <button onClick={() => setShowHistory((s) => !s)} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors", showHistory ? "border-brand-300 bg-brand-50 text-brand-800" : "border-line bg-white text-zinc-600 hover:border-brand-300")}><History className="size-3.5" />History</button>
          <button onClick={newChat} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] text-zinc-600 hover:border-brand-300 disabled:opacity-40"><MessageSquarePlus className="size-3.5" />New chat</button>
          {showHistory && (
            <div className="absolute right-0 top-10 z-40 max-h-[420px] w-80 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_rgba(60,40,20,.14)] scroll-thin">
              <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Recent conversations</div>
              {history.length === 0 && <div className="px-2.5 py-3 text-[12.5px] text-zinc-500">No saved conversations yet.</div>}
              {history.map((h) => <button key={h.id} onClick={() => openConversation(h.id)} className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-zinc-700 hover:bg-brand-50">{h.title}</button>)}
            </div>
          )}
        </div>
      </div>

      {turns.length === 0 ? (
        <>
          {/* hero */}
          <section className="relative overflow-hidden rounded-[22px] bg-[radial-gradient(700px_320px_at_100%_0%,rgba(192,143,96,.35),transparent_65%),radial-gradient(500px_300px_at_0%_100%,rgba(168,112,63,.22),transparent_70%),linear-gradient(160deg,#2b221a_0%,#1b1712_55%,#120e0a_100%)] p-6 text-[#f3ebe1] shadow-[0_30px_60px_-30px_rgba(60,40,20,.7)] ring-1 ring-[#d3b089]/20 sm:p-8">
            <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-brand-500/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-brand-300/10 blur-3xl" />
            <div className="relative">
              <div className="text-[10px] font-semibold uppercase tracking-[0.4em] text-brand-300">Hi {firstName}</div>
              <h2 className="mt-2.5 max-w-2xl font-serif text-[30px] leading-[1.05] tracking-[-0.02em] sm:text-[40px]">I’m <span className="text-gilded-light italic">Harvey</span>, your Long Tail analyst.</h2>
              <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[#f3ebe1]/80">
                I know your sales, targets, stores, channels, products and inventory. Ask in plain words — I’ll pull the numbers from governed data,
                show them the way you need (charts, tables, side-by-side comparisons), explain what changed and why, and help you decide the next step.
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {["Sales & targets", "Stores & channels", "Products & inventory", "Charts · tables · X vs Y", "Why it changed", "What to do next"].map((c) => (
                  <span key={c} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11.5px] text-[#f3ebe1]/90 ring-1 ring-brand-300/25">{c}</span>
                ))}
              </div>
              <div className="mt-5">{composer(true)}</div>
              <div className="mt-2 text-[11px] text-[#f3ebe1]/50">Enter to send · Shift + Enter for a new line</div>
            </div>
          </section>

          {/* key points */}
          <div className="mt-3 grid gap-2.5 md:grid-cols-3">
            <KeyPoint icon={Timer} title="Answers take about 20–90 seconds">Depends on how many data lookups your question needs. You’ll see every step live while I work.</KeyPoint>
            <KeyPoint icon={ShieldCheck} title="Only your categories">{CATS.join(", ")} (and anything similar). Nothing else is mixed in — other questions are politely declined.</KeyPoint>
            <KeyPoint icon={NotebookPen} title="Respects team remarks">Context added in the Action Centre — stores that don’t carry a category, festival spikes, snoozes — shapes my answers.</KeyPoint>
          </div>

          {/* suggestions */}
          <div className="mt-6 flex items-baseline justify-between">
            <h3 className="font-serif text-[18px] text-ink">Try one of these</h3>
            <span className="text-[11.5px] text-zinc-400">Click to ask · follow up with “as a chart”, “only South”, “vs last month”</span>
          </div>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {GROUPS.map((g) => (
              <div key={g.key} className="card card-lift flex flex-col rounded-[18px] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><g.icon className="size-3.5" /></span>
                  <div className="leading-tight"><div className="text-[12.5px] font-semibold text-ink">{g.title}</div><div className="text-[10.5px] text-zinc-400">{g.hint}</div></div>
                </div>
                <div className="flex flex-col gap-1">
                  {g.qs.map((s) => (
                    <button key={s} onClick={() => ask(s)} className="group flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] leading-snug text-zinc-700 transition-colors hover:bg-brand-50 hover:text-brand-900">
                      <ChevronRight className="mt-0.5 size-3 shrink-0 text-zinc-300 group-hover:text-brand-500" />{s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-6 pb-32">
          {turns.map((t) => (
            <div key={t.key} className="space-y-3">
              <div className="flex justify-end">
                <div className="max-w-[78%] rounded-2xl rounded-br-md bg-brand-900 px-4 py-2.5 text-[13.5px] leading-relaxed text-[#f3ebe1] shadow-[0_4px_14px_rgba(110,69,38,.18)]">{t.question}</div>
              </div>
              <div className="flex items-start gap-3">
                <Avatar size={30} />
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-line bg-paper p-4 shadow-[0_1px_3px_rgba(60,40,20,.05)] sm:p-5">
                  {(t.running || (!t.answer && t.steps.length > 0)) && <Progress t={t} />}
                  {t.error && <div role="alert" className={cn("rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900", (t.running || t.steps.length > 0) && "mt-3")}>{t.error}</div>}
                  {t.answer && <AnswerView a={t.answer} onAsk={ask} />}
                  {t.answer && (
                    <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-zinc-100 pt-2.5 text-[11.5px] text-zinc-400">
                      {t.ms != null && <span className="mr-2 flex items-center gap-1"><Timer className="size-3" />Answered in {Math.round(t.ms / 1000)}s{t.steps.length ? ` · ${t.steps.length} lookup${t.steps.length > 1 ? "s" : ""}` : ""}</span>}
                      <button onClick={() => navigator.clipboard?.writeText(t.answer!.answer)} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-zinc-100 hover:text-zinc-700"><Copy className="size-3" />Copy</button>
                      {t.turnId && (
                        <span className="ml-auto flex items-center gap-1">Was this useful?
                          <button aria-label="Helpful" onClick={() => feedback(t, 1)} className={cn("rounded-md p-1 hover:bg-zinc-100", t.feedback === 1 && "bg-emerald-50 text-emerald-600")}><ThumbsUp className="size-3.5" /></button>
                          <button aria-label="Not helpful" onClick={() => feedback(t, -1)} className={cn("rounded-md p-1 hover:bg-zinc-100", t.feedback === -1 && "bg-rose-50 text-rose-600")}><ThumbsDown className="size-3.5" /></button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      {turns.length > 0 && (
        <div className="sticky bottom-0 z-30 -mx-1 bg-gradient-to-t from-canvas via-canvas/95 to-transparent px-1 pb-3 pt-8">
          {composer(false)}
          <div className="mt-1.5 text-center text-[10.5px] text-zinc-400">Harvey answers from governed data for {CATS.join(", ")} · answers take ~20–90 s</div>
        </div>
      )}
    </div>
  );
}

function KeyPoint({ icon: I, title, children }: { icon: typeof Zap; title: string; children: React.ReactNode }) {
  return (
    <div className="card flex gap-2.5 rounded-[18px] px-3.5 py-3 shadow-[0_1px_2px_rgba(60,40,20,.04)]">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><I className="size-3.5" /></span>
      <div className="min-w-0"><div className="text-[12.5px] font-semibold text-ink">{title}</div><div className="mt-0.5 text-[11.5px] leading-relaxed text-zinc-500">{children}</div></div>
    </div>
  );
}

function Progress({ t }: { t: Turn }) {
  const done = t.steps.filter((s) => s.state !== "start").length;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          {t.running ? <Loader2 className="size-4 animate-spin text-brand-600" /> : <Check className="size-4 text-emerald-600" />}
          {t.running ? t.status ?? "Working…" : "Stopped"}
        </div>
        {t.running && t.startedAt && <div className="flex items-center gap-1.5 text-[11.5px] text-zinc-400"><Timer className="size-3" /><Elapsed since={t.startedAt} /> · usually 20–90s</div>}
      </div>
      {t.running && <div className="mt-2 h-1 overflow-hidden rounded-full bg-brand-50"><div className="harvey-bar h-full w-1/3 rounded-full bg-gradient-to-r from-brand-300 via-brand-500 to-brand-700" /></div>}
      {t.steps.length > 0 && (
        <ol className="mt-3 space-y-1.5 border-l-2 border-brand-100 pl-3">
          {t.steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-[12.5px] text-zinc-600">
              {s.state === "start" ? <Loader2 className="size-3.5 animate-spin text-brand-500" /> : s.state === "done" ? <Check className="size-3.5 text-emerald-600" /> : <CircleAlert className="size-3.5 text-rose-600" />}
              <span className={cn(s.state === "start" && "text-ink")}>{s.label}</span>{s.detail && <span className="text-zinc-400">· {s.detail}</span>}
            </li>
          ))}
        </ol>
      )}
      {t.running && t.steps.length > 0 && <div className="mt-2 text-[11px] text-zinc-400">{done} of {t.steps.length} lookups complete</div>}
      <style>{`@keyframes harveyBar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}.harvey-bar{animation:harveyBar 1.6s ease-in-out infinite}`}</style>
    </div>
  );
}

function AnswerView({ a, onAsk }: { a: Answer; onAsk: (q: string) => void }) {
  const tag = (k: string) => ({ fact: "Fact", calculated: "Calculated", interpretation: "Interpretation" })[k] ?? k;
  const label = "mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400";
  return (
    <div className="space-y-4">
      <Md text={a.answer} />
      {a.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {a.metrics.map((m) => (
            <div key={m.label} className="relative overflow-hidden card rounded-[18px] px-3 py-2.5">
              <span className="absolute inset-x-0 top-0 h-[3px] bg-brand-500" />
              <div className="text-[11px] text-zinc-500">{m.label}</div>
              <div className="tabular mt-0.5 text-[18px] font-semibold tracking-[-0.02em] text-ink">{m.value}</div>
              {m.basis === "calculated" && <div className="text-[10.5px] text-zinc-400">calculated</div>}
            </div>
          ))}
        </div>
      )}
      {a.visualizations.length > 0 && <div className="grid gap-3">{a.visualizations.map((v, i) => <View key={i} v={v} />)}</div>}
      {a.insights.length > 0 && (
        <div>
          <div className={label}>What stands out</div>
          <ul className="space-y-1.5">{a.insights.map((x, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-zinc-800"><span className={cn("mt-0.5 h-fit shrink-0 rounded px-1.5 text-[10.5px] font-medium", x.kind === "interpretation" ? "bg-amber-50 text-amber-800" : x.kind === "calculated" ? "bg-brand-50 text-brand-800" : "bg-zinc-100 text-zinc-700")}>{tag(x.kind)}</span><span>{x.text}</span></li>
          ))}</ul>
        </div>
      )}
      {a.actions.length > 0 && (
        <div className="rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50/80 to-white p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-brand-700"><Target className="size-3.5" />Recommended next steps</div>
          <ol className="space-y-2">{a.actions.map((x, i) => (
            <li key={i} className="flex gap-2.5 text-[13px]">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-900 text-[10.5px] font-semibold text-white">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-zinc-800"><span className={cn("mr-1.5 rounded px-1.5 py-px text-[10px] font-semibold uppercase", x.priority === "high" ? "bg-rose-50 text-rose-700" : x.priority === "medium" ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-600")}>{x.priority}</span>{x.text}</div>
                <div className="mt-0.5 text-[11.5px] text-zinc-500">Evidence: {x.evidence}</div>
              </div>
            </li>
          ))}</ol>
        </div>
      )}
      {a.limitations.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-100"><b className="font-semibold">Keep in mind:</b> {a.limitations.join(" · ")}</div>
      )}
      {a.data_freshness.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500"><Database className="size-3 text-brand-500" />
          {a.data_freshness.map((f, i) => <span key={i}>{f.source.split(" (")[0]}{f.period ? ` · ${f.period}` : ""}{f.as_of ? ` · as of ${f.as_of.includes("T") ? new Date(f.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST" : f.as_of}` : ""}</span>)}
        </div>
      )}
      {a.follow_up_questions.length > 0 && (
        <div>
          <div className={label}>Ask next</div>
          <div className="flex flex-wrap gap-1.5">{a.follow_up_questions.slice(0, 4).map((q) => <button key={q} onClick={() => onAsk(q)} className="rounded-full border border-line bg-white px-3 py-1 text-[12px] text-zinc-700 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800">{q}</button>)}</div>
        </div>
      )}
    </div>
  );
}
