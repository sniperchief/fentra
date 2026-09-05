import type { ControlPlane } from "@/server/control-plane";
import { resolveOrderNotionalLimit } from "@/risk/risk-rules";
import type { RiskPolicyResult } from "./types";

/**
 * `fentra.get_risk_policy` — the limits every verdict is measured against.
 *
 * Read straight off the control plane's live policy object, so an agent that
 * reads the policy and then sizes to it is looking at the same numbers the
 * engine will apply. Nothing is hardcoded here.
 */
export async function getRiskPolicy(cp: ControlPlane): Promise<RiskPolicyResult> {
  const policy = cp.policy;
  // In PCT_OF_EQUITY mode the per-order cap only means something against live
  // equity, so it is resolved before being reported.
  const account = await cp.getAccountState();

  return {
    maxPositionPercent: policy.maxPositionSizePct * 100,
    maxLeverage: policy.maxLeverage,
    maxDailyDrawdownPercent: policy.maxDailyDrawdownPct * 100,
    maxOrderNotional: resolveOrderNotionalLimit(account, policy),
    maxOrderNotionalMode: policy.maxOrderNotionalMode,
    maxPriceDeviationPercent: policy.maxPriceDeviationPct * 100,
  };
}
