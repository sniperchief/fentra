/**
 * Individual risk rules. Every function here is pure: same inputs, same result.
 * No I/O, no clock reads, no LLM involvement.
 */

import type {
  AccountState,
  MarketState,
  Position,
  ProposedTrade,
  RiskCheck,
  RiskPolicy,
} from "./types";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

/** Signed exposure so a SELL against an open LONG reduces rather than adds. */
export function signedNotional(side: "BUY" | "SELL" | "LONG" | "SHORT", notional: number): number {
  return side === "BUY" || side === "LONG" ? notional : -notional;
}

export function exposureForSymbol(positions: Position[], symbol: string): number {
  return positions
    .filter((p) => p.symbol === symbol)
    .reduce((sum, p) => sum + signedNotional(p.side, p.notional), 0);
}

/**
 * Portfolio exposure once the proposed order fills.
 *
 * Netted per symbol rather than added on top, because an order that closes a
 * position removes exposure instead of doubling it. Treating every order as
 * additive made a full close of a large position look like twice the exposure,
 * which the leverage rule would then refuse — blocking the one trade that
 * reduces risk.
 */
export function projectedPortfolioExposure(positions: Position[], trade: ProposedTrade): number {
  const bySymbol = new Map<string, number>();
  for (const p of positions) {
    bySymbol.set(p.symbol, (bySymbol.get(p.symbol) ?? 0) + signedNotional(p.side, p.notional));
  }
  const delta = signedNotional(trade.side, trade.notional);
  bySymbol.set(trade.symbol, (bySymbol.get(trade.symbol) ?? 0) + delta);

  let total = 0;
  for (const net of bySymbol.values()) total += Math.abs(net);
  return total;
}

/**
 * True when equity is a figure the rules can actually measure against.
 *
 * A venue can answer with a missing or unparseable field, which becomes NaN,
 * and NaN silently passes every `>` comparison in the rules below. Equity is
 * therefore checked once, here, and the rules that depend on it fail closed.
 */
export function hasUsableEquity(account: AccountState): boolean {
  return Number.isFinite(account.equity) && account.equity > 0;
}

export function dailyDrawdown(account: AccountState): number {
  // An unmeasurable peak or equity yields no drawdown figure rather than NaN,
  // which would compare false against the limit and read as "no drawdown".
  if (!Number.isFinite(account.peakEquityToday) || account.peakEquityToday <= 0) return 0;
  if (!Number.isFinite(account.equity)) return 0;
  const dd = (account.peakEquityToday - account.equity) / account.peakEquityToday;
  return dd > 0 ? dd : 0;
}

/**
 * Circuit breaker. Fails if the intraday drawdown from the high-water mark
 * breaches policy, or if the breaker has already latched for the day.
 */
export function checkCircuitBreaker(account: AccountState, policy: RiskPolicy): RiskCheck {
  const dd = dailyDrawdown(account);
  const limit = policy.maxDailyDrawdownPct;

  if (account.tradingHalted) {
    return {
      id: "circuit_breaker",
      label: "Drawdown circuit breaker",
      passed: false,
      detail:
        account.haltReason ??
        `Trading is halted for the day. Drawdown ${pct(dd)} against a ${pct(limit)} limit.`,
      observed: dd,
      limit,
    };
  }

  const breached = dd > limit;
  return {
    id: "circuit_breaker",
    label: "Drawdown circuit breaker",
    passed: !breached,
    detail: breached
      ? `Daily drawdown ${pct(dd)} exceeds the ${pct(limit)} limit. Peak ${usd(
          account.peakEquityToday,
        )} to current ${usd(account.equity)}.`
      : `Daily drawdown ${pct(dd)} is within the ${pct(limit)} limit.`,
    observed: dd,
    limit,
  };
}

/**
 * Portfolio-aware position sizing: exposure in this symbol *after* the fill,
 * measured against equity. This is the check a generic tool-permission layer
 * cannot make, because it depends on live account state.
 */
export function checkPositionSize(
  account: AccountState,
  positions: Position[],
  trade: ProposedTrade,
  policy: RiskPolicy,
): RiskCheck {
  const existing = exposureForSymbol(positions, trade.symbol);
  const projected = Math.abs(existing + signedNotional(trade.side, trade.notional));

  // Without a usable equity figure the cap is unknown, so nothing can be
  // measured against it. Refuse rather than let NaN compare false.
  if (!hasUsableEquity(account)) {
    return {
      id: "position_size",
      label: "Position size",
      passed: false,
      detail: `Account equity is unavailable, so the ${pct(
        policy.maxPositionSizePct,
      )} of equity cap cannot be evaluated. No trade is sized against an unknown account.`,
      observed: projected,
    };
  }

  const maxAllowed = account.equity * policy.maxPositionSizePct;
  const breached = projected > maxAllowed;

  return {
    id: "position_size",
    label: "Position size",
    passed: !breached,
    detail: breached
      ? `${trade.symbol} exposure would reach ${usd(projected)}, above the ${pct(
          policy.maxPositionSizePct,
        )} of equity cap (${usd(maxAllowed)}).`
      : `${trade.symbol} exposure ${usd(projected)} of ${usd(maxAllowed)} allowed (${pct(
          policy.maxPositionSizePct,
        )} of ${usd(account.equity)}).`,
    observed: projected,
    limit: maxAllowed,
  };
}

/**
 * Two-part leverage rule: the leverage requested on this order, and the
 * effective account leverage once the order fills.
 */
export function checkLeverage(
  account: AccountState,
  positions: Position[],
  trade: ProposedTrade,
  policy: RiskPolicy,
): RiskCheck {
  const requested = trade.leverage;
  const portfolioAfter = projectedPortfolioExposure(positions, trade);
  const accountLeverageAfter = account.equity > 0 ? portfolioAfter / account.equity : Infinity;

  // An unfunded account cannot support any exposure, and dividing by zero
  // equity would otherwise surface as "Infinityx" in the UI. A non-finite
  // equity reading is treated the same way: it is not a number any limit can
  // be checked against, so it fails rather than passing every comparison.
  if (!hasUsableEquity(account)) {
    return {
      id: "leverage",
      label: "Leverage",
      passed: false,
      detail: Number.isFinite(account.equity)
        ? `Account equity is ${usd(account.equity)}. There is no margin to support a ${usd(
            trade.notional,
          )} position. Fund the account before trading.`
        : `Account equity is unavailable, so leverage cannot be evaluated. Trading is refused until the account reports a usable balance.`,
      observed: requested,
      limit: policy.maxLeverage,
    };
  }

  if (requested > policy.maxLeverage) {
    return {
      id: "leverage",
      label: "Leverage",
      passed: false,
      detail: `Requested ${requested}x exceeds the ${policy.maxLeverage}x policy limit.`,
      observed: requested,
      limit: policy.maxLeverage,
    };
  }

  if (accountLeverageAfter > policy.maxLeverage) {
    return {
      id: "leverage",
      label: "Leverage",
      passed: false,
      detail: `Account leverage would reach ${accountLeverageAfter.toFixed(
        2,
      )}x (${usd(portfolioAfter)} exposure on ${usd(account.equity)} equity), above the ${
        policy.maxLeverage
      }x limit.`,
      observed: accountLeverageAfter,
      limit: policy.maxLeverage,
    };
  }

  return {
    id: "leverage",
    label: "Leverage",
    passed: true,
    detail: `Order ${requested}x and account ${accountLeverageAfter.toFixed(2)}x, both within the ${
      policy.maxLeverage
    }x limit.`,
    observed: requested,
    limit: policy.maxLeverage,
  };
}

/**
 * Resolves the per-order cap to a USDT figure. In PCT_OF_EQUITY mode the cap is
 * a fraction of live equity, so it tracks the account rather than sitting at a
 * fixed number that means something different at every account size.
 */
export function resolveOrderNotionalLimit(account: AccountState, policy: RiskPolicy): number {
  if (policy.maxOrderNotionalMode !== "PCT_OF_EQUITY") return policy.maxOrderNotional;
  // An unreadable equity resolves the cap to zero rather than to NaN, which
  // would compare false against every order size.
  const equity = Number.isFinite(account.equity) ? Math.max(account.equity, 0) : 0;
  return equity * policy.maxOrderNotional;
}

export function checkOrderNotional(
  account: AccountState,
  trade: ProposedTrade,
  policy: RiskPolicy,
): RiskCheck {
  const limit = resolveOrderNotionalLimit(account, policy);
  const breached = trade.notional > limit;

  // In percent mode, show the rule and the resolved figure together, so the
  // number in the UI is always traceable back to the policy that produced it.
  const capText =
    policy.maxOrderNotionalMode === "PCT_OF_EQUITY"
      ? `${usd(limit)} per-order cap (${pct(policy.maxOrderNotional)} of ${usd(account.equity)} equity)`
      : `${usd(limit)} per-order cap`;

  return {
    id: "order_notional",
    label: "Order notional",
    passed: !breached,
    detail: breached
      ? `Order of ${usd(trade.notional)} exceeds the ${capText}.`
      : `Order of ${usd(trade.notional)} within the ${capText}.`,
    observed: trade.notional,
    limit,
  };
}

/**
 * Order Sanity Validation.
 *
 * Structural validation of the order against the live market. A proposal can be
 * well-formed JSON and still be nonsense: a limit price far off the book, a zero
 * quantity, leverage the venue does not offer, or a symbol that is not the one
 * quoted. Everything here is checked against real market state rather than
 * against what the agent asserts.
 */
export function checkOrderSanity(
  trade: ProposedTrade,
  market: MarketState,
  policy: RiskPolicy,
): RiskCheck {
  const problems: string[] = [];

  if (trade.symbol !== market.symbol) {
    problems.push(
      `symbol mismatch, order is for ${trade.symbol} but the quote is for ${market.symbol}`,
    );
  }
  // Notional, equity and every policy limit are USDT figures. A pair quoted in
  // anything else would have its size measured in one currency against limits
  // written in another, so the units are checked rather than assumed.
  if (!/^[A-Z0-9]{2,15}USDT$/.test(trade.symbol)) {
    problems.push(
      `${trade.symbol || "(no symbol)"} is not a USDT-quoted pair; order notional and every ` +
        `policy limit are denominated in USDT`,
    );
  }
  if (!Number.isFinite(trade.notional) || trade.notional <= 0) {
    problems.push(`invalid notional ${trade.notional}`);
  }
  if (!Number.isFinite(trade.leverage) || trade.leverage < 1) {
    problems.push(`invalid leverage ${trade.leverage}`);
  } else if (!Number.isInteger(trade.leverage)) {
    problems.push(`leverage must be a whole number, got ${trade.leverage}`);
  } else if (trade.leverage > market.venueMaxLeverage) {
    problems.push(
      `leverage ${trade.leverage}x exceeds the venue maximum of ${market.venueMaxLeverage}x for ${market.symbol}`,
    );
  }
  if (trade.market === "SPOT" && trade.leverage !== 1) {
    problems.push(`spot orders cannot carry ${trade.leverage}x leverage`);
  }
  if (!Number.isFinite(market.price) || market.price <= 0) {
    problems.push(`no usable market price for ${trade.symbol}`);
  }

  let deviation = 0;
  if (trade.type === "LIMIT") {
    const limitPrice = trade.price ?? NaN;
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      problems.push("limit order is missing a valid price");
    } else if (market.price > 0) {
      deviation = Math.abs(limitPrice - market.price) / market.price;
      if (deviation > policy.maxPriceDeviationPct) {
        problems.push(
          `limit price ${usd(limitPrice)} is ${pct(deviation)} away from the ${usd(
            market.price,
          )} market price, above the ${pct(policy.maxPriceDeviationPct)} limit`,
        );
      }
    }
  }

  return {
    id: "order_sanity",
    label: "Order sanity",
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `Order parameters are consistent with the live ${market.symbol} market at ${usd(
            market.price,
          )}.`
        : `Rejected: ${problems.join("; ")}.`,
    observed: deviation,
    limit: policy.maxPriceDeviationPct,
  };
}
