import type { AccountState, MarketState, Position, ProposedTrade } from "@/risk/types";

/** Where an order actually went. Never used to describe a simulated fill. */
export type Venue = "DEMO" | "BINANCE_TESTNET" | "BINANCE_LIVE";

/**
 * A trade that has cleared the risk engine. The only way to construct one is
 * through the control plane after an ALLOW verdict, which is why the executor
 * accepts nothing else.
 */
export interface ApprovedTrade extends ProposedTrade {
  readonly approvalId: string;
  readonly approvedAt: number;
}

export interface ExecutionResult {
  ok: boolean;
  venue: Venue;
  /** True when no order reached a Binance matching engine. */
  simulated: boolean;
  orderId?: string;
  filledPrice?: number;
  filledQty?: number;
  message: string;
  raw?: unknown;
}

/**
 * The whole exchange surface the application is allowed to touch.
 * Swapping Binance for another venue means writing one more implementation of
 * this interface; nothing above it changes.
 */
export interface TradingExecutor {
  readonly venue: Venue;
  /** Human-readable connection state for the UI status pill. */
  describeConnection(): Promise<{ connected: boolean; label: string; detail: string }>;
  getAccountState(): Promise<AccountState>;
  getPositions(): Promise<Position[]>;
  getMarketData(symbol: string): Promise<MarketState>;
  executeTrade(trade: ApprovedTrade): Promise<ExecutionResult>;
}
