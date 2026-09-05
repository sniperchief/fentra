import type { OrderNotionalMode, RiskPolicy } from "@/risk/types";

export const DEFAULT_POLICY: RiskPolicy = {
  maxPositionSizePct: 0.2,
  maxLeverage: 5,
  maxDailyDrawdownPct: 0.05,
  maxOrderNotional: 5000,
  maxOrderNotionalMode: "ABSOLUTE",
  maxPriceDeviationPct: 0.05,
};

/** Bounds that keep a policy edit from disabling the risk layer. */
const LIMITS = {
  maxPositionSizePct: { min: 0.01, max: 1 },
  maxLeverage: { min: 1, max: 125 },
  maxDailyDrawdownPct: { min: 0.005, max: 0.5 },
  maxPriceDeviationPct: { min: 0.001, max: 0.5 },
} as const;

/**
 * The per-order cap is clamped against different ranges depending on how it is
 * expressed: a USDT amount, or a fraction of equity.
 */
const NOTIONAL_LIMITS: Record<OrderNotionalMode, { min: number; max: number }> = {
  ABSOLUTE: { min: 10, max: 1_000_000 },
  PCT_OF_EQUITY: { min: 0.001, max: 1 },
};

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

const isMode = (v: unknown): v is OrderNotionalMode =>
  v === "ABSOLUTE" || v === "PCT_OF_EQUITY";

/**
 * Validates and clamps a policy patch. Unknown or non-numeric fields fall back
 * to the current value, so a malformed request can never widen a limit.
 */
export function applyPolicyPatch(current: RiskPolicy, patch: Partial<RiskPolicy>): RiskPolicy {
  const next: RiskPolicy = { ...current };

  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = clamp(value, LIMITS[key].min, LIMITS[key].max);
    }
  }

  // The mode is resolved first, because it decides which range the amount is
  // clamped against. Switching mode without supplying a new amount would
  // otherwise reinterpret 5000 as "500,000% of equity".
  const mode = isMode(patch.maxOrderNotionalMode)
    ? patch.maxOrderNotionalMode
    : current.maxOrderNotionalMode;
  next.maxOrderNotionalMode = mode;

  const rawNotional =
    typeof patch.maxOrderNotional === "number" && Number.isFinite(patch.maxOrderNotional)
      ? patch.maxOrderNotional
      : mode === current.maxOrderNotionalMode
        ? current.maxOrderNotional
        : // Mode changed with no amount given: fall back to that mode's default
          // rather than carrying a figure that means something else now.
          DEFAULT_NOTIONAL_BY_MODE[mode];

  next.maxOrderNotional = clamp(rawNotional, NOTIONAL_LIMITS[mode].min, NOTIONAL_LIMITS[mode].max);

  return next;
}

/** Sensible starting value when the user flips the cap to the other mode. */
const DEFAULT_NOTIONAL_BY_MODE: Record<OrderNotionalMode, number> = {
  ABSOLUTE: 5000,
  PCT_OF_EQUITY: 0.1,
};
