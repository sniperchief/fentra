import type { ControlPlane } from "@/server/control-plane";
import type { RiskStatusResult } from "./types";

/**
 * `fentra.get_risk_status` — is trading open, and how much headroom is left.
 *
 * Built from the same snapshot the console renders, so an agent and an operator
 * are never looking at different numbers. Reading status can latch the circuit
 * breaker (the control plane checks drawdown on every account read), which is
 * intended: the breaker must trip on observation, not only on a proposal.
 */
export async function getRiskStatus(cp: ControlPlane): Promise<RiskStatusResult> {
  const snapshot = await cp.getSnapshot();
  const { account, positions } = snapshot;

  const largestPosition = positions.reduce((max, p) => Math.max(max, Math.abs(p.notional)), 0);

  return {
    status: account.tradingHalted ? "HALTED" : "ACTIVE",
    currentEquity: account.equity,
    peakEquityToday: account.peakEquityToday,
    dailyDrawdown: snapshot.dailyDrawdown * 100,
    largestPositionPercent: account.equity > 0 ? (largestPosition / account.equity) * 100 : 0,
    openExposure: snapshot.exposure,
    accountLeverage: snapshot.accountLeverage,
    tradingHalted: account.tradingHalted,
    haltReason: account.haltReason,
  };
}
