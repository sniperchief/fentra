"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import type { TradeRecord } from "@/server/control-plane";
import { AccountPanel } from "@/ui/components/AccountPanel";
import { ActivityStream } from "@/ui/components/ActivityStream";
import { AgentConsole } from "@/ui/components/AgentConsole";
import { ExecutionLog } from "@/ui/components/ExecutionLog";
import { PolicyPanel } from "@/ui/components/PolicyPanel";
import { RiskEngine, DecisionSummary } from "@/ui/components/RiskEngine";
import { ScenarioPanel } from "@/ui/components/ScenarioPanel";
import { HaltBanner, TopBar, Wordmark } from "@/ui/components/Shell";
import { TradeProposal } from "@/ui/components/TradeProposal";
import { Label } from "@/ui/components/primitives";
import {
  clockTime,
  policyRev,
  type AppState,
  type ChatMessage,
  type ScenarioSummary,
  type Stage,
} from "@/ui/types";

/** Milliseconds between check reveals while a verdict is presented. */
const REVEAL_STEP = 170;

export default function ControlPlane() {
  const [state, setState] = useState<AppState | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<Anthropic.MessageParam[]>([]);
  const [scenarioBusy, setScenarioBusy] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  /* Verdict presentation. `record` is always something the server produced. */
  const [stage, setStage] = useState<Stage>("IDLE");
  const [record, setRecord] = useState<TradeRecord | null>(null);
  const [revealed, setRevealed] = useState(0);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  /**
   * Puts a server-produced record on screen. `animate` staggers the check
   * reveal; the verdict itself is never computed here, only displayed.
   */
  const present = useCallback((next: TradeRecord, animate: boolean) => {
    clearTimers();
    setRecord(next);
    const total = next.evaluation.checks.length;
    if (!animate) {
      setRevealed(total);
      setStage("DECIDED");
      return;
    }
    setRevealed(0);
    setStage("EVALUATING");
    for (let i = 1; i <= total; i++) {
      timers.current.push(setTimeout(() => setRevealed(i), i * REVEAL_STEP));
    }
    timers.current.push(setTimeout(() => setStage("DECIDED"), total * REVEAL_STEP + 200));
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) return;
    const next: AppState = await res.json();
    setState(next);
    setSyncedAt(Date.now());
    // On a reload, adopt the most recent evaluation rather than showing an
    // empty engine next to a populated audit log.
    setRecord((current) => {
      if (current || next.history.length === 0) return current;
      const latest = next.history[0];
      setRevealed(latest.evaluation.checks.length);
      setStage("DECIDED");
      return latest;
    });
  }, []);

  useEffect(() => {
    refresh();
    fetch("/api/scenarios")
      .then((r) => r.json())
      .then((d) => setScenarios(d.scenarios ?? []))
      .catch(() => undefined);
    // Live prices and equity move, so poll rather than snapshot once.
    const timer = setInterval(refresh, 6000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function sendMessage(text: string) {
    setMessages((m) => [...m, { role: "user", text }]);
    clearTimers();
    setRecord(null);
    setRevealed(0);
    setStage("PROPOSING");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The agent failed to respond.");

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.reply,
          records: data.records,
          usedFallback: data.usedFallback,
        },
      ]);
      // Keep a compact transcript for model context; tool turns are re-derived.
      setHistory((h) => [
        ...h,
        { role: "user", content: text },
        { role: "assistant", content: data.reply || "(no reply)" },
      ]);

      const produced: TradeRecord[] = data.records ?? [];
      if (produced.length > 0) present(produced[produced.length - 1], true);
      else setStage("IDLE");
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: err instanceof Error ? err.message : "Request failed.",
          error: true,
        },
      ]);
      setStage("IDLE");
    } finally {
      refresh();
    }
  }

  async function runScenario(id: string) {
    setScenarioBusy(id);
    clearTimers();
    setRecord(null);
    setRevealed(0);
    setStage("EVALUATING");
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.record) {
        const scenario = scenarios.find((s) => s.id === id);
        setMessages((m) => [
          ...m,
          { role: "user", text: `Run proof scenario: ${scenario?.title ?? id}` },
          {
            role: "assistant",
            text: "Proposal submitted through the control plane.",
            records: [data.record],
          },
        ]);
        present(data.record, true);
      } else {
        setStage("IDLE");
      }
    } catch {
      setStage("IDLE");
    } finally {
      setScenarioBusy(null);
      refresh();
    }
  }

  async function reset() {
    await fetch("/api/reset", { method: "POST" });
    clearTimers();
    setMessages([]);
    setHistory([]);
    setRecord(null);
    setRevealed(0);
    setStage("IDLE");
    refresh();
  }

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Wordmark />
          <div className="relative h-px w-32 overflow-hidden bg-line">
            <span className="absolute top-0 h-px w-[40%] animate-sweep bg-accent" />
          </div>
          <span className="font-mono text-[11px] uppercase tracking-label text-mute">
            Connecting to control plane
          </span>
        </div>
      </main>
    );
  }

  const halted = state.snapshot.account.tradingHalted;
  const settled = stage === "DECIDED" && record !== null;
  const proposer = state.agentConfigured
    ? `Fentra Agent · ${state.agentModel}`
    : "Fentra Agent · deterministic proposer";

  return (
    <>
      <TopBar state={state} cta={{ label: "Overview", href: "/" }} />

      <main className="mx-auto max-w-[1560px] px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-[10px] w-[2px] bg-accent" />
              <Label className="text-accent">Control plane</Label>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-ash">
              Autonomous trading with deterministic risk controls. Every trade proposal is evaluated
              before execution.
            </p>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-label text-faint">
            {syncedAt ? `Synced ${clockTime(syncedAt)}` : "Syncing…"}
          </span>
        </div>

        {halted ? (
          <div className="mb-5">
            <HaltBanner state={state} />
          </div>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
          {/* Verdict, hoisted above the fold on narrow screens. */}
          <DecisionSummary record={record} settled={settled} className="order-1 lg:hidden" />

          {/* Row 1 — where the operator works, and the state being measured.
              Both self-stretch so the pair shares one height. */}
          <div className="order-2 flex min-h-[440px] lg:order-none lg:col-span-6 lg:self-stretch">
            <AgentConsole
              messages={messages}
              onSend={sendMessage}
              stage={stage}
              agentConfigured={state.agentConfigured}
              agentModel={state.agentModel}
              halted={halted}
            />
          </div>
          <div className="order-3 flex lg:order-none lg:col-span-6 lg:self-stretch">
            <AccountPanel snapshot={state.snapshot} policy={state.policy} />
          </div>

          {/* Row 2 — the proposal on the table, and how to put one there. */}
          <div className="order-4 flex lg:order-none lg:col-span-6 lg:self-stretch">
            <TradeProposal record={record} stage={stage} settled={settled} proposer={proposer} />
          </div>
          <div className="order-5 flex lg:order-none lg:col-span-6 lg:self-stretch">
            <ScenarioPanel
              scenarios={scenarios}
              onRun={runScenario}
              busy={scenarioBusy}
              onReset={reset}
            />
          </div>

          {/* Row 3 — the verdict, across the full width. */}
          <div className="order-6 flex lg:order-none lg:col-span-12">
            <RiskEngine
              record={record}
              stage={stage}
              revealed={revealed}
              halted={halted}
              policyRev={policyRev(state.policy)}
            />
          </div>

          {/* Row 4 — the policy behind the verdict, and the trace of it. */}
          <div className="order-7 flex lg:order-none lg:col-span-6 lg:self-stretch">
            <PolicyPanel
              policy={state.policy}
              equity={state.snapshot.account.equity}
              onSaved={(p) => setState((s) => (s ? { ...s, policy: p } : s))}
            />
          </div>
          <div className="order-8 flex lg:order-none lg:col-span-6 lg:self-stretch">
            <ActivityStream history={state.history} />
          </div>

          {/* Row 5 — the audit trail, across the full width. */}
          <div className="order-9 flex lg:order-none lg:col-span-12">
            <ExecutionLog
              history={state.history}
              selectedId={record?.id ?? null}
              onSelect={(r) => present(r, false)}
            />
          </div>
        </div>

        <footer className="mt-10 border-t border-line pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="max-w-[70ch] text-[13px] leading-relaxed text-faint">
              The agent proposes; application code decides. The model has no tool that places an
              order, changes leverage, or edits the risk policy — execution is reachable only through
              the control plane after an ALLOW verdict.
            </p>
            <span className="font-mono text-[11px] uppercase tracking-label text-faint">
              Fentra · Binance Agent OS · Track A
            </span>
          </div>
        </footer>
      </main>
    </>
  );
}
