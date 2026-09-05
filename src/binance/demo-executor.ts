/**
 * Demo executor.
 *
 * Simulates fills against live public Binance prices and keeps a local
 * portfolio in memory. It never contacts a Binance trading endpoint and never
 * reports otherwise: every result carries `simulated: true` and venue "DEMO",
 * and the UI renders that verbatim.
 */

import { getPublicMarketData } from "./market-data";
import type { ApprovedTrade, ExecutionResult, TradingExecutor } from "./types";
import type { AccountState, MarketState, Position } from "@/risk/types";

export interface DemoPortfolio {
  equity: number;
  availableBalance: number;
  peakEquityToday: number;
  startOfDayEquity: number;
  positions: Position[];
}

/** Target size of the seeded open position, in USDT. */
const SEED_POSITION_NOTIONAL = 1400;
/** Seeded entry sits 1.2% below market, so the position shows a small gain. */
const SEED_ENTRY_DISCOUNT = 0.988;

/**
 * Seeded so the four demo scenarios land on distinct verdicts:
 * equity 10,482.21 with a 20% cap leaves 2,096.44 of room per symbol, so a
 * 2,000 BTC order clears and a 5,000 one does not.
 */
export function seedPortfolio(): DemoPortfolio {
  return {
    equity: 10482.21,
    availableBalance: 8900.15,
    peakEquityToday: 10650.0,
    startOfDayEquity: 10299.79,
    positions: [
      {
        symbol: "ETHUSDT",
        side: "LONG",
        notional: SEED_POSITION_NOTIONAL,
        // Placeholder prices, replaced with live ones on the first read so the
        // seeded position does not show an invented profit or loss.
        entryPrice: 0,
        markPrice: 0,
        leverage: 3,
        unrealizedPnl: 0,
      },
    ],
  };
}

/** Restores the seeded positions without clearing the halt latch. */
export function resetPositions(portfolio: DemoPortfolio): void {
  const fresh = seedPortfolio();
  portfolio.positions = fresh.positions;
  portfolio.availableBalance = fresh.availableBalance;
}

export class DemoExecutor implements TradingExecutor {
  readonly venue = "DEMO" as const;

  constructor(private readonly portfolio: DemoPortfolio) {}

  async describeConnection() {
    return {
      connected: false,
      label: "Demo Mode",
      detail:
        "Live public Binance market data. Orders are simulated locally and never sent to Binance.",
    };
  }

  async getAccountState(): Promise<AccountState> {
    return {
      equity: round2(this.portfolio.equity),
      availableBalance: round2(this.portfolio.availableBalance),
      peakEquityToday: round2(this.portfolio.peakEquityToday),
      startOfDayEquity: round2(this.portfolio.startOfDayEquity),
      // The halt latch lives in the control plane, which owns it across
      // executors; the executor itself never decides whether trading is halted.
      tradingHalted: false,
    };
  }

  async getPositions(): Promise<Position[]> {
    // Refresh marks from live prices so exposure and PnL move like the real thing.
    const refreshed = await Promise.all(
      this.portfolio.positions.map(async (p) => {
        const market = await getPublicMarketData(p.symbol);
        if (market.price <= 0) return p;

        // First read of a seeded position: anchor it to the live market.
        if (p.markPrice <= 0) {
          const entryPrice = market.price * SEED_ENTRY_DISCOUNT;
          const qty = p.notional / market.price;
          return {
            ...p,
            entryPrice,
            markPrice: market.price,
            unrealizedPnl: round2(qty * (market.price - entryPrice)),
          };
        }

        const qty = p.notional / p.markPrice;
        const direction = p.side === "LONG" ? 1 : -1;
        return {
          ...p,
          markPrice: market.price,
          notional: round2(qty * market.price),
          unrealizedPnl: round2(direction * qty * (market.price - p.entryPrice)),
        };
      }),
    );
    this.portfolio.positions = refreshed;
    return refreshed;
  }

  async getMarketData(symbol: string): Promise<MarketState> {
    return getPublicMarketData(symbol);
  }

  async executeTrade(trade: ApprovedTrade): Promise<ExecutionResult> {
    const market = await getPublicMarketData(trade.symbol);
    const fillPrice = trade.type === "LIMIT" && trade.price ? trade.price : market.price;

    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
      return {
        ok: false,
        venue: "DEMO",
        simulated: true,
        message: `No usable price for ${trade.symbol}; simulated order not filled.`,
      };
    }

    const qty = trade.notional / fillPrice;
    this.applyFill(trade, fillPrice, qty);

    return {
      ok: true,
      venue: "DEMO",
      simulated: true,
      orderId: `demo-${trade.approvalId.slice(0, 8)}`,
      filledPrice: fillPrice,
      filledQty: qty,
      message: `Simulated ${trade.side} of ${qty.toFixed(6)} ${trade.symbol} at ${fillPrice.toFixed(
        2,
      )}. No order was sent to Binance.`,
    };
  }

  /** Nets the fill into any existing position for the symbol. */
  private applyFill(trade: ApprovedTrade, fillPrice: number, qty: number) {
    const idx = this.portfolio.positions.findIndex((p) => p.symbol === trade.symbol);
    const signedQty = trade.side === "BUY" ? qty : -qty;

    if (idx === -1) {
      this.portfolio.positions.push({
        symbol: trade.symbol,
        side: signedQty > 0 ? "LONG" : "SHORT",
        notional: round2(Math.abs(signedQty) * fillPrice),
        entryPrice: fillPrice,
        markPrice: fillPrice,
        leverage: trade.leverage,
        unrealizedPnl: 0,
      });
    } else {
      const existing = this.portfolio.positions[idx];
      const existingQty = (existing.side === "LONG" ? 1 : -1) * (existing.notional / existing.markPrice);
      const netQty = existingQty + signedQty;

      if (Math.abs(netQty) < 1e-9) {
        this.portfolio.positions.splice(idx, 1);
      } else {
        const sameDirection = Math.sign(netQty) === Math.sign(existingQty);
        this.portfolio.positions[idx] = {
          ...existing,
          side: netQty > 0 ? "LONG" : "SHORT",
          // Averaging only applies when adding to the position.
          entryPrice: sameDirection
            ? (existing.entryPrice * Math.abs(existingQty) + fillPrice * Math.abs(signedQty)) /
              (Math.abs(existingQty) + Math.abs(signedQty))
            : fillPrice,
          markPrice: fillPrice,
          notional: round2(Math.abs(netQty) * fillPrice),
          leverage: trade.leverage,
          unrealizedPnl: 0,
        };
      }
    }

    // Margin posted for the position reduces free balance.
    this.portfolio.availableBalance = round2(
      this.portfolio.availableBalance - trade.notional / Math.max(trade.leverage, 1),
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
