import type { PortfolioSnapshot, TradeRecord } from "@/server/control-plane";
import type { Decision, RiskPolicy } from "@/risk/types";
import type { Venue } from "@/binance/types";

export interface AppState {
  snapshot: PortfolioSnapshot;
  connection: { connected: boolean; label: string; detail: string; venue: Venue };
  policy: RiskPolicy;
  history: TradeRecord[];
  agentConfigured: boolean;
  agentModel: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  records?: TradeRecord[];
  usedFallback?: boolean;
  error?: boolean;
}

export interface ScenarioSummary {
  id: string;
  title: string;
  expected: Decision;
  summary: string;
}

/**
 * Where the current proposal sits in the pipeline. Drives the flow diagram,
 * the proposal panel and the risk engine reveal. Every state after PROPOSING
 * is derived from a real control-plane response — nothing here invents a
 * verdict.
 */
export type Stage = "IDLE" | "PROPOSING" | "EVALUATING" | "DECIDED";

export const usd = (n: number, digits = 2) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Compact money for dense table cells: $2,000 rather than $2,000.00. */
export const usd0 = (n: number) => usd(n, 0);

export const pct = (n: number, digits = 2) => `${(n * 100).toFixed(digits)}%`;

export const signed = (n: number, digits = 2) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n), digits)}`;

export const clockTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-US", { hour12: false });

export const num = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Past-tense verdict wording used in the audit log. */
export const verdictWord = (d: Decision) =>
  d === "ALLOW" ? "ALLOWED" : d === "BLOCK" ? "BLOCKED" : "HALTED";

export interface DecisionTheme {
  text: string;
  border: string;
  bg: string;
  dot: string;
  solid: string;
}

export const DECISION_THEME: Record<Decision, DecisionTheme> = {
  ALLOW: {
    text: "text-allow",
    border: "border-allow/35",
    bg: "bg-allow/[0.06]",
    dot: "bg-allow",
    solid: "bg-allow text-white",
  },
  BLOCK: {
    text: "text-block",
    border: "border-block/35",
    bg: "bg-block/[0.05]",
    dot: "bg-block",
    solid: "bg-block text-white",
  },
  HALT: {
    text: "text-halt",
    border: "border-halt/40",
    bg: "bg-halt/[0.06]",
    dot: "bg-halt",
    solid: "bg-halt text-white",
  },
};

/** Short, judge-legible headline for each verdict. */
export const DECISION_COPY: Record<Decision, { title: string; caption: string }> = {
  ALLOW: { title: "ALLOW", caption: "Within policy. Execution permitted." },
  BLOCK: { title: "BLOCKED", caption: "Policy violation. Execution prevented." },
  HALT: { title: "HALTED", caption: "Circuit breaker latched. Trading stopped." },
};

/**
 * Short stable fingerprint of the active policy, so the UI can say which
 * revision produced a verdict without inventing a version counter.
 */
export const policyRev = (policy: RiskPolicy): string => {
  const serialized = JSON.stringify([
    policy.maxPositionSizePct,
    policy.maxLeverage,
    policy.maxDailyDrawdownPct,
    policy.maxOrderNotional,
    policy.maxOrderNotionalMode,
    policy.maxPriceDeviationPct,
  ]);
  let h = 2166136261;
  for (let i = 0; i < serialized.length; i++) {
    h ^= serialized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).slice(0, 4).padStart(4, "0");
};
