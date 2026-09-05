/**
 * The Fentra control plane.
 *
 * This is the only module in the application that calls
 * `TradingExecutor.executeTrade`. The agent cannot reach the executor: the
 * agent's tools call `submitProposal`, which evaluates the proposal against the
 * deterministic risk engine and executes only on ALLOW. There is no argument,
 * prompt or tool call that routes around this function.
 *
 * The halt latch also lives here rather than in the executor, so it applies
 * identically in demo and live mode.
 */

import crypto from "node:crypto";
import { evaluateAccountOperation, evaluateTrade, type AccountOperation } from "@/risk/risk-engine";
import { dailyDrawdown } from "@/risk/risk-rules";
import type {
  AccountState,
  Decision,
  MarketState,
  Position,
  ProposedTrade,
  RiskEvaluation,
  RiskPolicy,
} from "@/risk/types";
import type { ApprovedTrade, ExecutionResult, TradingExecutor } from "@/binance/types";

export interface TradeRecord {
  id: string;
  timestamp: number;
  trade: ProposedTrade;
  evaluation: RiskEvaluation;
  execution?: ExecutionResult;
  /** Present when the agent produced the proposal. */
  agentRationale?: string;
}

export interface SubmitResult {
  record: TradeRecord;
  decision: Decision;
  executed: boolean;
}

export interface PortfolioSnapshot {
  account: AccountState;
  positions: Position[];
  markets: MarketState[];
  exposure: number;
  accountLeverage: number;
  dailyDrawdown: number;
  todayPnl: number;
}

export interface ControlPlaneState {
  policy: RiskPolicy;
  history: TradeRecord[];
  halted: boolean;
  haltReason?: string;
  /**
   * Intraday equity high-water mark, owned here so it survives across polls.
   *
   * `null` means "not yet observed": the first equity reading becomes the mark.
   * Live mode starts null because Binance does not expose an intraday peak, and
   * seeding it with any invented figure would manufacture a false drawdown.
   */
  peakEquityToday: number | null;
  /** Set by the demo scenario runner to stage a drawdown. */
  equityOverride?: number;
}

export class ControlPlane {
  constructor(
    private readonly state: ControlPlaneState,
    private readonly executor: TradingExecutor,
    private readonly trackedSymbols: readonly string[],
  ) {}

  get policy(): RiskPolicy {
    return this.state.policy;
  }

  get history(): TradeRecord[] {
    return this.state.history;
  }

  get venue() {
    return this.executor.venue;
  }

  describeConnection() {
    return this.executor.describeConnection();
  }

  /**
   * Account state as the risk engine sees it: the executor's numbers, plus the
   * control plane's own high-water mark and halt latch.
   */
  async getAccountState(): Promise<AccountState> {
    const base = await this.executor.getAccountState();
    const equity = this.state.equityOverride ?? base.equity;

    // First observation establishes the mark; after that it only ratchets up.
    if (this.state.peakEquityToday === null || equity > this.state.peakEquityToday) {
      this.state.peakEquityToday = equity;
    }

    const account: AccountState = {
      ...base,
      equity,
      peakEquityToday: Math.max(this.state.peakEquityToday, equity),
      tradingHalted: this.state.halted,
      haltReason: this.state.haltReason,
    };

    // Latch the breaker as soon as the threshold is crossed, independently of
    // whether a trade was proposed. Once latched it stays latched for the day.
    if (!this.state.halted && dailyDrawdown(account) > this.state.policy.maxDailyDrawdownPct) {
      this.latchHalt(account);
      return { ...account, tradingHalted: true, haltReason: this.state.haltReason };
    }
    return account;
  }

  private latchHalt(account: AccountState) {
    const dd = dailyDrawdown(account);
    this.state.halted = true;
    this.state.haltReason =
      `Daily drawdown limit exceeded. Peak equity $${account.peakEquityToday.toFixed(2)}, ` +
      `current equity $${account.equity.toFixed(2)}, drawdown ${(dd * 100).toFixed(2)}% ` +
      `against a ${(this.state.policy.maxDailyDrawdownPct * 100).toFixed(2)}% limit. ` +
      `All new trades are blocked.`;
  }

  async getPositions(): Promise<Position[]> {
    return this.executor.getPositions();
  }

  async getMarketData(symbol: string): Promise<MarketState> {
    return this.executor.getMarketData(symbol);
  }

  async getSnapshot(): Promise<PortfolioSnapshot> {
    const [account, positions, markets] = await Promise.all([
      this.getAccountState(),
      this.getPositions(),
      Promise.all(this.trackedSymbols.map((s) => this.executor.getMarketData(s))),
    ]);

    const exposure = positions.reduce((sum, p) => sum + Math.abs(p.notional), 0);
    return {
      account,
      positions,
      markets,
      exposure,
      accountLeverage: account.equity > 0 ? exposure / account.equity : 0,
      dailyDrawdown: dailyDrawdown(account),
      todayPnl: account.equity - account.startOfDayEquity,
    };
  }

  /**
   * The single gate. Everything that wants to trade goes through here.
   *
   * Note the ordering: the verdict is computed first, and `executeTrade` is
   * reachable only inside the ALLOW branch. The proposal's own fields never
   * influence the branch.
   */
  async submitProposal(
    proposal: ProposedTrade,
    opts: { agentRationale?: string } = {},
  ): Promise<SubmitResult> {
    const [account, positions, market] = await Promise.all([
      this.getAccountState(),
      this.getPositions(),
      this.getMarketData(proposal.symbol),
    ]);

    const evaluation = evaluateTrade({
      account,
      positions,
      market,
      proposedTrade: proposal,
      policy: this.state.policy,
    });

    const record: TradeRecord = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      trade: proposal,
      evaluation,
      agentRationale: opts.agentRationale,
    };

    if (evaluation.decision === "HALT" && !this.state.halted) this.latchHalt(account);

    if (evaluation.decision !== "ALLOW") {
      // No executor call on this path. This is what the security tests assert.
      this.state.history.unshift(record);
      return { record, decision: evaluation.decision, executed: false };
    }

    const approved: ApprovedTrade = {
      ...proposal,
      approvalId: record.id,
      approvedAt: Date.now(),
    };
    record.execution = await this.executor.executeTrade(approved);
    this.state.history.unshift(record);

    return { record, decision: "ALLOW", executed: record.execution.ok };
  }

  /**
   * Risk-sensitive settings changes go through the same policy, so an agent
   * cannot raise leverage first and place a compliant-looking order second.
   */
  async submitAccountOperation(op: AccountOperation) {
    const account = await this.getAccountState();
    return evaluateAccountOperation(op, account, this.state.policy);
  }

  /**
   * Stateless risk verdict for the public API. Evaluates against live account
   * and market state without touching history or the executor.
   */
  async evaluateOnly(proposal: ProposedTrade, policyOverride?: RiskPolicy): Promise<RiskEvaluation> {
    const [account, positions, market] = await Promise.all([
      this.getAccountState(),
      this.getPositions(),
      this.getMarketData(proposal.symbol),
    ]);
    return evaluateTrade({
      account,
      positions,
      market,
      proposedTrade: proposal,
      policy: policyOverride ?? this.state.policy,
    });
  }
}
