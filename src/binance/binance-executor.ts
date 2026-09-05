/**
 * Live Binance executor (USDⓈ-M futures).
 *
 * Uses the documented signed REST scheme with a user-issued API key. This is
 * the officially supported programmatic path for a self-built agent backend;
 * see README "Binance integration findings" for why the hosted Agent OS MCP
 * server is not usable from a server-side application.
 *
 * Defaults to the futures testnet. Live trading requires
 * BINANCE_TESTNET=false to be set deliberately.
 */

import { loadCredentials, signedRequest, type BinanceCredentials } from "./binance-client";
import { getPublicMarketData } from "./market-data";
import type { ApprovedTrade, ExecutionResult, TradingExecutor, Venue } from "./types";
import type { AccountState, MarketState, Position } from "@/risk/types";

interface FuturesAccount {
  totalMarginBalance: string;
  availableBalance: string;
  positions: Array<{
    symbol: string;
    positionAmt: string;
    entryPrice: string;
    leverage: string;
    unrealizedProfit: string;
  }>;
}

interface OrderResponse {
  orderId: number;
  status: string;
  avgPrice?: string;
  executedQty?: string;
  origQty?: string;
}

export class BinanceExecutor implements TradingExecutor {
  readonly venue: Venue;

  constructor(private readonly creds: BinanceCredentials) {
    this.venue = creds.testnet ? "BINANCE_TESTNET" : "BINANCE_LIVE";
  }

  static fromEnv(): BinanceExecutor | null {
    const creds = loadCredentials();
    return creds ? new BinanceExecutor(creds) : null;
  }

  async describeConnection() {
    try {
      await signedRequest<FuturesAccount>(this.creds, "GET", "/fapi/v2/account");
      return {
        connected: true,
        label: this.creds.testnet ? "Binance Connected (Testnet)" : "Binance Connected (Live)",
        detail: `USDⓈ-M futures via signed REST at ${this.creds.futuresBase}.`,
      };
    } catch (err) {
      return {
        connected: false,
        label: "Binance Unreachable",
        detail: err instanceof Error ? err.message : "Unknown error contacting Binance.",
      };
    }
  }

  private async account(): Promise<FuturesAccount> {
    return signedRequest<FuturesAccount>(this.creds, "GET", "/fapi/v2/account");
  }

  async getAccountState(): Promise<AccountState> {
    const acct = await this.account();
    const equity = Number(acct.totalMarginBalance);
    return {
      equity,
      availableBalance: Number(acct.availableBalance),
      // The intraday high-water mark is tracked by the control plane, which
      // has continuity across polls; Binance does not expose it.
      peakEquityToday: equity,
      startOfDayEquity: equity,
      tradingHalted: false,
    };
  }

  async getPositions(): Promise<Position[]> {
    const acct = await this.account();
    return acct.positions
      .filter((p) => Number(p.positionAmt) !== 0)
      .map((p) => {
        const amt = Number(p.positionAmt);
        const entry = Number(p.entryPrice);
        return {
          symbol: p.symbol,
          side: amt > 0 ? ("LONG" as const) : ("SHORT" as const),
          notional: Math.abs(amt) * entry,
          entryPrice: entry,
          markPrice: entry,
          leverage: Number(p.leverage),
          unrealizedPnl: Number(p.unrealizedProfit),
        };
      });
  }

  async getMarketData(symbol: string): Promise<MarketState> {
    return getPublicMarketData(symbol);
  }

  async executeTrade(trade: ApprovedTrade): Promise<ExecutionResult> {
    const market = await getPublicMarketData(trade.symbol);
    if (market.price <= 0) {
      return {
        ok: false,
        venue: this.venue,
        simulated: false,
        message: `No usable price for ${trade.symbol}; order not submitted.`,
      };
    }

    const quantity = trimQuantity(trade.notional / market.price);

    try {
      // Leverage is set first because it is part of the approved trade, and it
      // has already cleared the same policy that cleared the order.
      await signedRequest(this.creds, "POST", "/fapi/v1/leverage", {
        symbol: trade.symbol,
        leverage: trade.leverage,
      }).catch(() => undefined);

      const order = await signedRequest<OrderResponse>(this.creds, "POST", "/fapi/v1/order", {
        symbol: trade.symbol,
        side: trade.side,
        type: trade.type,
        quantity,
        ...(trade.type === "LIMIT" ? { price: trade.price, timeInForce: "GTC" } : {}),
        newClientOrderId: `fentra-${trade.approvalId.slice(0, 20)}`,
      });

      return {
        ok: true,
        venue: this.venue,
        simulated: false,
        orderId: String(order.orderId),
        filledPrice: order.avgPrice ? Number(order.avgPrice) : undefined,
        filledQty: Number(order.executedQty ?? order.origQty ?? quantity),
        message: `Order ${order.orderId} ${order.status} on ${
          this.creds.testnet ? "Binance futures testnet" : "Binance futures"
        }.`,
        raw: order,
      };
    } catch (err) {
      return {
        ok: false,
        venue: this.venue,
        simulated: false,
        message: err instanceof Error ? err.message : "Binance rejected the order.",
      };
    }
  }
}

/** Binance rejects over-precise quantities; 3dp is safe for the tracked symbols. */
function trimQuantity(qty: number): string {
  return qty.toFixed(3);
}
