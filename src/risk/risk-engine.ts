/**
 * The deterministic risk engine.
 *
 * `evaluateTrade` is a pure function. Given the same account, positions, market
 * quote, proposal and policy it always returns the same verdict. No LLM takes
 * part in this decision, and no LLM output can alter it: the proposal is data
 * that gets measured, not an argument that gets weighed.
 */

import {
  checkCircuitBreaker,
  checkLeverage,
  checkOrderNotional,
  checkOrderSanity,
  checkPositionSize,
  dailyDrawdown,
  exposureForSymbol,
  projectedPortfolioExposure,
  signedNotional,
} from "./risk-rules";
import type { RiskCheck, RiskEvaluation, RiskEvaluationInput } from "./types";

export function evaluateTrade(input: RiskEvaluationInput): RiskEvaluation {
  const { account, positions, market, proposedTrade, policy } = input;

  // Every check always runs, so the UI can show the full risk report rather
  // than only the first failure.
  const circuitBreaker = checkCircuitBreaker(account, policy);
  const checks: RiskCheck[] = [
    circuitBreaker,
    checkPositionSize(account, positions, proposedTrade, policy),
    checkLeverage(account, positions, proposedTrade, policy),
    checkOrderNotional(account, proposedTrade, policy),
    checkOrderSanity(proposedTrade, market, policy),
  ];

  const failed = checks.filter((c) => !c.passed);

  // HALT dominates BLOCK: a tripped circuit breaker stops the trading day,
  // it does not merely reject one order.
  const decision = !circuitBreaker.passed ? "HALT" : failed.length > 0 ? "BLOCK" : "ALLOW";

  const reasons =
    decision === "ALLOW"
      ? [`All ${checks.length} risk checks passed.`]
      : failed.map((c) => `${c.label}: ${c.detail}`);

  const existingSymbolExposure = exposureForSymbol(positions, proposedTrade.symbol);
  const projectedSymbolExposure = Math.abs(
    existingSymbolExposure + signedNotional(proposedTrade.side, proposedTrade.notional),
  );
  const portfolioExposure = projectedPortfolioExposure(positions, proposedTrade);

  return {
    decision,
    reasons,
    checks,
    metrics: {
      currentEquity: account.equity,
      peakEquityToday: account.peakEquityToday,
      positionExposure: projectedSymbolExposure,
      portfolioExposure,
      leverage: proposedTrade.leverage,
      accountLeverageAfter: account.equity > 0 ? portfolioExposure / account.equity : Infinity,
      dailyDrawdown: dailyDrawdown(account),
    },
    policySnapshot: policy,
    evaluatedAt: Date.now(),
  };
}

/**
 * Risk-sensitive account operations that are not orders.
 *
 * An agent must not be able to sidestep the policy by raising leverage or
 * flipping margin mode first and placing a compliant-looking order second, so
 * these settings changes are evaluated against the same policy.
 */
export type AccountOperation =
  | { kind: "SET_LEVERAGE"; symbol: string; leverage: number }
  | { kind: "SET_MARGIN_MODE"; symbol: string; mode: "ISOLATED" | "CROSSED" }
  | { kind: "CANCEL_ORDER"; symbol: string; orderId: string };

export interface OperationEvaluation {
  decision: "ALLOW" | "BLOCK" | "HALT";
  reasons: string[];
}

export function evaluateAccountOperation(
  op: AccountOperation,
  account: RiskEvaluationInput["account"],
  policy: RiskEvaluationInput["policy"],
): OperationEvaluation {
  // Cancelling reduces exposure, so it stays available even while halted.
  if (op.kind === "CANCEL_ORDER") {
    return { decision: "ALLOW", reasons: ["Cancelling an order reduces exposure."] };
  }

  const breaker = checkCircuitBreaker(account, policy);
  if (!breaker.passed) {
    return { decision: "HALT", reasons: [`Drawdown circuit breaker: ${breaker.detail}`] };
  }

  if (op.kind === "SET_LEVERAGE") {
    // Checked before the comparison: NaN and Infinity both compare false
    // against the limit, so an unvalidated figure would be waved through.
    if (!Number.isInteger(op.leverage) || op.leverage < 1) {
      return {
        decision: "BLOCK",
        reasons: [`${String(op.leverage)} is not a valid leverage setting for ${op.symbol}.`],
      };
    }
    if (op.leverage > policy.maxLeverage) {
      return {
        decision: "BLOCK",
        reasons: [
          `Setting ${op.symbol} leverage to ${op.leverage}x exceeds the ${policy.maxLeverage}x policy limit.`,
        ],
      };
    }
    return { decision: "ALLOW", reasons: [`${op.leverage}x is within the policy limit.`] };
  }

  // Switching to CROSSED puts the whole sub-account balance behind the
  // position, which raises portfolio risk, so it is treated as risk-increasing.
  if (op.mode === "CROSSED") {
    return {
      decision: "BLOCK",
      reasons: [
        `Switching ${op.symbol} to CROSSED margin exposes the full account balance to the position. Fentra keeps agent-managed positions ISOLATED.`,
      ],
    };
  }
  return { decision: "ALLOW", reasons: ["ISOLATED margin limits loss to the position margin."] };
}
