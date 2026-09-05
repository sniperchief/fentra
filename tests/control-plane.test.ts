/**
 * Execution-gating tests.
 *
 * These are the security tests that matter: they assert the executor is never
 * reached on a BLOCK or HALT verdict. A spy executor stands in for Binance and
 * records every call, so "the trade was blocked" is proved by the absence of an
 * execution call rather than by a status string.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPlane, type ControlPlaneState } from "@/server/control-plane";
import { DEFAULT_POLICY } from "@/policy/policy-store";
import type { ApprovedTrade, ExecutionResult, TradingExecutor } from "@/binance/types";
import type { AccountState, MarketState, Position, ProposedTrade } from "@/risk/types";

class SpyExecutor implements TradingExecutor {
  readonly venue = "DEMO" as const;
  readonly executed: ApprovedTrade[] = [];
  executeTrade = vi.fn(async (trade: ApprovedTrade): Promise<ExecutionResult> => {
    this.executed.push(trade);
    return {
      ok: true,
      venue: "DEMO",
      simulated: true,
      orderId: "spy-1",
      filledPrice: 68000,
      message: "Simulated fill.",
    };
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

const drawdownAccount: AccountState = {
  ...healthyAccount,
  equity: 10340,
  peakEquityToday: 11000,
};

const safeTrade: ProposedTrade = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "MARKET",
  notional: 1500,
  leverage: 3,
  market: "USDM_FUTURES",
};

function build(account: AccountState) {
  const state: ControlPlaneState = {
    policy: { ...DEFAULT_POLICY },
    history: [],
    halted: false,
    peakEquityToday: account.peakEquityToday,
  };
  const executor = new SpyExecutor(account);
  return { state, executor, cp: new ControlPlane(state, executor, ["BTCUSDT"]) };
}

describe("control plane execution gating", () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build(healthyAccount);
  });

  it("executes an allowed trade exactly once", async () => {
    const result = await harness.cp.submitProposal(safeTrade);
    expect(result.decision).toBe("ALLOW");
    expect(result.executed).toBe(true);
    expect(harness.executor.executeTrade).toHaveBeenCalledTimes(1);
  });

  it("BLOCK: never calls the execution adapter", async () => {
    const result = await harness.cp.submitProposal({ ...safeTrade, leverage: 10 });
    expect(result.decision).toBe("BLOCK");
    expect(result.executed).toBe(false);
    expect(harness.executor.executeTrade).not.toHaveBeenCalled();
    expect(harness.executor.executed).toHaveLength(0);
  });

  it("BLOCK on size: never calls the execution adapter", async () => {
    const result = await harness.cp.submitProposal({ ...safeTrade, notional: 3000 });
    expect(result.decision).toBe("BLOCK");
    expect(harness.executor.executeTrade).not.toHaveBeenCalled();
  });

  it("HALT: never calls the execution adapter", async () => {
    const halted = build(drawdownAccount);
    const result = await halted.cp.submitProposal(safeTrade);
    expect(result.decision).toBe("HALT");
    expect(result.executed).toBe(false);
    expect(halted.executor.executeTrade).not.toHaveBeenCalled();
  });

  it("latches the breaker and refuses every later trade, including compliant ones", async () => {
    const halted = build(drawdownAccount);

    const first = await halted.cp.submitProposal(safeTrade);
    expect(first.decision).toBe("HALT");
    expect(halted.state.halted).toBe(true);

    for (let i = 0; i < 3; i++) {
      const next = await halted.cp.submitProposal(safeTrade);
      expect(next.decision).toBe("HALT");
    }
    expect(halted.executor.executeTrade).not.toHaveBeenCalled();
  });

  it("keeps the breaker latched even after equity recovers", async () => {
    const halted = build(drawdownAccount);
    await halted.cp.submitProposal(safeTrade);
    expect(halted.state.halted).toBe(true);

    // Equity climbs back above the threshold; the day stays halted.
    halted.state.equityOverride = 11000;
    const after = await halted.cp.submitProposal(safeTrade);
    expect(after.decision).toBe("HALT");
    expect(halted.executor.executeTrade).not.toHaveBeenCalled();
  });

  it("records every verdict in history, executed or not", async () => {
    await harness.cp.submitProposal(safeTrade);
    await harness.cp.submitProposal({ ...safeTrade, leverage: 10 });

    expect(harness.cp.history).toHaveLength(2);
    expect(harness.cp.history[0].evaluation.decision).toBe("BLOCK");
    expect(harness.cp.history[0].execution).toBeUndefined();
    expect(harness.cp.history[1].evaluation.decision).toBe("ALLOW");
    expect(harness.cp.history[1].execution?.ok).toBe(true);
  });

  it("marks a blocked record with no execution result at all", async () => {
    const result = await harness.cp.submitProposal({ ...safeTrade, notional: 9000 });
    expect(result.record.execution).toBeUndefined();
  });

  it("stamps the approved trade with the record id it was approved under", async () => {
    const result = await harness.cp.submitProposal(safeTrade);
    expect(harness.executor.executed[0].approvalId).toBe(result.record.id);
  });

  it("a tightened policy blocks a trade that previously passed", async () => {
    const first = await harness.cp.submitProposal(safeTrade);
    expect(first.decision).toBe("ALLOW");

    harness.state.policy = { ...harness.state.policy, maxLeverage: 2 };
    const second = await harness.cp.submitProposal(safeTrade);
    expect(second.decision).toBe("BLOCK");
    expect(harness.executor.executeTrade).toHaveBeenCalledTimes(1);
  });

  it("evaluateOnly never executes", async () => {
    const evaluation = await harness.cp.evaluateOnly(safeTrade);
    expect(evaluation.decision).toBe("ALLOW");
    expect(harness.executor.executeTrade).not.toHaveBeenCalled();
  });

  it("raises the high-water mark as equity climbs, so drawdown is measured from the peak", async () => {
    harness.state.equityOverride = 12000;
    await harness.cp.getAccountState();

    harness.state.equityOverride = 11000;
    const account = await harness.cp.getAccountState();
    expect(account.peakEquityToday).toBe(12000);
    // 1,000 off a 12,000 peak is 8.3%, past the 5% limit.
    expect(account.tradingHalted).toBe(true);
  });

  it("adopts the first observed equity as the high-water mark when none is known", async () => {
    // Regression: live mode used to inherit the demo seed ($10,650) as its
    // peak. Against a real $5,000 account that reads as a 53% drawdown and
    // halted trading on the first poll, before any trade was proposed.
    const live = build({ ...healthyAccount, equity: 5000 });
    live.state.peakEquityToday = null;

    const account = await live.cp.getAccountState();
    expect(account.peakEquityToday).toBe(5000);
    expect(account.tradingHalted).toBe(false);

    const result = await live.cp.submitProposal({ ...safeTrade, notional: 750 });
    expect(result.decision).toBe("ALLOW");
  });

  it("still ratchets the mark up from a first observation", async () => {
    const live = build({ ...healthyAccount, equity: 5000 });
    live.state.peakEquityToday = null;
    await live.cp.getAccountState();

    live.state.equityOverride = 6000;
    expect((await live.cp.getAccountState()).peakEquityToday).toBe(6000);

    // 6,000 -> 5,600 is 6.7%, past the 5% limit.
    live.state.equityOverride = 5600;
    expect((await live.cp.getAccountState()).tradingHalted).toBe(true);
  });

  it("halts on polling alone, before any trade is proposed", async () => {
    const halted = build(healthyAccount);
    halted.state.peakEquityToday = 11000;
    halted.state.equityOverride = 10340;

    const account = await halted.cp.getAccountState();
    expect(account.tradingHalted).toBe(true);
    expect(halted.executor.executeTrade).not.toHaveBeenCalled();
  });
});

describe("risk-sensitive settings changes", () => {
  it("refuses a leverage change that breaches policy", async () => {
    const { cp } = build(healthyAccount);
    const result = await cp.submitAccountOperation({
      kind: "SET_LEVERAGE",
      symbol: "BTCUSDT",
      leverage: 25,
    });
    expect(result.decision).toBe("BLOCK");
  });

  it("refuses settings changes while halted", async () => {
    const { cp } = build(drawdownAccount);
    const result = await cp.submitAccountOperation({
      kind: "SET_MARGIN_MODE",
      symbol: "BTCUSDT",
      mode: "ISOLATED",
    });
    expect(result.decision).toBe("HALT");
  });
});
