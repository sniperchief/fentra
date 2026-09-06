/**
 * Process-local application state.
 *
 * A hackathon MVP does not need a database: one operator, one browser tab, one
 * server process. State is held in a module singleton that survives Next.js hot
 * reloads via globalThis.
 */

import { ControlPlane, type ControlPlaneState } from "./control-plane";
import {
  createExecutor,
  resetPositions,
  seedPortfolio,
  type DemoPortfolio,
} from "@/binance/trading-executor";
import { TRACKED_SYMBOLS } from "@/binance/market-data";
import { DEFAULT_POLICY } from "@/policy/policy-store";
import type { TradingExecutor } from "@/binance/types";

interface Session {
  state: ControlPlaneState;
  portfolio: DemoPortfolio;
  executor: TradingExecutor;
  controlPlane: ControlPlane;
}

declare global {
  // eslint-disable-next-line no-var
  var __fentraSession: Session | undefined;
}

function build(): Session {
  const portfolio = seedPortfolio();
  const executor = createExecutor(portfolio);
  const state: ControlPlaneState = {
    policy: { ...DEFAULT_POLICY },
    history: [],
    halted: false,
    // Demo mode uses the seeded peak so the dashboard opens on a realistic
    // small drawdown. Live mode starts null and adopts the first real equity
    // reading — seeding it with the demo figure would show a fictitious
    // drawdown against the real account and halt trading immediately.
    peakEquityToday: executor.venue === "DEMO" ? portfolio.peakEquityToday : null,
  };
  return {
    state,
    portfolio,
    executor,
    controlPlane: new ControlPlane(state, executor, TRACKED_SYMBOLS),
  };
}

export function getSession(): Session {
  if (!globalThis.__fentraSession) globalThis.__fentraSession = build();
  return globalThis.__fentraSession;
}

export function getControlPlane(): ControlPlane {
  return getSession().controlPlane;
}

/** Full reset back to the seeded demo state, including the halt latch. */
export function resetSession(): void {
  globalThis.__fentraSession = build();
}

/**
 * Stages the drawdown scenario by raising the intraday high-water mark above
 * current equity, so the account shows a real drawdown from a real balance.
 *
 * Deliberately not an equity override: replacing the balance would show a
 * fabricated figure for a connected account and feed it to the risk engine for
 * the rest of the session. Raising the mark uses the same field the breaker
 * really measures against, and current equity stays whatever the venue says.
 */
export function stageDrawdownFromPeak(currentEquity: number, breachPct: number): void {
  const s = getSession();
  const breach = Math.min(Math.max(breachPct, 0), 0.9);
  s.state.peakEquityToday = currentEquity / (1 - breach);
  // Any override left by an earlier run is cleared, so equity reads true.
  s.state.equityOverride = undefined;
}

/**
 * Returns the demo portfolio to its seeded positions so each scenario is
 * evaluated from the same baseline and demonstrates its own rule rather than
 * inheriting exposure from the scenario before it.
 *
 * The halt latch is deliberately left alone: once the circuit breaker trips it
 * must stay tripped, which is the point of scenario 4. No-op outside demo mode,
 * because there is no local portfolio to reset when orders go to Binance.
 */
export function resetDemoPositions(): void {
  const s = getSession();
  if (s.executor.venue !== "DEMO") return;
  resetPositions(s.portfolio);
}
