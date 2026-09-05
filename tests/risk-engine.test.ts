import { describe, expect, it } from "vitest";
import { evaluateTrade, evaluateAccountOperation } from "@/risk/risk-engine";
import { DEFAULT_POLICY } from "@/policy/policy-store";
import type {
  AccountState,
  MarketState,
  Position,
  ProposedTrade,
  RiskEvaluationInput,
} from "@/risk/types";

const account: AccountState = {
  equity: 10000,
  availableBalance: 9000,
  peakEquityToday: 10000,
  startOfDayEquity: 10000,
  tradingHalted: false,
};

const market: MarketState = {
  symbol: "BTCUSDT",
  price: 68000,
  priceChangePercent: 1.2,
  source: "BINANCE_PUBLIC",
  venueMaxLeverage: 125,
  fetchedAt: 0,
};

const baseTrade: ProposedTrade = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "MARKET",
  notional: 1500,
  leverage: 3,
  market: "USDM_FUTURES",
};

function evaluate(overrides: Partial<RiskEvaluationInput> = {}) {
  return evaluateTrade({
    account,
    positions: [],
    market,
    proposedTrade: baseTrade,
    policy: DEFAULT_POLICY,
    ...overrides,
  });
}

const checkFor = (result: ReturnType<typeof evaluate>, id: string) =>
  result.checks.find((c) => c.id === id)!;

describe("risk engine", () => {
  it("allows a trade inside every limit", () => {
    const result = evaluate();
    expect(result.decision).toBe("ALLOW");
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("blocks leverage above the policy limit", () => {
    const result = evaluate({ proposedTrade: { ...baseTrade, leverage: 10 } });
    expect(result.decision).toBe("BLOCK");
    expect(checkFor(result, "leverage").passed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/10x exceeds the 5x/);
  });

  it("blocks a position larger than the equity percentage cap", () => {
    // 20% of 10,000 equity is 2,000.
    const result = evaluate({ proposedTrade: { ...baseTrade, notional: 3000 } });
    expect(result.decision).toBe("BLOCK");
    expect(checkFor(result, "position_size").passed).toBe(false);
  });

  it("counts existing exposure toward the position cap", () => {
    const positions: Position[] = [
      {
        symbol: "BTCUSDT",
        side: "LONG",
        notional: 1500,
        entryPrice: 67000,
        markPrice: 68000,
        leverage: 3,
        unrealizedPnl: 22,
      },
    ];
    // 1,500 open + 1,500 proposed = 3,000, over the 2,000 cap.
    const result = evaluate({ positions });
    expect(result.decision).toBe("BLOCK");
    expect(checkFor(result, "position_size").passed).toBe(false);
  });

  it("lets a SELL reduce an existing long rather than adding to it", () => {
    const positions: Position[] = [
      {
        symbol: "BTCUSDT",
        side: "LONG",
        notional: 1800,
        entryPrice: 67000,
        markPrice: 68000,
        leverage: 3,
        unrealizedPnl: 26,
      },
    ];
    const result = evaluate({
      positions,
      proposedTrade: { ...baseTrade, side: "SELL", notional: 1000 },
    });
    expect(checkFor(result, "position_size").passed).toBe(true);
  });

  it("blocks an order above the maximum notional", () => {
    const result = evaluate({
      account: { ...account, equity: 200000, peakEquityToday: 200000, startOfDayEquity: 200000 },
      proposedTrade: { ...baseTrade, notional: 7000 },
    });
    expect(result.decision).toBe("BLOCK");
    expect(checkFor(result, "order_notional").passed).toBe(false);
  });

  it("blocks a limit price too far from the market", () => {
    const result = evaluate({
      proposedTrade: { ...baseTrade, type: "LIMIT", price: 68000 * 1.2 },
    });
    expect(result.decision).toBe("BLOCK");
    expect(checkFor(result, "order_sanity").passed).toBe(false);
  });

  it("allows a limit price within the deviation limit", () => {
    const result = evaluate({
      proposedTrade: { ...baseTrade, type: "LIMIT", price: 68000 * 0.98 },
    });
    expect(result.decision).toBe("ALLOW");
  });

  it("halts when daily drawdown exceeds the limit", () => {
    const result = evaluate({
      account: { ...account, equity: 10340, peakEquityToday: 11000 },
    });
    expect(result.decision).toBe("HALT");
    expect(result.metrics.dailyDrawdown).toBeCloseTo(0.06, 4);
  });

  it("halts every trade once the breaker has latched, even a compliant one", () => {
    const result = evaluate({
      account: { ...account, tradingHalted: true, haltReason: "Latched earlier." },
    });
    expect(result.decision).toBe("HALT");
  });

  it("prefers HALT over BLOCK when both apply", () => {
    const result = evaluate({
      account: { ...account, equity: 10340, peakEquityToday: 11000 },
      proposedTrade: { ...baseTrade, leverage: 50 },
    });
    expect(result.decision).toBe("HALT");
  });

  describe("order sanity validation", () => {
    it("rejects a non-positive notional", () => {
      const result = evaluate({ proposedTrade: { ...baseTrade, notional: 0 } });
      expect(checkFor(result, "order_sanity").passed).toBe(false);
    });

    it("rejects leverage above what the venue offers", () => {
      const result = evaluate({
        market: { ...market, venueMaxLeverage: 2 },
        policy: { ...DEFAULT_POLICY, maxLeverage: 10 },
        proposedTrade: { ...baseTrade, leverage: 5 },
      });
      expect(checkFor(result, "order_sanity").passed).toBe(false);
    });

    it("rejects leverage on a spot order", () => {
      const result = evaluate({
        proposedTrade: { ...baseTrade, market: "SPOT", leverage: 3 },
      });
      expect(checkFor(result, "order_sanity").passed).toBe(false);
    });

    it("rejects a symbol that does not match the quote", () => {
      const result = evaluate({ proposedTrade: { ...baseTrade, symbol: "ETHUSDT" } });
      expect(checkFor(result, "order_sanity").passed).toBe(false);
    });

    it("rejects a limit order with no price", () => {
      const result = evaluate({ proposedTrade: { ...baseTrade, type: "LIMIT" } });
      expect(checkFor(result, "order_sanity").passed).toBe(false);
    });

    it("rejects fractional leverage", () => {
      const result = evaluate({ proposedTrade: { ...baseTrade, leverage: 2.5 } });
      expect(checkFor(result, "order_sanity").passed).toBe(false);
    });
  });

  describe("equity-relative order cap", () => {
    const pctPolicy = {
      ...DEFAULT_POLICY,
      maxOrderNotionalMode: "PCT_OF_EQUITY" as const,
      maxOrderNotional: 0.1, // 10% of equity
    };

    it("resolves the cap against live equity", () => {
      // 10% of 10,000 equity is 1,000.
      const result = evaluate({ policy: pctPolicy, proposedTrade: { ...baseTrade, notional: 900 } });
      expect(checkFor(result, "order_notional").passed).toBe(true);
      expect(checkFor(result, "order_notional").limit).toBe(1000);
    });

    it("blocks an order above the resolved cap", () => {
      const result = evaluate({
        policy: pctPolicy,
        proposedTrade: { ...baseTrade, notional: 1200 },
      });
      expect(checkFor(result, "order_notional").passed).toBe(false);
      expect(checkFor(result, "order_notional").detail).toContain("10.00% of");
    });

    it("scales with the account: the same order passes on a larger one", () => {
      const big = { ...account, equity: 100000, peakEquityToday: 100000, startOfDayEquity: 100000 };
      const trade = { ...baseTrade, notional: 4000 };

      // 10% of 10,000 = 1,000 -> blocked. 10% of 100,000 = 10,000 -> allowed.
      expect(checkFor(evaluate({ policy: pctPolicy, proposedTrade: trade }), "order_notional").passed).toBe(false);
      expect(
        checkFor(evaluate({ account: big, policy: pctPolicy, proposedTrade: trade }), "order_notional").passed,
      ).toBe(true);
    });

    it("caps at zero when the account is unfunded", () => {
      const empty = { ...account, equity: 0, peakEquityToday: 0, startOfDayEquity: 0 };
      const result = evaluate({ account: empty, policy: pctPolicy });
      expect(checkFor(result, "order_notional").passed).toBe(false);
      expect(checkFor(result, "order_notional").limit).toBe(0);
    });

    it("leaves absolute mode behaving exactly as before", () => {
      const result = evaluate({ proposedTrade: { ...baseTrade, notional: 4999 } });
      expect(checkFor(result, "order_notional").passed).toBe(true);
      expect(checkFor(result, "order_notional").limit).toBe(5000);
    });
  });

  it("is deterministic across repeated evaluations", () => {
    const a = evaluate();
    const b = evaluate();
    expect(a.decision).toBe(b.decision);
    expect(a.reasons).toEqual(b.reasons);
    expect(a.metrics).toEqual(b.metrics);
  });

  it("reports every check even when one fails, so the UI can show the full report", () => {
    const result = evaluate({ proposedTrade: { ...baseTrade, leverage: 10 } });
    expect(result.checks).toHaveLength(5);
  });
});

describe("risk-sensitive account operations", () => {
  it("blocks raising leverage beyond the policy limit", () => {
    const result = evaluateAccountOperation(
      { kind: "SET_LEVERAGE", symbol: "BTCUSDT", leverage: 20 },
      account,
      DEFAULT_POLICY,
    );
    expect(result.decision).toBe("BLOCK");
  });

  it("allows a leverage change within the limit", () => {
    const result = evaluateAccountOperation(
      { kind: "SET_LEVERAGE", symbol: "BTCUSDT", leverage: 4 },
      account,
      DEFAULT_POLICY,
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("blocks switching to cross margin", () => {
    const result = evaluateAccountOperation(
      { kind: "SET_MARGIN_MODE", symbol: "BTCUSDT", mode: "CROSSED" },
      account,
      DEFAULT_POLICY,
    );
    expect(result.decision).toBe("BLOCK");
  });

  it("halts settings changes once the breaker has latched", () => {
    const result = evaluateAccountOperation(
      { kind: "SET_LEVERAGE", symbol: "BTCUSDT", leverage: 2 },
      { ...account, tradingHalted: true },
      DEFAULT_POLICY,
    );
    expect(result.decision).toBe("HALT");
  });

  it("still allows cancelling an order while halted, because it reduces exposure", () => {
    const result = evaluateAccountOperation(
      { kind: "CANCEL_ORDER", symbol: "BTCUSDT", orderId: "1" },
      { ...account, tradingHalted: true },
      DEFAULT_POLICY,
    );
    expect(result.decision).toBe("ALLOW");
  });
});
