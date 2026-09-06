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

/**
 * Concurrency. Risk is evaluated against state read before the order goes out,
 * so overlapping submissions must not each measure the pre-trade portfolio.
 */
describe("concurrent submissions", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Executor whose fill lands only after an exchange round trip. */
  class SlowExecutor implements TradingExecutor {
    readonly venue = "DEMO" as const;
    positions: Position[] = [];
    calls = 0;
    async describeConnection() {
      return { connected: false, label: "Spy", detail: "test double" };
    }
    async getAccountState(): Promise<AccountState> {
      return healthyAccount;
    }
    async getPositions() {
      return this.positions.map((p) => ({ ...p }));
    }
    async getMarketData(symbol: string): Promise<MarketState> {
      return {
        symbol,
        price: 68000,
        priceChangePercent: 0,
        source: "BINANCE_PUBLIC",
        venueMaxLeverage: 125,
        fetchedAt: 0,
      };
    }
    async executeTrade(t: ApprovedTrade): Promise<ExecutionResult> {
      this.calls++;
      await sleep(20);
      this.positions = [
        {
          symbol: t.symbol,
          side: "LONG",
          notional: (this.positions[0]?.notional ?? 0) + t.notional,
          entryPrice: 68000,
          markPrice: 68000,
          leverage: t.leverage,
          unrealizedPnl: 0,
        },
      ];
      return { ok: true, venue: "DEMO", simulated: true, message: "filled" };
    }
  }

  /** $1,900 twice would be $3,800 against a $2,000 per-symbol cap. */
  const half = { ...safeTrade, notional: 1900 };

  function slowPlane() {
    const executor = new SlowExecutor();
    const state: ControlPlaneState = {
      policy: { ...DEFAULT_POLICY },
      history: [],
      halted: false,
      peakEquityToday: healthyAccount.peakEquityToday,
    };
    return { executor, cp: new ControlPlane(state, executor, ["BTCUSDT"]) };
  }

  it("a proposal arriving mid-execution is measured against the finished trade", async () => {
    const { cp, executor } = slowPlane();
    const first = cp.submitProposal(half);
    await sleep(5);
    const second = cp.submitProposal(half);
    const [a, b] = await Promise.all([first, second]);

    expect([a.decision, b.decision].sort()).toEqual(["ALLOW", "BLOCK"]);
    expect(executor.calls).toBe(1);
    expect(executor.positions[0].notional).toBe(1900);
  });

  it("simultaneous duplicate submissions execute exactly once", async () => {
    const { cp, executor } = slowPlane();
    const results = await Promise.all([
      cp.submitProposal(half),
      cp.submitProposal(half),
      cp.submitProposal(half),
    ]);
    expect(results.filter((r) => r.executed)).toHaveLength(1);
    expect(executor.calls).toBe(1);
  });

  it("a failing submission does not stall the ones behind it", async () => {
    const { cp, executor } = slowPlane();
    executor.executeTrade = (async () => {
      throw new Error("venue exploded");
    }) as unknown as typeof executor.executeTrade;

    await expect(cp.submitProposal(safeTrade)).rejects.toThrow("venue exploded");
    const after = await cp.submitProposal({ ...safeTrade, leverage: 10 });
    expect(after.decision).toBe("BLOCK");
  });
});

describe("execution failure reporting", () => {
  it("reports an allowed trade the venue rejected as not executed", async () => {
    const state: ControlPlaneState = {
      policy: { ...DEFAULT_POLICY },
      history: [],
      halted: false,
      peakEquityToday: healthyAccount.peakEquityToday,
    };
    const executor = new SpyExecutor(healthyAccount);
    executor.executeTrade = vi.fn(async () => ({
      ok: false,
      venue: "DEMO" as const,
      simulated: true,
      message: "Binance rejected the order.",
    }));
    const cp = new ControlPlane(state, executor, ["BTCUSDT"]);

    const result = await cp.submitProposal(safeTrade);
    expect(result.decision).toBe("ALLOW");
    expect(result.executed).toBe(false);
    expect(result.record.execution?.ok).toBe(false);
  });
});

describe("unreadable account state", () => {
  it("never poisons the high-water mark with an unreadable equity reading", async () => {
    const broken = { ...healthyAccount, equity: NaN };
    const { state, cp } = build(broken);
    state.peakEquityToday = 10000;

    const account = await cp.getAccountState();
    expect(account.peakEquityToday).toBe(10000);

    // The mark survives, so the breaker still works once equity reads again.
    state.equityOverride = 9000;
    const recovered = await cp.getAccountState();
    expect(recovered.peakEquityToday).toBe(10000);
    expect(recovered.tradingHalted).toBe(true);
  });

  it("refuses to execute while equity is unreadable", async () => {
    const { cp, executor } = build({ ...healthyAccount, equity: NaN });
    const result = await cp.submitProposal(safeTrade);
    expect(result.decision).toBe("BLOCK");
    expect(executor.executeTrade).not.toHaveBeenCalled();
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
