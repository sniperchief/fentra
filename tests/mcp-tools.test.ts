/**
 * Fentra MCP tool tests.
 *
 * Two things are proved here. First, that the MCP tools return the same
 * ALLOW / BLOCK / HALT verdicts the application's own gate produces — because
 * they call the same risk engine rather than a second copy of the rules.
 * Second, and more important, that this transport cannot trade: the server
 * registers no execution tool, and a risk check never reaches the executor.
 */

import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ControlPlane, type ControlPlaneState } from "@/server/control-plane";
import { DEFAULT_POLICY } from "@/policy/policy-store";
import { createFentraMcpServer, TOOL_NAMES } from "@/mcp/server";
import { CheckTradeRiskArgs, checkTradeRisk } from "@/mcp/tools/check-trade-risk";
import { getRiskPolicy } from "@/mcp/tools/get-risk-policy";
import { getRiskStatus } from "@/mcp/tools/get-risk-status";
import type { ApprovedTrade, ExecutionResult, TradingExecutor } from "@/binance/types";
import type { AccountState, MarketState, Position } from "@/risk/types";

class SpyExecutor implements TradingExecutor {
  readonly venue = "DEMO" as const;
  executeTrade = vi.fn(async (_trade: ApprovedTrade): Promise<ExecutionResult> => {
    throw new Error("The MCP transport must never reach the executor.");
  });

  constructor(
    private account: AccountState,
    private positions: Position[] = [],
  ) {}

  async describeConnection() {
    return { connected: false, label: "Spy", detail: "test double" };
  }
  async getAccountState() {
    return this.account;
  }
  async getPositions() {
    return this.positions;
  }
  async getMarketData(symbol: string): Promise<MarketState> {
    return {
      symbol,
      price: 68000,
      priceChangePercent: 0,
      source: "SYNTHETIC",
      venueMaxLeverage: 125,
      fetchedAt: 0,
    };
  }
}

const healthyAccount: AccountState = {
  equity: 10000,
  availableBalance: 9000,
  peakEquityToday: 10000,
  startOfDayEquity: 10000,
  tradingHalted: false,
};

/** 6% below the intraday peak, against a 5% policy limit. */
const drawdownAccount: AccountState = {
  ...healthyAccount,
  equity: 10340,
  peakEquityToday: 11000,
};

function build(account: AccountState, positions: Position[] = []) {
  const executor = new SpyExecutor(account, positions);
  const state: ControlPlaneState = {
    policy: { ...DEFAULT_POLICY },
    history: [],
    halted: false,
    peakEquityToday: account.peakEquityToday,
  };
  return {
    executor,
    state,
    cp: new ControlPlane(state, executor, ["BTCUSDT"]),
  };
}

const trade = (over: Partial<CheckTradeRiskArgs> = {}): CheckTradeRiskArgs =>
  CheckTradeRiskArgs.parse({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    notional: 1500,
    leverage: 3,
    market: "USDM_FUTURES",
    ...over,
  });

describe("fentra_check_trade_risk", () => {
  it("allows a trade inside every limit", async () => {
    const { cp } = build(healthyAccount);
    const result = await checkTradeRisk(cp, trade());

    expect(result.decision).toBe("ALLOW");
    expect(result.reasons).toEqual([]);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.executed).toBe(false);
  });

  it("blocks an oversized position", async () => {
    const { cp } = build(healthyAccount);
    // 20% of $10,000 equity is $2,000; $5,000 is well past it.
    const result = await checkTradeRisk(cp, trade({ notional: 5000 }));

    expect(result.decision).toBe("BLOCK");
    expect(result.reasons.join(" ")).toMatch(/Position size/i);
    expect(result.metrics.positionExposure).toBeGreaterThan(0.2);
  });

  it("blocks excessive leverage", async () => {
    const { cp } = build(healthyAccount);
    const result = await checkTradeRisk(cp, trade({ leverage: 10 }));

    expect(result.decision).toBe("BLOCK");
    expect(result.reasons.join(" ")).toMatch(/10x exceeds the 5x policy limit/i);
  });

  it("blocks an order above the per-order notional cap", async () => {
    const { cp, state } = build({ ...healthyAccount, equity: 1_000_000 });
    // Equity is large enough that the 20% position cap cannot be the binding
    // constraint, isolating the $5,000 per-order ceiling.
    state.peakEquityToday = 1_000_000;
    const result = await checkTradeRisk(cp, trade({ notional: 9000 }));

    expect(result.decision).toBe("BLOCK");
    expect(result.reasons.join(" ")).toMatch(/Order notional/i);
  });

  it("returns HALT when the daily drawdown limit is breached", async () => {
    const { cp } = build(drawdownAccount);
    const result = await checkTradeRisk(cp, trade());

    expect(result.decision).toBe("HALT");
    expect(result.reasons.join(" ")).toMatch(/drawdown/i);
  });

  it("reports exposure as a fraction of equity", async () => {
    const { cp } = build(healthyAccount);
    const result = await checkTradeRisk(cp, trade({ notional: 1500 }));

    expect(result.metrics.currentEquity).toBe(10000);
    expect(result.metrics.positionExposure).toBeCloseTo(0.15, 5);
    expect(result.metrics.positionExposureUsd).toBe(1500);
  });

  it("rejects malformed input before it reaches the engine", () => {
    expect(() => trade({ notional: -100 })).toThrow();
    expect(() => trade({ leverage: 2.5 })).toThrow();
    expect(() => CheckTradeRiskArgs.parse({ symbol: "BTCUSDT", side: "SIDEWAYS" })).toThrow();
    expect(() => CheckTradeRiskArgs.parse({ side: "BUY", notional: 100 })).toThrow();
  });

  it("never resizes a rejected trade", async () => {
    const { cp } = build(healthyAccount);
    const result = await checkTradeRisk(cp, trade({ notional: 5000 }));

    // The verdict describes the trade as submitted; no adjusted size is offered.
    expect(result.decision).toBe("BLOCK");
    expect(JSON.stringify(result)).not.toMatch(/suggested|adjusted|resized/i);
  });
});

describe("fentra_get_risk_policy", () => {
  it("reports the configured policy, not a hardcoded one", async () => {
    const { cp, state } = build(healthyAccount);
    state.policy = { ...state.policy, maxLeverage: 3, maxPositionSizePct: 0.1 };

    const policy = await getRiskPolicy(cp);

    expect(policy.maxLeverage).toBe(3);
    expect(policy.maxPositionPercent).toBe(10);
    expect(policy.maxDailyDrawdownPercent).toBe(5);
    expect(policy.maxPriceDeviationPercent).toBe(5);
  });

  it("resolves a percentage-of-equity order cap to USDT", async () => {
    const { cp, state } = build(healthyAccount);
    state.policy = {
      ...state.policy,
      maxOrderNotionalMode: "PCT_OF_EQUITY",
      maxOrderNotional: 0.1,
    };

    const policy = await getRiskPolicy(cp);

    expect(policy.maxOrderNotionalMode).toBe("PCT_OF_EQUITY");
    expect(policy.maxOrderNotional).toBe(1000); // 10% of $10,000
  });
});

describe("fentra_get_risk_status", () => {
  it("reflects a healthy account", async () => {
    const { cp } = build(healthyAccount, [
      {
        symbol: "BTCUSDT",
        side: "LONG",
        notional: 1400,
        entryPrice: 67000,
        markPrice: 68000,
        leverage: 3,
        unrealizedPnl: 20,
      },
    ]);

    const status = await getRiskStatus(cp);

    expect(status.status).toBe("ACTIVE");
    expect(status.tradingHalted).toBe(false);
    expect(status.currentEquity).toBe(10000);
    expect(status.dailyDrawdown).toBe(0);
    expect(status.largestPositionPercent).toBeCloseTo(14, 5);
    expect(status.openExposure).toBe(1400);
  });

  it("reports HALTED once the circuit breaker has latched", async () => {
    const { cp } = build(drawdownAccount);

    const status = await getRiskStatus(cp);

    expect(status.status).toBe("HALTED");
    expect(status.tradingHalted).toBe(true);
    expect(status.dailyDrawdown).toBeCloseTo(6, 1);
    expect(status.haltReason).toMatch(/drawdown/i);
  });
});

describe("MCP execution boundary", () => {
  it("exposes exactly three read-only tools and no way to trade", async () => {
    const server = createFentraMcpServer();
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual(
      [TOOL_NAMES.checkTradeRisk, TOOL_NAMES.getRiskPolicy, TOOL_NAMES.getRiskStatus].sort(),
    );
    // No tool that places, executes, submits or cancels an order.
    expect(names.filter((n) => /place|execute|submit|cancel|order/i.test(n))).toEqual([]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }

    await client.close();
    await server.close();
  });

  it("never calls the executor when checking a trade", async () => {
    const { cp, executor } = build(healthyAccount);

    // Across an allowed trade, a blocked one and a halted day.
    await checkTradeRisk(cp, trade());
    await checkTradeRisk(cp, trade({ notional: 5000 }));
    await checkTradeRisk(build(drawdownAccount).cp, trade());

    expect(executor.executeTrade).not.toHaveBeenCalled();
  });

  it("leaves no trace in the audit history", async () => {
    const { cp } = build(healthyAccount);

    await checkTradeRisk(cp, trade());

    // Advisory checks are not executions and must not pollute the log the
    // console shows the operator.
    expect(cp.history).toHaveLength(0);
  });
});
