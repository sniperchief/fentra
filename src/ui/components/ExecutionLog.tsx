"use client";

import { Fragment, useState } from "react";
import type { TradeRecord } from "@/server/control-plane";
import { DECISION_THEME, clockTime, usd0, verdictWord } from "@/ui/types";
import { Empty, Label, Panel } from "./primitives";

/**
 * The audit trail. Every proposal that reached the gate, allowed or not,
 * with the reason attached — which is the point of an enforcement layer.
 */
export function ExecutionLog({
  history,
  selectedId,
  onSelect,
}: {
  history: TradeRecord[];
  selectedId: string | null;
  onSelect: (record: TradeRecord) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const blocked = history.filter((r) => r.evaluation.decision !== "ALLOW").length;

  return (
    <Panel
      titleAccent
      label="Execution Log"
      className="flex-1"
      bodyClassName="p-0"
      meta={
        <span className="font-mono text-[11px] uppercase tracking-label text-faint">
          {history.length} evaluated · {blocked} refused
        </span>
      }
    >
      {history.length === 0 ? (
        <Empty
          title="No proposals yet"
          body="Every evaluation is recorded here with the policy reason behind its verdict."
        />
      ) : (
        <div className="max-h-[360px] overflow-x-auto overflow-y-auto">
          {/* Desktop: dense audit table. */}
          <table className="hidden w-full border-collapse sm:table">
            <thead className="sticky top-0 z-10 bg-paper">
              <tr className="border-b border-line text-left">
                {["Time", "Symbol", "Side", "Notional", "Leverage", "Result", "Execution"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`px-5 py-2 font-mono text-[10.5px] font-normal uppercase tracking-label text-mute ${
                        i >= 3 && i <= 4 ? "text-right" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const theme = DECISION_THEME[r.evaluation.decision];
                const isOpen = expanded === r.id;
                const isSelected = selectedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => {
                        onSelect(r);
                        setExpanded(isOpen ? null : r.id);
                      }}
                      className={`cursor-pointer border-b border-hair font-mono text-[12.5px] tnum transition-colors hover:bg-sunken ${
                        isSelected ? "bg-sunken" : ""
                      }`}
                    >
                      <td className="px-5 py-2 text-faint">{clockTime(r.timestamp)}</td>
                      <td className="px-5 py-2 text-ink">{r.trade.symbol}</td>
                      <td
                        className={`px-5 py-2 ${
                          r.trade.side === "BUY" ? "text-allow" : "text-block"
                        }`}
                      >
                        {r.trade.side}
                      </td>
                      <td className="px-5 py-2 text-right text-ash">{usd0(r.trade.notional)}</td>
                      <td className="px-5 py-2 text-right text-ash">{r.trade.leverage}x</td>
                      <td className={`px-5 py-2 uppercase tracking-label ${theme.text}`}>
                        {verdictWord(r.evaluation.decision)}
                      </td>
                      <td className="px-5 py-2 text-faint">
                        {r.execution
                          ? r.execution.simulated
                            ? "simulated fill"
                            : `${r.execution.venue.toLowerCase().replace("_", " ")}`
                          : "never reached executor"}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-hair bg-sunken">
                        <td colSpan={7} className="px-5 py-3">
                          <Reasons record={r} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Mobile: one block per evaluation, verdict first. */}
          <div className="divide-y divide-hair sm:hidden">
            {history.map((r) => {
              const theme = DECISION_THEME[r.evaluation.decision];
              const isOpen = expanded === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    onSelect(r);
                    setExpanded(isOpen ? null : r.id);
                  }}
                  className="block w-full px-5 py-3 text-left"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`font-mono text-[12.5px] uppercase tracking-label ${theme.text}`}>
                      {verdictWord(r.evaluation.decision)}
                    </span>
                    <span className="font-mono text-[11.5px] text-faint">
                      {clockTime(r.timestamp)}
                    </span>
                  </div>
                  <div className="mt-1.5 font-mono text-[13px] tnum text-ash">
                    {r.trade.symbol} · {r.trade.side} · {usd0(r.trade.notional)} ·{" "}
                    {r.trade.leverage}x
                  </div>
                  {isOpen ? (
                    <div className="mt-2.5">
                      <Reasons record={r} />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Reasons({ record }: { record: TradeRecord }) {
  const decision = record.evaluation.decision;
  const theme = DECISION_THEME[decision];
  return (
    <div>
      <Label className={theme.text}>
        {decision === "ALLOW" ? "All checks passed" : "Reason"}
      </Label>
      <ul className="mt-1.5 space-y-1">
        {record.evaluation.reasons.map((reason, i) => (
          <li key={i} className="text-[13px] leading-relaxed text-ash">
            {reason}
          </li>
        ))}
      </ul>
      {record.execution ? (
        <p className="mt-2 font-mono text-[11.5px] text-faint">{record.execution.message}</p>
      ) : (
        <p className="mt-2 font-mono text-[11.5px] uppercase tracking-label text-faint">
          Executor never called
        </p>
      )}
    </div>
  );
}
