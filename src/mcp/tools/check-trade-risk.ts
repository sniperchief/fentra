import { z } from "zod";
import type { ControlPlane } from "@/server/control-plane";
import { coerceProposal } from "@/agent/tools";
import { TRACKED_SYMBOLS } from "@/binance/market-data";
import type { CheckTradeRiskResult } from "./types";

/**
 * `fentra.check_trade_risk` — the primary tool.
 *
 * Evaluates a proposed trade against the live account, open positions, current
 * market quote and the configured policy, and returns ALLOW / BLOCK / HALT.
 *
 * It delegates to `ControlPlane.evaluateOnly`, which calls the same
 * `evaluateTrade` the application's own gate uses. There is no second copy of
 * the risk rules here, and this path never touches the executor or history.
 */

export const checkTradeRiskInput = {
  symbol: z
    .string()
    .describe(`Trading pair, e.g. ${TRACKED_SYMBOLS[0]}. Tracked: ${TRACKED_SYMBOLS.join(", ")}.`),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
  notional: z.number().positive().describe("Order value in USDT."),
  leverage: z.number().int().min(1).default(1).describe("Whole-number leverage; 1 for spot."),
  price: z.number().positive().optional().describe("Required for LIMIT orders."),
  market: z.enum(["SPOT", "USDM_FUTURES"]).default("USDM_FUTURES"),
};

export const CheckTradeRiskArgs = z.object(checkTradeRiskInput);
export type CheckTradeRiskArgs = z.infer<typeof CheckTradeRiskArgs>;

export async function checkTradeRisk(
  cp: ControlPlane,
  args: CheckTradeRiskArgs,
): Promise<CheckTradeRiskResult> {
  // Reuses the agent-side coercion so a proposal arriving over MCP is
  // normalised exactly like one arriving from the in-process agent.
  const proposal = coerceProposal(args as unknown as Record<string, unknown>);
  const evaluation = await cp.evaluateOnly(proposal);

  const equity = evaluation.metrics.currentEquity;

  return {
    decision: evaluation.decision,
    // ALLOW carries a single "all checks passed" line internally; agents want
    // reasons to mean "why not", so it is empty unless something failed.
    reasons: evaluation.decision === "ALLOW" ? [] : evaluation.reasons,
    checks: evaluation.checks.map((c) => ({
      check: c.label,
      passed: c.passed,
      detail: c.detail,
    })),
    metrics: {
      currentEquity: equity,
      positionExposure: equity > 0 ? evaluation.metrics.positionExposure / equity : 0,
      positionExposureUsd: evaluation.metrics.positionExposure,
      leverage: evaluation.metrics.leverage,
      accountLeverageAfter: evaluation.metrics.accountLeverageAfter,
      dailyDrawdown: evaluation.metrics.dailyDrawdown,
    },
    executed: false,
    note: "Advisory verdict only. Fentra placed no order; execution remains with your authorized Binance capability.",
  };
}
