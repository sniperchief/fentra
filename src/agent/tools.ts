/**
 * The agent's complete tool surface.
 *
 * Read tools plus one write path, `propose_trade`, which submits to the control
 * plane and returns whatever verdict comes back. There is deliberately no
 * place_order, execute_trade, set_leverage or set_margin_mode tool: the model
 * has no vocabulary for reaching Binance directly.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ControlPlane } from "@/server/control-plane";
import type { OrderType, ProposedTrade, Side } from "@/risk/types";
import { TRACKED_SYMBOLS } from "@/binance/market-data";
import { CheckTradeRiskArgs, checkTradeRisk } from "@/mcp/tools/check-trade-risk";

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "get_market_data",
    description: "Live price and 24h change for a symbol, from Binance public market data.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", enum: [...TRACKED_SYMBOLS], description: "e.g. BTCUSDT" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_account_state",
    description:
      "Account equity, available balance, intraday peak equity and whether trading is halted.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_open_positions",
    description: "All open positions with side, notional exposure, leverage and unrealised PnL.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_risk_policy",
    description: "The user's current risk policy limits.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_trade_risk",
    description:
      "Dry-run a trade against the risk engine and get the ALLOW, BLOCK or HALT verdict it " +
      "would receive, without submitting anything. Use this to check your sizing before you " +
      "propose. Advisory only: nothing is recorded and no order is placed.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", enum: [...TRACKED_SYMBOLS] },
        side: { type: "string", enum: ["BUY", "SELL"] },
        type: { type: "string", enum: ["MARKET", "LIMIT"] },
        notional: { type: "number", description: "Order value in USDT." },
        leverage: { type: "integer", description: "Whole-number leverage. Use 1 for spot." },
        price: { type: "number", description: "Required for LIMIT orders." },
        market: { type: "string", enum: ["SPOT", "USDM_FUTURES"] },
      },
      required: ["symbol", "side", "type", "notional", "leverage", "market"],
    },
  },
  {
    name: "propose_trade",
    description:
      "Submit a trade proposal to the Fentra risk engine. Returns a deterministic ALLOW, " +
      "BLOCK or HALT verdict with the checks behind it. On ALLOW the application executes the " +
      "trade itself. This tool never guarantees execution and you cannot override its verdict.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", enum: [...TRACKED_SYMBOLS] },
        side: { type: "string", enum: ["BUY", "SELL"] },
        type: { type: "string", enum: ["MARKET", "LIMIT"] },
        notional: { type: "number", description: "Order value in USDT." },
        leverage: { type: "integer", description: "Whole-number leverage. Use 1 for spot." },
        price: { type: "number", description: "Required for LIMIT orders." },
        market: { type: "string", enum: ["SPOT", "USDM_FUTURES"] },
        rationale: { type: "string", description: "One sentence on why this trade." },
      },
      required: ["symbol", "side", "type", "notional", "leverage", "market"],
    },
  },
];

export interface ToolOutcome {
  content: string;
  /** Set when the call was a proposal, so the UI can render the risk report. */
  proposalRecordId?: string;
}

export async function runTool(
  cp: ControlPlane,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  switch (name) {
    case "get_market_data": {
      const market = await cp.getMarketData(String(input.symbol ?? "BTCUSDT"));
      return { content: JSON.stringify(market) };
    }
    case "get_account_state": {
      return { content: JSON.stringify(await cp.getAccountState()) };
    }
    case "get_open_positions": {
      return { content: JSON.stringify(await cp.getPositions()) };
    }
    case "get_risk_policy": {
      return { content: JSON.stringify(cp.policy) };
    }
    case "check_trade_risk": {
      // Delegates to the MCP tool implementation, so the agent and an external
      // MCP client get byte-identical verdicts from one code path.
      const verdict = await checkTradeRisk(cp, CheckTradeRiskArgs.parse(input));
      return { content: JSON.stringify(verdict) };
    }
    case "propose_trade": {
      const proposal = coerceProposal(input);
      const result = await cp.submitProposal(proposal, {
        agentRationale: typeof input.rationale === "string" ? input.rationale : undefined,
      });
      return {
        proposalRecordId: result.record.id,
        content: JSON.stringify({
          decision: result.decision,
          reasons: result.record.evaluation.reasons,
          checks: result.record.evaluation.checks.map((c) => ({
            check: c.label,
            passed: c.passed,
            detail: c.detail,
          })),
          metrics: result.record.evaluation.metrics,
          executed: result.executed,
          execution: result.record.execution
            ? {
                venue: result.record.execution.venue,
                simulated: result.record.execution.simulated,
                message: result.record.execution.message,
                filledPrice: result.record.execution.filledPrice,
              }
            : null,
        }),
      };
    }
    default:
      return { content: JSON.stringify({ error: `Unknown tool ${name}` }) };
  }
}

/**
 * Normalises model output into a proposal. Values are coerced, never trusted:
 * anything malformed still reaches the risk engine, where Order Sanity
 * Validation rejects it with a readable reason.
 */
export function coerceProposal(input: Record<string, unknown>): ProposedTrade {
  const market = input.market === "SPOT" ? "SPOT" : "USDM_FUTURES";
  return {
    symbol: String(input.symbol ?? "").toUpperCase(),
    side: (input.side === "SELL" ? "SELL" : "BUY") as Side,
    type: (input.type === "LIMIT" ? "LIMIT" : "MARKET") as OrderType,
    notional: Number(input.notional),
    leverage: market === "SPOT" ? 1 : Number(input.leverage),
    price: input.price === undefined ? undefined : Number(input.price),
    market,
    rationale: typeof input.rationale === "string" ? input.rationale : undefined,
  };
}
