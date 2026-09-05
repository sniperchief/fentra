/**
 * Live market quotes from Binance public endpoints.
 *
 * These require no credentials, so demo mode still runs against real prices.
 * `MarketState.source` records where the number came from, so the UI never
 * implies a quote is live when it is not.
 */

import { publicGet } from "./binance-client";
import type { MarketState } from "@/risk/types";

/**
 * Venue leverage caps used by Order Sanity Validation. These are conservative
 * documented ceilings, not a live leverage-bracket lookup; the risk policy is
 * always the tighter of the two in practice.
 */
const VENUE_MAX_LEVERAGE: Record<string, number> = {
  BTCUSDT: 125,
  ETHUSDT: 100,
  SOLUSDT: 75,
  BNBUSDT: 75,
};
const DEFAULT_VENUE_MAX_LEVERAGE = 20;

/** Last-resort reference prices, only used when Binance is unreachable. */
const FALLBACK_PRICES: Record<string, number> = {
  BTCUSDT: 68000,
  ETHUSDT: 3400,
  SOLUSDT: 165,
  BNBUSDT: 600,
};

interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

const CACHE_TTL_MS = 5000;
const cache = new Map<string, MarketState>();

export function venueMaxLeverage(symbol: string): number {
  return VENUE_MAX_LEVERAGE[symbol] ?? DEFAULT_VENUE_MAX_LEVERAGE;
}

export async function getPublicMarketData(symbol: string): Promise<MarketState> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  try {
    const t = await publicGet<Ticker24h>("/api/v3/ticker/24hr", { symbol });
    const state: MarketState = {
      symbol,
      price: Number(t.lastPrice),
      priceChangePercent: Number(t.priceChangePercent),
      source: "BINANCE_PUBLIC",
      venueMaxLeverage: venueMaxLeverage(symbol),
      fetchedAt: Date.now(),
    };
    cache.set(symbol, state);
    return state;
  } catch {
    // Degrade honestly: mark the quote SYNTHETIC so the UI can label it.
    const stale = cache.get(symbol);
    if (stale) return { ...stale, source: "SYNTHETIC" };
    return {
      symbol,
      price: FALLBACK_PRICES[symbol] ?? 0,
      priceChangePercent: 0,
      source: "SYNTHETIC",
      venueMaxLeverage: venueMaxLeverage(symbol),
      fetchedAt: Date.now(),
    };
  }
}

export const TRACKED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"] as const;
