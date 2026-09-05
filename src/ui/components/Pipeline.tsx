"use client";

import type { Decision } from "@/risk/types";
import type { Stage } from "@/ui/types";
import { Dot } from "./primitives";

/* ------------------------------------------------------------------ *
 * The execution boundary.
 *
 * AI AGENT -> FENTRA RISK ENGINE -> BINANCE. The agent has no edge
 * to the exchange: the only path runs through the gate, and the second
 * edge lights up only on ALLOW. This is the product in one picture.
 * ------------------------------------------------------------------ */

interface PipelineProps {
  stage: Stage;
  decision: Decision | null;
  agentLabel: string;
  venueLabel: string;
  venueConnected: boolean;
  halted: boolean;
  /** Compact variant for the control plane; the hero uses the full one. */
  dense?: boolean;
}

const EDGE_COLOR: Record<Decision, string> = {
  ALLOW: "bg-allow",
  BLOCK: "bg-block",
  HALT: "bg-halt",
};

export function Pipeline({
  stage,
  decision,
  agentLabel,
  venueLabel,
  venueConnected,
  halted,
  dense = false,
}: PipelineProps) {
  const proposing = stage === "PROPOSING";
  const evaluating = stage === "EVALUATING";
  const decided = stage === "DECIDED" && decision !== null;
  const allowed = decided && decision === "ALLOW";
  const refused = decided && decision !== "ALLOW";

  const agentState = proposing ? "ANALYZING" : evaluating || decided ? "PROPOSED" : "READY";
  const engineState = halted
    ? "HALTED"
    : evaluating
      ? "EVALUATING"
      : decided && decision
        ? decision
        : "ENFORCING";

  return (
    <div className={dense ? "px-4 py-5" : "px-5 py-8 sm:px-8 sm:py-10"}>
      {/* Desktop: left-to-right pipeline. */}
      <div className="hidden items-stretch md:flex">
        <Node
          title="AI AGENT"
          sub={agentLabel}
          state={agentState}
          tone={proposing ? "accent" : "idle"}
          pulse={proposing}
          dense={dense}
        />
        <EdgeX
          caption="proposes"
          active={proposing || evaluating}
          done={decided}
          color="bg-ink/25"
        />
        <GateNode
          state={engineState}
          decision={decided ? decision : null}
          evaluating={evaluating}
          dense={dense}
        />
        <EdgeX
          caption={refused ? "no path" : "approved only"}
          active={false}
          done={allowed}
          blocked={refused}
          color={decided && decision ? EDGE_COLOR[decision] : "bg-ink/25"}
        />
        <Node
          title="BINANCE"
          sub={venueLabel}
          state={venueConnected ? "CONNECTED" : "SIMULATED"}
          tone={allowed ? "ok" : "idle"}
          dense={dense}
        />
      </div>

      {/* Mobile: top-to-bottom, same three nodes, same rules. */}
      <div className="flex flex-col md:hidden">
        <Node
          title="AI AGENT"
          sub={agentLabel}
          state={agentState}
          tone={proposing ? "accent" : "idle"}
          pulse={proposing}
          dense
          stacked
        />
        <EdgeY caption="proposes" active={proposing || evaluating} done={decided} />
        <GateNode
          state={engineState}
          decision={decided ? decision : null}
          evaluating={evaluating}
          dense
          stacked
        />
        <EdgeY
          caption={refused ? "no path" : "approved only"}
          active={false}
          done={allowed}
          blocked={refused}
          color={decided && decision ? EDGE_COLOR[decision] : undefined}
        />
        <Node
          title="BINANCE"
          sub={venueLabel}
          state={venueConnected ? "CONNECTED" : "SIMULATED"}
          tone={allowed ? "ok" : "idle"}
          dense
          stacked
        />
      </div>
    </div>
  );
}

function Node({
  title,
  sub,
  state,
  tone,
  pulse = false,
  dense,
  stacked = false,
}: {
  title: string;
  sub: string;
  state: string;
  tone: "idle" | "accent" | "ok";
  pulse?: boolean;
  dense: boolean;
  stacked?: boolean;
}) {
  const toneText = tone === "accent" ? "text-accent" : tone === "ok" ? "text-allow" : "text-mute";
  return (
    <div
      className={`flex flex-col justify-center border border-line bg-paper transition-colors duration-300 ${
        stacked ? "w-full px-4 py-3" : dense ? "w-[186px] px-4 py-3" : "w-[218px] px-5 py-4"
      }`}
    >
      <div
        className={`font-mono uppercase tracking-label text-ink ${dense ? "text-[12.5px]" : "text-[14px]"}`}
      >
        {title}
      </div>
      <div className="mt-1.5 truncate font-mono text-[11.5px] text-faint">{sub}</div>
      <div
        className={`mt-2.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-label ${toneText}`}
      >
        <Dot tone={tone} pulse={pulse} />
        {state}
      </div>
    </div>
  );
}

/** The gate. Solid ink so it dominates both flanking nodes at any size. */
function GateNode({
  state,
  decision,
  evaluating,
  dense,
  stacked = false,
}: {
  state: string;
  decision: Decision | null;
  evaluating: boolean;
  dense: boolean;
  stacked?: boolean;
}) {
  const stateColor =
    decision === "ALLOW"
      ? "text-allow"
      : decision === "BLOCK"
        ? "text-block"
        : decision === "HALT"
          ? "text-halt"
          : evaluating
            ? "text-white"
            : "text-white/60";

  const stateDot =
    decision === "ALLOW"
      ? "bg-allow"
      : decision === "BLOCK"
        ? "bg-block"
        : decision === "HALT"
          ? "bg-halt"
          : "bg-white/70";

  return (
    <div
      className={`relative flex flex-col justify-center overflow-hidden bg-ink text-white ${
        stacked
          ? "w-full px-4 py-4"
          : dense
            ? "min-w-[236px] flex-1 px-5 py-4"
            : "min-w-[276px] flex-1 px-6 py-5"
      }`}
    >
      {evaluating ? (
        <span
          aria-hidden
          className="absolute top-0 h-full w-[40%] animate-sweep bg-gradient-to-r from-transparent via-white/[0.09] to-transparent"
        />
      ) : null}
      <div className="relative">
        <div
          className={`font-mono uppercase tracking-label ${dense ? "text-[12.5px]" : "text-[14px]"}`}
        >
          Fentra Risk Engine
        </div>
        <div className="mt-1.5 font-mono text-[11.5px] uppercase tracking-label text-white/40">
          Policy gate
        </div>
        <div
          className={`mt-2.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-label ${stateColor}`}
        >
          <span
            className={`inline-block h-[5px] w-[5px] rounded-full ${stateDot} ${
              evaluating ? "animate-dot-pulse" : ""
            }`}
          />
          {state}
        </div>
      </div>
    </div>
  );
}

function EdgeX({
  caption,
  active,
  done,
  blocked = false,
  color = "bg-ink/25",
}: {
  caption: string;
  active: boolean;
  done?: boolean;
  blocked?: boolean;
  color?: string;
}) {
  return (
    <div className="relative flex min-w-[72px] flex-1 flex-col items-center justify-center px-2">
      <span className="mb-2 font-mono text-[10.5px] lowercase tracking-wide text-faint">{caption}</span>
      <div className="relative h-px w-full">
        <div
          className={`h-px w-full transition-colors duration-300 ${
            blocked ? "bg-block/25" : done || active ? color : "bg-line"
          }`}
        />
        {active ? (
          <span
            aria-hidden
            className="flow-dot-x absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
          />
        ) : null}
        {blocked ? (
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-block/40 bg-paper font-mono text-[10.5px] leading-none text-block"
          >
            &#10005;
          </span>
        ) : null}
      </div>
      <span
        aria-hidden
        className={`mt-[-4px] self-end text-[9px] leading-none ${
          blocked ? "text-block/40" : done || active ? "text-ink/40" : "text-faint"
        }`}
      >
        &#9654;
      </span>
    </div>
  );
}

function EdgeY({
  caption,
  active,
  done,
  blocked = false,
  color,
}: {
  caption: string;
  active: boolean;
  done?: boolean;
  blocked?: boolean;
  color?: string;
}) {
  return (
    <div className="relative flex items-center gap-3 py-1 pl-6">
      <div className="relative h-9 w-px">
        <div
          className={`h-full w-px transition-colors duration-300 ${
            blocked ? "bg-block/30" : done || active ? (color ?? "bg-ink/30") : "bg-line"
          }`}
        />
        {active ? (
          <span
            aria-hidden
            className="flow-dot-y absolute left-1/2 h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-accent"
          />
        ) : null}
      </div>
      <span
        className={`font-mono text-[10.5px] lowercase tracking-wide ${
          blocked ? "text-block/70" : "text-faint"
        }`}
      >
        {blocked ? "blocked - no path to execution" : caption}
      </span>
    </div>
  );
}
