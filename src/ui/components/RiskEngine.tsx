"use client";

import type { TradeRecord } from "@/server/control-plane";
import type { CheckId, RiskCheck } from "@/risk/types";
import {
  DECISION_COPY,
  DECISION_THEME,
  clockTime,
  num,
  pct,
  usd,
  usd0,
  type Stage,
} from "@/ui/types";
import { Chip, Empty, Label, LimitBar, Panel, Status } from "./primitives";

/* ------------------------------------------------------------------ *
 * The risk engine panel: the hero component.
 *
 * Everything rendered here comes from the RiskEvaluation the server
 * produced. The only thing the UI adds is the order the checks appear
 * in and the reveal timing; no verdict is computed on the client.
 * ------------------------------------------------------------------ */

/** Judge-facing names for the engine's check ids. */
const CHECK_TITLE: Record<CheckId, string> = {
  position_size: "Position size",
  leverage: "Leverage",
  order_notional: "Order notional",
  order_sanity: "Market sanity",
  circuit_breaker: "Daily drawdown",
};

/** Reading order for the panel: order rules first, circuit breaker last. */
const DISPLAY_ORDER: CheckId[] = [
  "position_size",
  "leverage",
  "order_notional",
  "order_sanity",
  "circuit_breaker",
];

function orderChecks(checks: RiskCheck[]): RiskCheck[] {
  return [...checks].sort(
    (a, b) => DISPLAY_ORDER.indexOf(a.id) - DISPLAY_ORDER.indexOf(b.id),
  );
}

/** Observed-against-limit readout for one check, in that check's own units. */
function readout(check: RiskCheck): { value: string; limit: string; ratio: number | null } {
  const o = check.observed;
  const l = check.limit;
  const ratio = typeof o === "number" && typeof l === "number" && l > 0 ? o / l : null;

  switch (check.id) {
    case "position_size":
    case "order_notional":
      return {
        value: typeof o === "number" ? usd0(o) : "—",
        limit: typeof l === "number" ? usd0(l) : "—",
        ratio,
      };
    case "leverage":
      return {
        value: typeof o === "number" ? `${num(o, Number.isInteger(o) ? 0 : 2)}x` : "—",
        limit: typeof l === "number" ? `${num(l, 0)}x` : "—",
        ratio,
      };
    case "circuit_breaker":
      return {
        value: typeof o === "number" ? pct(o) : "—",
        limit: typeof l === "number" ? pct(l) : "—",
        ratio,
      };
    case "order_sanity":
      return {
        value: check.passed ? "Within tolerance" : "Rejected",
        limit: typeof l === "number" ? `±${pct(l, 1)} dev` : "—",
        ratio: typeof o === "number" && o > 0 ? ratio : null,
      };
  }
}

export function RiskEngine({
  record,
  stage,
  revealed,
  halted,
  policyRev,
}: {
  record: TradeRecord | null;
  stage: Stage;
  /** How many checks are currently visible; drives the evaluation reveal. */
  revealed: number;
  halted: boolean;
  policyRev: string;
}) {
  const evaluating = stage === "EVALUATING" || stage === "PROPOSING";
  const evaluation = record?.evaluation ?? null;
  const checks = evaluation ? orderChecks(evaluation.checks) : [];
  const showDecision = Boolean(evaluation) && revealed >= checks.length && stage !== "PROPOSING";
  const decision = evaluation?.decision ?? null;
  const theme = decision ? DECISION_THEME[decision] : null;

  return (
    <Panel
      accent
      titleAccent
      id="risk-engine"
      label={
        <span className="flex items-baseline gap-2">
          Risk Engine
          <span className="text-accent/50">/ v1</span>
        </span>
      }
      bodyClassName="flex flex-1 flex-col"
      className="min-h-0 flex-1 scroll-mt-20"
      meta={
        <>
          <Status tone={halted ? "crit" : "ok"} pulse={!halted}>
            {halted ? "Latched" : "Enforcing"}
          </Status>
          <span className="hidden font-mono text-[11px] uppercase tracking-label text-faint sm:inline">
            Policy rev {policyRev}
          </span>
        </>
      }
    >
      {/* Context strip: what is being evaluated, and when. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-2.5">
        {record ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12.5px]">
            <span className="font-medium text-ink">{record.trade.symbol}</span>
            <span className={record.trade.side === "BUY" ? "text-allow" : "text-block"}>
              {record.trade.side}
            </span>
            <span className="text-ash tnum">{usd0(record.trade.notional)}</span>
            <span className="text-ash tnum">{record.trade.leverage}x</span>
            <span className="text-faint">
              {record.trade.type} · {record.trade.market === "SPOT" ? "SPOT" : "USDⓈ-M"}
            </span>
          </div>
        ) : (
          <span className="font-mono text-[11.5px] uppercase tracking-label text-faint">
            Policy evaluation
          </span>
        )}
        <span className="font-mono text-[11px] uppercase tracking-label text-faint">
          {evaluation
            ? `Last evaluation ${clockTime(evaluation.evaluatedAt)}`
            : "No evaluation yet"}
        </span>
      </div>

      {!record && !evaluating ? (
        <div className="flex flex-1 items-center justify-center">
          <Empty
            title="Awaiting proposal"
            body="Ask the agent for a trade, or run a scenario. Every proposal is measured against the active policy before it can reach execution."
          />
        </div>
      ) : null}

      {evaluating && !record ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 py-10">
            <span className="font-mono text-[11.5px] uppercase tracking-label text-accent">
              {stage === "PROPOSING" ? "Agent analyzing market…" : "Evaluating against policy…"}
            </span>
            <div className="relative h-px w-40 overflow-hidden bg-hair">
              <span className="absolute top-0 h-px w-[40%] animate-sweep bg-accent" />
            </div>
          </div>
        </div>
      ) : null}

      {record && checks.length > 0 ? (
        <>
          <div className="flex-1 divide-y divide-hair">
            {checks.map((check, i) => (
              <CheckRow key={check.id} check={check} visible={i < revealed} index={i} />
            ))}
          </div>

          <div className="border-t border-line">
            {showDecision && decision && theme ? (
              <DecisionBlock record={record} />
            ) : (
              <div className="flex items-center gap-3 px-5 py-7">
                <span className="h-[5px] w-[5px] animate-dot-pulse rounded-full bg-ink" />
                <span className="font-mono text-[12.5px] uppercase tracking-label text-ink">
                  Evaluating risk…
                </span>
                <span className="ml-auto font-mono text-[11.5px] tabular-nums text-faint">
                  {Math.min(revealed, checks.length)}/{checks.length}
                </span>
              </div>
            )}
          </div>
        </>
      ) : null}
    </Panel>
  );
}

function CheckRow({ check, visible, index }: { check: RiskCheck; visible: boolean; index: number }) {
  const { value, limit, ratio } = readout(check);
  const tone = check.passed ? "ok" : "warn";

  return (
    <div
      className={`px-5 py-4 transition-opacity duration-200 ${
        visible ? "animate-fade-up opacity-100" : "opacity-0"
      }`}
      style={{ animationDelay: visible ? `${Math.min(index, 6) * 20}ms` : undefined }}
      aria-hidden={!visible}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-ink/60">{CHECK_TITLE[check.id]}</Label>
        <span
          className={`shrink-0 font-mono text-[11.5px] uppercase tracking-label ${
            check.passed ? "text-allow" : "text-block"
          }`}
        >
          {check.passed ? "✓ Pass" : "✕ Fail"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[15px] tnum">
        <span className={check.passed ? "text-ink" : "text-block"}>{value}</span>
        <span className="text-faint">/</span>
        <span className="text-ash">{limit}</span>
        {ratio !== null ? (
          <span className="ml-auto text-[11.5px] text-faint">{(ratio * 100).toFixed(0)}% of limit</span>
        ) : null}
      </div>

      {ratio !== null ? (
        <div className="mt-2">
          <LimitBar ratio={ratio} tone={tone} animate={visible} />
        </div>
      ) : null}

      <p className="mt-2 max-w-[86ch] text-[13px] leading-relaxed text-ash">{check.detail}</p>
    </div>
  );
}

/** The verdict. Deliberately the largest type in the application. */
function DecisionBlock({ record }: { record: TradeRecord }) {
  const { evaluation, execution } = record;
  const decision = evaluation.decision;
  const theme = DECISION_THEME[decision];
  const copy = DECISION_COPY[decision];
  const failed = evaluation.checks.filter((c) => !c.passed);

  return (
    <div className="animate-fade-up">
      <div className={`flex items-stretch border-l-2 ${theme.border} ${theme.bg}`}>
        <div className="flex-1 px-5 py-6">
          <Label>Decision</Label>
          <div className={`mt-3 font-mono text-[46px] font-semibold leading-none ${theme.text}`}>
            {copy.title}
          </div>
          <p className={`mt-2 text-[14px] leading-snug ${theme.text} opacity-80`}>{copy.caption}</p>
        </div>
        <div className="hidden w-[188px] shrink-0 flex-col justify-center gap-2 border-l border-line/70 px-5 py-4 sm:flex">
          <div>
            <Label>Checks</Label>
            <div className="mt-1.5 font-mono text-[15px] tnum text-ink">
              {evaluation.checks.length - failed.length}/{evaluation.checks.length} passed
            </div>
          </div>
          <div>
            <Label>Execution</Label>
            <div
              className={`mt-1.5 font-mono text-[12.5px] uppercase tracking-label ${
                decision === "ALLOW" ? "text-allow" : "text-block"
              }`}
            >
              {decision === "ALLOW" ? "Submitted" : "Prevented"}
            </div>
          </div>
        </div>
      </div>

      {/* Why it was refused, in the units the policy is written in. */}
      {failed.length > 0 ? (
        <div className="space-y-3 border-t border-line px-5 py-3.5">
          {failed.map((c) => (
            <div key={c.id}>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[11.5px] uppercase tracking-label ${theme.text}`}>
                  {decision === "HALT" && c.id === "circuit_breaker"
                    ? "Circuit breaker"
                    : "Policy violation"}
                </span>
                <span className="font-mono text-[11.5px] uppercase tracking-label text-faint">
                  {CHECK_TITLE[c.id]}
                </span>
              </div>
              {typeof c.observed === "number" && typeof c.limit === "number" ? (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Requested</Label>
                    <div className={`mt-1.5 font-mono text-[17px] tnum ${theme.text}`}>
                      {readout(c).value}
                    </div>
                  </div>
                  <div>
                    <Label>Maximum allowed</Label>
                    <div className="mt-1.5 font-mono text-[17px] tnum text-ink">
                      {readout(c).limit}
                    </div>
                  </div>
                </div>
              ) : null}
              <p className="mt-2 text-[13px] leading-relaxed text-ash">{c.detail}</p>
            </div>
          ))}
          <p className="border-t border-hair pt-2.5 font-mono text-[11.5px] uppercase tracking-label text-faint">
            This trade cannot reach execution.
          </p>
        </div>
      ) : null}

      {/* Execution receipt. Simulated fills are never dressed as real ones. */}
      {execution ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-5 py-3">
          <Chip tone={execution.simulated ? "neutral" : "ok"}>
            {execution.simulated ? "Simulated" : execution.venue.replace("_", " ")}
          </Chip>
          <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-ash">
            {execution.message}
          </span>
          {execution.filledPrice ? (
            <span className="font-mono text-[12px] tnum text-faint">
              @ {usd(execution.filledPrice)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact verdict banner for narrow screens, where the full engine panel sits
 * below the fold. Same record, same decision — just hoisted.
 */
export function DecisionSummary({
  record,
  settled,
  className = "",
}: {
  record: TradeRecord | null;
  settled: boolean;
  className?: string;
}) {
  if (!record || !settled) return null;
  const decision = record.evaluation.decision;
  const theme = DECISION_THEME[decision];
  const copy = DECISION_COPY[decision];

  return (
    <a
      href="#risk-engine"
      className={`block animate-fade-up border ${theme.border} ${theme.bg} ${className}`}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <Label>Risk decision</Label>
          <div className={`mt-1.5 font-mono text-[28px] font-semibold leading-none ${theme.text}`}>
            {copy.title}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-[12.5px] tnum text-ash">
          <div className="text-ink">{record.trade.symbol}</div>
          <div className="mt-1">
            {record.trade.side} · {usd0(record.trade.notional)} · {record.trade.leverage}x
          </div>
        </div>
      </div>
      <p className={`border-t px-5 py-2 text-[12.5px] leading-relaxed ${theme.border} ${theme.text} opacity-80`}>
        {copy.caption}
      </p>
    </a>
  );
}
