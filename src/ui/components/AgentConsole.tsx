"use client";

import { useEffect, useRef, useState } from "react";
import { clockTime, verdictWord, type ChatMessage, type Stage } from "@/ui/types";
import { DECISION_THEME } from "@/ui/types";
import { Button, Empty, Panel, Status } from "./primitives";

const SUGGESTIONS = [
  "Analyze BTC and find a trade opportunity.",
  "Open a $2,000 BTCUSDT long at 3x.",
  "Go long BTCUSDT with $2,000 at 10x leverage.",
  "Put $5,000 into BTCUSDT at 3x.",
];

/**
 * The agent, presented as an operator rather than a chatbot.
 *
 * Its output is prose; the parameters it proposes are rendered by the
 * proposal and risk-engine panels instead, so nothing important is left
 * buried in a message.
 */
export function AgentConsole({
  messages,
  onSend,
  stage,
  agentConfigured,
  agentModel,
  halted,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  stage: Stage;
  agentConfigured: boolean;
  agentModel: string;
  halted: boolean;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = stage === "PROPOSING";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, stage]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setInput("");
  }

  const status =
    stage === "PROPOSING"
      ? { tone: "accent" as const, text: "Analyzing", pulse: true }
      : stage === "EVALUATING"
        ? { tone: "accent" as const, text: "Proposal ready", pulse: true }
        : { tone: "ok" as const, text: "Waiting", pulse: false };

  return (
    <Panel
      titleAccent
      label="Agent"
      className="min-h-0 flex-1"
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
      meta={
        <>
          <Status tone={status.tone} pulse={status.pulse}>
            {status.text}
          </Status>
          <span
            className="hidden font-mono text-[11px] uppercase tracking-label text-faint lg:inline"
            title={
              agentConfigured
                ? "Claude model with read tools plus propose_trade"
                : "No ANTHROPIC_API_KEY — a deterministic proposer submits through the same gate"
            }
          >
            {agentConfigured ? agentModel : "fallback proposer"}
          </span>
        </>
      }
    >
      <div
        ref={scrollRef}
        className="min-h-[220px] flex-1 space-y-4 overflow-y-auto px-5 py-4 lg:min-h-0"
      >
        {messages.length === 0 ? (
          <div className="py-2">
            <Empty
              title="No session activity"
              body="The agent reads market and account state, then submits a proposal. It has no tool that places an order."
            />
            <div className="mt-1 space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="block w-full border border-line bg-sunken px-3 py-2 text-left text-[13px] leading-snug text-ash transition-colors duration-150 hover:border-ink/30 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="animate-fade-up">
              <div className="mb-1.5 font-mono text-[11px] uppercase tracking-label text-faint">
                Operator
              </div>
              <div className="border-l-2 border-ink/20 pl-3 text-[14.5px] leading-relaxed text-ink">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="animate-fade-up">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-label text-accent">
                  Fentra Agent
                </span>
                {m.usedFallback ? (
                  <span className="font-mono text-[10.5px] uppercase tracking-label text-faint">
                    deterministic proposer
                  </span>
                ) : null}
              </div>
              <div
                className={`whitespace-pre-wrap text-[14.5px] leading-relaxed ${
                  m.error ? "text-block" : "text-ash"
                }`}
              >
                {m.text}
              </div>
              {m.records?.length ? (
                <div className="mt-2 space-y-1">
                  {m.records.map((r) => {
                    const theme = DECISION_THEME[r.evaluation.decision];
                    return (
                      <div
                        key={r.id}
                        className={`flex flex-wrap items-center gap-x-2 gap-y-1 border px-2.5 py-1.5 font-mono text-[11.5px] uppercase tracking-label ${theme.border} ${theme.bg} ${theme.text}`}
                      >
                        <span>{verdictWord(r.evaluation.decision)}</span>
                        <span className="text-faint">·</span>
                        <span className="normal-case tracking-normal text-ash">
                          {r.trade.symbol} {r.trade.side} ${r.trade.notional.toLocaleString("en-US")}{" "}
                          {r.trade.leverage}x
                        </span>
                        <span className="ml-auto normal-case tracking-normal text-faint">
                          {clockTime(r.timestamp)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ),
        )}

        {busy ? (
          <div className="flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-label text-accent">
            <span className="h-[5px] w-[5px] animate-dot-pulse rounded-full bg-accent" />
            Reading market and account state…
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="flex shrink-0 items-center gap-2 border-t border-line p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder={halted ? "Trading halted — proposals still evaluate" : "Instruct the agent…"}
          className="min-w-0 flex-1 border border-line bg-sunken px-3 py-2 text-[14.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-ink/40 disabled:opacity-50"
        />
        <Button type="submit" variant="primary" disabled={busy || !input.trim()}>
          Send
        </Button>
      </form>
    </Panel>
  );
}
