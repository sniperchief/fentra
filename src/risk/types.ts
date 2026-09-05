/**
 * Core domain types for Fentra's deterministic risk layer.
 *
 * Nothing in this file depends on Binance, on the UI, or on the LLM.
 * The risk engine operates purely on these structures.
 */

export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type MarketKind = "SPOT" | "USDM_FUTURES";

/** A trade the agent wants to make. Produced by the LLM, never trusted. */
export interface ProposedTrade {
  symbol: string;
  side: Side;
  type: OrderType;
  /** Order value in quote currency (USDT). */
  notional: number;
  /** Requested leverage. Always 1 for spot. */
  leverage: number;
  /** Required for LIMIT orders; ignored for MARKET. */
  price?: number;
  market: MarketKind;
  /** Free-text rationale from the agent. Never used in the decision. */
  rationale?: string;
}

export interface AccountState {
  /** Total account value in USDT, including unrealised PnL. */
  equity: number;
  availableBalance: number;
  /** Intraday high-water mark of equity, reset daily. */
  peakEquityToday: number;
  /** Equity at the start of the current trading day. */
  startOfDayEquity: number;
  /** True once the circuit breaker has latched for the day. */
  tradingHalted: boolean;
  haltReason?: string;
}

export interface Position {
  symbol: string;
  side: "LONG" | "SHORT";
  /** Absolute exposure in USDT at current mark price. */
  notional: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  unrealizedPnl: number;
}

export interface MarketState {
  symbol: string;
  price: number;
  /** 24h price change percent, informational only. */
  priceChangePercent: number;
  /** Where the quote came from, so the UI can never overstate liveness. */
  source: "BINANCE_PUBLIC" | "BINANCE_ACCOUNT" | "SYNTHETIC";
  /** Highest leverage the venue permits for this symbol. */
  venueMaxLeverage: number;
  fetchedAt: number;
}

/**
 * How `maxOrderNotional` is interpreted.
 *
 * ABSOLUTE is a flat USDT ceiling. PCT_OF_EQUITY expresses the same limit as a
 * fraction of equity, so the per-order cap scales with the account instead of
 * meaning something different at $5,000 than at $500,000.
 */
export type OrderNotionalMode = "ABSOLUTE" | "PCT_OF_EQUITY";

export interface RiskPolicy {
  /** Max exposure in one symbol as a fraction of equity. 0.20 = 20%. */
  maxPositionSizePct: number;
  maxLeverage: number;
  /** Intraday drawdown from the equity high-water mark that halts trading. */
  maxDailyDrawdownPct: number;
  /** USDT when mode is ABSOLUTE; a fraction of equity when PCT_OF_EQUITY. */
  maxOrderNotional: number;
  maxOrderNotionalMode: OrderNotionalMode;
  /** Max |limit price - mark price| / mark price. */
  maxPriceDeviationPct: number;
}

export type Decision = "ALLOW" | "BLOCK" | "HALT";

export type CheckId =
  | "circuit_breaker"
  | "position_size"
  | "leverage"
  | "order_notional"
  | "order_sanity";

export interface RiskCheck {
  id: CheckId;
  label: string;
  passed: boolean;
  /** Human-readable numbers behind the verdict, shown in the UI. */
  detail: string;
  observed?: number;
  limit?: number;
}

export interface RiskMetrics {
  currentEquity: number;
  peakEquityToday: number;
  /** Exposure in the proposed symbol after the trade would fill. */
  positionExposure: number;
  /** Total portfolio exposure after the trade would fill. */
  portfolioExposure: number;
  /** Requested order leverage. */
  leverage: number;
  /** Portfolio exposure / equity after the trade. */
  accountLeverageAfter: number;
  dailyDrawdown: number;
}

export interface RiskEvaluation {
  decision: Decision;
  reasons: string[];
  checks: RiskCheck[];
  metrics: RiskMetrics;
  policySnapshot: RiskPolicy;
  evaluatedAt: number;
}

export interface RiskEvaluationInput {
  account: AccountState;
  positions: Position[];
  market: MarketState;
  proposedTrade: ProposedTrade;
  policy: RiskPolicy;
}
