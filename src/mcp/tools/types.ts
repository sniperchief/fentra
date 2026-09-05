/**
 * Wire shapes for the Fentra MCP tools.
 *
 * The engine works in fractions (0.20); agents reading a tool result work in
 * percentages (20). These types are the translation boundary — nothing here
 * recomputes a limit or a verdict, it only renames and rescales what the
 * risk engine already produced.
 */

import type { Decision, OrderNotionalMode } from "@/risk/types";

export interface CheckTradeRiskResult {
  decision: Decision;
  /** Empty on ALLOW; one entry per failed check otherwise. */
  reasons: string[];
  checks: Array<{ check: string; passed: boolean; detail: string }>;
  metrics: {
    currentEquity: number;
    /** Exposure in this symbol after the fill, as a fraction of equity. */
    positionExposure: number;
    positionExposureUsd: number;
    leverage: number;
    accountLeverageAfter: number;
    dailyDrawdown: number;
  };
  /** Stated on every response so a verdict can never be mistaken for a fill. */
  executed: false;
  note: string;
}

export interface RiskPolicyResult {
  maxPositionPercent: number;
  maxLeverage: number;
  maxDailyDrawdownPercent: number;
  /** Resolved to USDT even when the policy is expressed as a share of equity. */
  maxOrderNotional: number;
  maxOrderNotionalMode: OrderNotionalMode;
  maxPriceDeviationPercent: number;
}

export interface RiskStatusResult {
  status: "ACTIVE" | "HALTED";
  currentEquity: number;
  peakEquityToday: number;
  dailyDrawdown: number;
  largestPositionPercent: number;
  openExposure: number;
  accountLeverage: number;
  tradingHalted: boolean;
  haltReason?: string;
}
