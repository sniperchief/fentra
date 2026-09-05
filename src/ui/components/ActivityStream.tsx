"use client";

import type { TradeRecord } from "@/server/control-plane";
import type { CheckId } from "@/risk/types";
import { DECISION_THEME, clockTime, verdictWord } from "@/ui/types";
import { Empty, LeaderRow, Panel, Status } from "./primitives";

const CHECK_SHORT: Record<CheckId, string> = {
  position_size: "Position size",
  leverage: "Leverage",
  order_notional: "Notional",
  order_sanity: "Market sanity",
  circuit_breaker: "Drawdown",
};

/**
 * A running trace of what the system did, reconstructed from the records the
 * control plane returned. Timestamps are the real ones, not display time.
 */
export function ActivityStream({ history }: { history: TradeRecord[] }) {
  const recent = history.slice(0, 6);

  return (
    <Panel
      label="System Activity"
      className="flex-1"
      bodyClassName="p-0"
      meta={<Status tone={recent.length ? "ok" : "idle"}>{recent.length ? "Streaming" : "Idle"}</Status>}
    >
      {recent.length === 0 ? (
        <Empty
          title="No events"
          body="Proposal, evaluation and execution events appear here as they happen."
        />
      ) : (
        <div className="max-h-[320px] divide-y divide-hair overflow-y-auto">
          {recent.map((r) => {
            const theme = DECISION_THEME[r.evaluation.decision];
            const ts = clockTime(r.timestamp);
            const decidedAt = clockTime(r.evaluation.evaluatedAt);
            return (
              <div key={r.id} className="animate-fade-up px-5 py-3.5">
                <Event time={ts}>
                  {r.agentRationale ? "Agent" : "Operator"} submitted {r.trade.symbol}{" "}
                  {r.trade.side.toLowerCase()} proposal.
                </Event>
                <Event time={ts}>Risk engine evaluating against active policy.</Event>

                <div className="my-2 space-y-1 border-l border-hair py-0.5 pl-3">
                  {r.evaluation.checks.map((c) => (
                    <LeaderRow
                      key={c.id}
                      left={CHECK_SHORT[c.id]}
                      right={c.passed ? "PASS" : "FAIL"}
                      tone={c.passed ? "ok" : "warn"}
                    />
                  ))}
                </div>

                <Event time={decidedAt}>
                  <span className={`font-mono uppercase tracking-label ${theme.text}`}>
                    Risk decision: {r.evaluation.decision}
                  </span>
                </Event>
                <Event time={decidedAt}>
                  {r.execution
                    ? r.execution.simulated
                      ? "Execution simulated locally — no order sent to Binance."
                      : `Order submitted to ${r.execution.venue.toLowerCase().replace("_", " ")}.`
                    : `Execution prevented — proposal ${verdictWord(
                        r.evaluation.decision,
                      ).toLowerCase()} at the gate.`}
                </Event>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function Event({ time, children }: { time: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-[3px]">
      <span className="shrink-0 font-mono text-[11.5px] tnum text-faint">{time}</span>
      <span className="min-w-0 text-[13px] leading-relaxed text-ash">{children}</span>
    </div>
  );
}
