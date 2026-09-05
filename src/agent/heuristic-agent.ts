/**
 * Keyless fallback proposer.
 *
 * Without ANTHROPIC_API_KEY there is no model, but the point of the demo is the
 * risk layer, not the reasoning. This parses a symbol, size and leverage out of
 * the message and submits a proposal through the exact same control plane the
 * model uses, so the gating path under test is identical.
 *
 * It is labelled in the UI as a fallback and never presented as the AI agent.
 */

import type { ControlPlane, TradeRecord } from "@/server/control-plane";
import type { ProposedTrade } from "@/risk/types";
import { TRACKED_SYMBOLS } from "@/binance/market-data";

export interface AgentTurn {
  reply: string;
  records: TradeRecord[];
  usedFallback: boolean;
}

export async function heuristicAgent(
  cp: ControlPlane,
  message: string,
): Promise<AgentTurn> {
  const text = message.toLowerCase();
  const symbol = pickSymbol(text);
  const market = await cp.getMarketData(symbol);
  const account = await cp.getAccountState();

  const requestedNotional = parseNotional(text);
  const requestedLeverage = parseLeverage(text);

  // Trade intent is either an explicit verb, or a concrete size the user has
  // already specified ("$5,000 at 3x" is an instruction, not a question).
  const wantsTrade =
    /\b(buy|sell|long|short|trade|position|open|propose|enter|allocate|put|deploy|opportunit)/.test(
      text,
    ) || (requestedNotional !== null && requestedLeverage !== null);

  if (!wantsTrade) {
    return {
      reply:
        `${symbol} is at $${market.price.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        })}, ${market.priceChangePercent.toFixed(2)}% over 24h. ` +
        `Equity is $${account.equity.toFixed(2)}. Ask me to open a position and I will submit a ` +
        `proposal to the risk engine.`,
      records: [],
      usedFallback: true,
    };
  }

  const notional =
    requestedNotional ?? defaultNotional(account.equity, cp.policy.maxPositionSizePct);
  const leverage = requestedLeverage ?? 3;
  const side = /\b(sell|short)\b/.test(text) ? "SELL" : "BUY";

  const proposal: ProposedTrade = {
    symbol,
    side,
    type: "MARKET",
    notional,
    leverage,
    market: "USDM_FUTURES",
    rationale: `Fallback proposer: ${side} ${symbol} at market, sized from the request.`,
  };

  const result = await cp.submitProposal(proposal, {
    agentRationale: proposal.rationale,
  });

  const verdict = result.record.evaluation;
  const summary =
    verdict.decision === "ALLOW"
      ? `Proposal cleared all ${verdict.checks.length} risk checks. ${
          result.record.execution?.message ?? ""
        }`
      : `Risk engine returned ${verdict.decision}. ${verdict.reasons.join(" ")}`;

  return {
    reply:
      `Submitted ${side} $${notional.toLocaleString("en-US")} ${symbol} at ${leverage}x ` +
      `(market $${market.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}).\n\n${summary}`,
    records: [result.record],
    usedFallback: true,
  };
}

function pickSymbol(text: string): string {
  for (const s of TRACKED_SYMBOLS) {
    if (text.includes(s.toLowerCase())) return s;
  }
  if (/\beth|ethereum\b/.test(text)) return "ETHUSDT";
  if (/\bsol|solana\b/.test(text)) return "SOLUSDT";
  if (/\bbnb\b/.test(text)) return "BNBUSDT";
  return "BTCUSDT";
}

/** Matches "$2,000", "2000 usd", "2k". */
function parseNotional(text: string): number | null {
  const k = text.match(/\$?\s*([\d,.]+)\s*k\b/);
  if (k) return Number(k[1].replace(/,/g, "")) * 1000;
  const plain = text.match(/\$\s*([\d,]+(?:\.\d+)?)/) ?? text.match(/\b([\d,]{3,})\s*(?:usd|usdt)?\b/);
  if (plain) {
    const n = Number(plain[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function parseLeverage(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*x\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Half the per-symbol cap, so the default proposal is comfortably compliant. */
function defaultNotional(equity: number, maxPositionSizePct: number): number {
  return Math.round((equity * maxPositionSizePct) / 2 / 100) * 100;
}
