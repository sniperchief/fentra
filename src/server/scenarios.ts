/**
 * Seeded demo scenarios.
 *
 * Each one submits a real proposal through the real control plane, so what the
 * judge sees on screen is the production code path, not a scripted animation.
 */

import type { ProposedTrade } from "@/risk/types";

export interface Scenario {
  id: string;
  title: string;
  expected: "ALLOW" | "BLOCK" | "HALT";
  summary: string;
  trade: ProposedTrade;
  /** Stages an intraday loss before submitting, for the circuit-breaker demo. */
  stageDrawdown?: { peakEquity: number; currentEquity: number };
}

export const SCENARIOS: Scenario[] = [
  {
    id: "safe",
    title: "Safe trade",
    expected: "ALLOW",
    summary: "$2,000 at 3x sits inside every limit.",
    trade: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      notional: 2000,
      leverage: 3,
      market: "USDM_FUTURES",
      rationale: "Baseline compliant trade.",
    },
  },
  {
    id: "leverage",
    title: "Excessive leverage",
    expected: "BLOCK",
    summary: "10x against a 5x policy limit.",
    trade: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      notional: 2000,
      leverage: 10,
      market: "USDM_FUTURES",
      rationale: "Agent reaches for leverage the policy forbids.",
    },
  },
  {
    id: "position",
    title: "Oversized position",
    expected: "BLOCK",
    summary: "$5,000 exceeds 20% of equity, even at compliant leverage.",
    trade: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      notional: 5000,
      leverage: 3,
      market: "USDM_FUTURES",
      rationale: "Leverage is fine; the size is not.",
    },
  },
  {
    id: "drawdown",
    title: "Drawdown circuit breaker",
    expected: "HALT",
    summary: "Equity drops 6% from the intraday peak, then a compliant trade is refused.",
    stageDrawdown: { peakEquity: 11000, currentEquity: 10340 },
    trade: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      notional: 2000,
      leverage: 3,
      market: "USDM_FUTURES",
      rationale: "Identical to the safe trade, refused because the day is halted.",
    },
  },
];

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
