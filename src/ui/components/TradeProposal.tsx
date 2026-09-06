"use client";

import type { TradeRecord } from "@/server/control-plane";
import { DECISION_THEME, clockTime, usd0, verdictWord, type Stage } from "@/ui/types";
import { Chip, Empty, Label, Metric, Panel, Status } from "./primitives";

/**
 * The proposal, lifted out of the chat transcript.
 *
 * Trade parameters are the thing a risk operator has to see, so they get
 * structure and typography rather than a sentence in a message bubble.
 */
export function TradeProposal({
  record,
  stage,
  settled,
  proposer,
}: {
  record: TradeRecord | null;
  stage: Stage;
  /** True once the risk engine reveal has finished for this record. */
  settled: boolean;
  proposer: string;
}) {
  const decision = record?.evaluation.decision ?? null;
  const theme = decision ? DECISION_THEME[decision] : null;

  // Clearing the risk engine is not the same as filling. An ALLOW whose order
  // the venue then rejected must never read as executed.
  const execution = record?.execution;
  const allowStatus = !execution
    ? { text: "Cleared · not executed", tone: "warn" as const }
    : execution.ok
      ? {
          text: execution.simulated ? "Cleared · simulated fill" : "Cleared · executed",
          tone: "ok" as const,
        }
      : { text: "Cleared · execution failed", tone: "crit" as const };

  const status = !record
    ? stage === "PROPOSING"
      ? { text: "Composing proposal", tone: "accent" as const }
      : { text: "No active proposal", tone: "idle" as const }
    : !settled
      ? { text: "Awaiting risk evaluation", tone: "accent" as const }
      : decision === "ALLOW"
        ? allowStatus
        : decision === "BLOCK"
          ? { text: "Refused at the gate", tone: "warn" as const }
          : { text: "Refused · trading halted", tone: "crit" as const };

  return (
    <Panel
      label="Trade Proposal"
      className="flex-1"
      bodyClassName="p-0"
      meta={
        record ? (
          <span className="font-mono text-[11px] uppercase tracking-label text-faint">
            {clockTime(record.timestamp)}
          </span>
        ) : null
      }
    >
      {!record ? (
        <Empty
          title={stage === "PROPOSING" ? "Agent working" : "Idle"}
          body="Proposals appear here the moment the agent submits one, with every parameter the risk engine will measure."
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3.5">
            <div className="min-w-0">
              <div className="font-mono text-[24px] font-semibold leading-none tracking-tight text-ink">
                {record.trade.symbol}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`font-mono text-[14px] uppercase tracking-label ${
                    record.trade.side === "BUY" ? "text-allow" : "text-block"
                  }`}
                >
                  {record.trade.side}
                </span>
                <span className="text-faint">·</span>
                <span className="font-mono text-[12.5px] uppercase tracking-label text-ash">
                  {record.trade.type}
                </span>
              </div>
            </div>
            <Chip>{record.trade.market === "SPOT" ? "Spot" : "USDⓈ-M"}</Chip>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-hair px-5 py-3.5">
            <Metric label="Notional" value={usd0(record.trade.notional)} />
            <Metric label="Leverage" value={`${record.trade.leverage}x`} />
          </div>

          <div className="space-y-3 border-t border-hair px-5 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label>Proposed by</Label>
              <span className="truncate font-mono text-[12.5px] text-ink">{proposer}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <Label>Status</Label>
              <Status tone={status.tone} pulse={!settled && Boolean(record)}>
                {status.text}
              </Status>
            </div>
            {record.agentRationale ? (
              <div>
                <Label>Rationale</Label>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ash">
                  {record.agentRationale}
                </p>
              </div>
            ) : null}
          </div>

          {settled && decision && theme ? (
            <div
              className={`flex items-center justify-between border-t px-5 py-2.5 ${theme.border} ${theme.bg}`}
            >
              <span className={`font-mono text-[12.5px] uppercase tracking-label ${theme.text}`}>
                {verdictWord(decision)}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-label text-faint">
                by risk engine
              </span>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
