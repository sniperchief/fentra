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
  cumQuote?: string;
}

/**
 * Order states in which nothing is working and nothing filled. Binance answers
 * HTTP 200 for these, so a successful request does not by itself mean the
 * order reached the book.
 */
const DEAD_STATUSES = new Set(["REJECTED", "EXPIRED", "EXPIRED_IN_MATCH", "CANCELED"]);

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
      .filter((p) => Number.isFinite(Number(p.positionAmt)) && Number(p.positionAmt) !== 0)
      .map((p) => {
        const amt = Number(p.positionAmt);
        const entry = Number(p.entryPrice);
        const pnl = Number(p.unrealizedProfit);

        // Exposure has to be measured at the mark, not at the entry. The
        // account endpoint does not return a mark price, but it is implied by
        // the unrealised PnL: mark = entry + pnl/amt, signed by the side.
        // Valuing a winning position at its entry understates exposure, and
        // the position-size rule would then allow more than the policy permits.
        const mark =
          Number.isFinite(entry) && Number.isFinite(pnl) && amt !== 0 ? entry + pnl / amt : entry;
        const markPrice = Number.isFinite(mark) && mark > 0 ? mark : entry;

        return {
          symbol: p.symbol,
          side: amt > 0 ? ("LONG" as const) : ("SHORT" as const),
          notional: Math.abs(amt) * markPrice,
          entryPrice: entry,
          markPrice,
          leverage: Number(p.leverage),
          unrealizedPnl: pnl,
        };
      });
  }

  async getMarketData(symbol: string): Promise<MarketState> {
    return getPublicMarketData(symbol);
  }

  async executeTrade(trade: ApprovedTrade): Promise<ExecutionResult> {
    const market = await getPublicMarketData(trade.symbol);
    if (!Number.isFinite(market.price) || market.price <= 0) {
      return {
        ok: false,
        venue: this.venue,
        simulated: false,
        message: `No usable price for ${trade.symbol}; order not submitted.`,
      };
    }

    // The approved figure is a notional, and the exchange takes a quantity, so
    // the two are related only through a price. A quote that did not come from
    // Binance just now is a reference number, and sizing a real order with one
    // would send an order of a different value than the one the risk engine
    // approved. No live quote, no order.
    if (market.source !== "BINANCE_PUBLIC") {
      return {
        ok: false,
        venue: this.venue,
        simulated: false,
        message:
          `No live ${trade.symbol} quote from Binance (source ${market.source}); order not ` +
          `submitted. Sizing a live order from a reference price would not match the approved notional.`,
      };
    }

    const quantity = trimQuantity(trade.notional / market.price);
    if (Number(quantity) <= 0) {
      return {
        ok: false,
        venue: this.venue,
        simulated: false,
        message:
          `${trade.symbol} quantity for a ${trade.notional} USDT order rounds to zero at ` +
          `${market.price}; order not submitted.`,
      };
    }

    try {
      // Leverage is set first because it is part of the approved trade, and it
      // has already cleared the same policy that cleared the order. If the
      // venue refuses the change the account stays on whatever leverage it had
      // — possibly above policy — so the order is abandoned rather than sent
      // at a leverage the risk engine never approved.
      if (trade.market === "USDM_FUTURES") {
        try {
          await signedRequest(this.creds, "POST", "/fapi/v1/leverage", {
            symbol: trade.symbol,
            leverage: trade.leverage,
          });
        } catch (err) {
          return {
            ok: false,
            venue: this.venue,
            simulated: false,
            message:
              `Could not set ${trade.symbol} leverage to ${trade.leverage}x, so the order was not ` +
              `submitted: ${err instanceof Error ? err.message : "Binance rejected the change."}`,
          };
        }
      }

      const order = await signedRequest<OrderResponse>(this.creds, "POST", "/fapi/v1/order", {
        symbol: trade.symbol,
        side: trade.side,
        type: trade.type,
        quantity,
        ...(trade.type === "LIMIT" ? { price: trade.price, timeInForce: "GTC" } : {}),
        newClientOrderId: `fentra-${trade.approvalId.slice(0, 20)}`,
        // Futures acknowledges an order without saying what it did with it, so
        // the default reply carries executedQty "0" and no average price even
        // for a market order that filled instantly. RESULT waits for the
        // outcome, which is what makes the receipt describe the real fill
        // instead of reporting a filled trade as zero quantity.
        newOrderRespType: "RESULT",
      });

      const filledQty = Number(order.executedQty);
      const avgPrice = Number(order.avgPrice);
      const venueName = this.creds.testnet ? "Binance futures testnet" : "Binance futures";
      const dead = DEAD_STATUSES.has(order.status);

      return {
        // A 200 from Binance is not a fill. An order it rejected or expired is
        // reported as a failure, not as an execution.
        ok: !dead,
        venue: this.venue,
        simulated: false,
        orderId: String(order.orderId),
        filledPrice: Number.isFinite(avgPrice) && avgPrice > 0 ? avgPrice : undefined,
        filledQty: Number.isFinite(filledQty) ? filledQty : 0,
        message: dead
          ? `Order ${order.orderId} ${order.status} on ${venueName}; nothing was filled.`
          : Number.isFinite(filledQty) && filledQty > 0
            ? `Order ${order.orderId} ${order.status} on ${venueName}: filled ${filledQty} ` +
              `${trade.symbol}${
                Number.isFinite(avgPrice) && avgPrice > 0 ? ` at ${avgPrice}` : ""
              }.`
            : `Order ${order.orderId} ${order.status} on ${venueName}; working, not yet filled.`,
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

/**
 * Binance rejects over-precise quantities; 3dp is safe for the tracked symbols.
 *
 * Rounded down, never up: rounding up would submit an order worth more than the
 * notional the risk engine approved.
 */
function trimQuantity(qty: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return "0";
  return (Math.floor(qty * 1000) / 1000).toFixed(3);
}
