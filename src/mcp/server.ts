#!/usr/bin/env node
/**
 * The Fentra MCP server.
 *
 * Exposes Fentra's deterministic risk engine to any MCP-capable agent as three
 * read-only tools. The agent keeps its own Binance capability; Fentra answers
 * one question — may this trade happen, given this portfolio right now.
 *
 *     agent → proposes a trade → fentra.check_trade_risk → ALLOW/BLOCK/HALT
 *           → on ALLOW only, the agent executes through its own authorization
 *
 * There is deliberately no place_order, execute_trade or submit_trade tool
 * here. Nothing registered on this server can reach a Binance trading
 * endpoint: `evaluateOnly` and `getSnapshot` are the only control-plane
 * methods called, and neither touches the executor. The application's own
 * execution gate (`ControlPlane.submitProposal`) is unchanged and unreachable
 * from this transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getControlPlane } from "@/server/session";
import { CheckTradeRiskArgs, checkTradeRisk, checkTradeRiskInput } from "./tools/check-trade-risk";
import { getRiskPolicy } from "./tools/get-risk-policy";
import { getRiskStatus } from "./tools/get-risk-status";

/** MCP names cannot contain a dot, so the product prefix uses an underscore. */
export const TOOL_NAMES = {
  checkTradeRisk: "fentra_check_trade_risk",
  getRiskPolicy: "fentra_get_risk_policy",
  getRiskStatus: "fentra_get_risk_status",
} as const;

/** Every tool is read-only and non-destructive; state it in the annotations. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;

const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

export function createFentraMcpServer(): McpServer {
  const server = new McpServer(
    { name: "fentra", version: "1.0.0" },
    {
      instructions:
        "Fentra is a deterministic risk-control layer for AI trading agents. Before you " +
        "execute any trade through your Binance capability, submit it to " +
        `${TOOL_NAMES.checkTradeRisk} and act on the verdict: proceed only on ALLOW; on ` +
        "BLOCK explain the failing rule and do not execute; on HALT stop trading for the " +
        "day. Fentra never places orders itself.",
    },
  );

  server.registerTool(
    TOOL_NAMES.checkTradeRisk,
    {
      title: "Check trade risk",
      description:
        "Evaluate a proposed trade against the account's risk policy, live account state, " +
        "open positions and current market data. Returns a deterministic ALLOW, BLOCK or " +
        "HALT verdict with the checks behind it. Advisory only: no order is placed, and the " +
        "verdict cannot be overridden or negotiated. Rejected trades are not resized for you.",
      inputSchema: checkTradeRiskInput,
      annotations: READ_ONLY,
    },
    async (args) => json(await checkTradeRisk(getControlPlane(), CheckTradeRiskArgs.parse(args))),
  );

  server.registerTool(
    TOOL_NAMES.getRiskPolicy,
    {
      title: "Get risk policy",
      description:
        "The account owner's configured risk limits: max position size, max leverage, max " +
        "daily drawdown, max order notional and max price deviation. Read this before sizing " +
        "a trade so your proposal fits the mandate.",
      annotations: READ_ONLY,
    },
    async () => json(await getRiskPolicy(getControlPlane())),
  );

  server.registerTool(
    TOOL_NAMES.getRiskStatus,
    {
      title: "Get risk status",
      description:
        "Current risk state: whether trading is active or halted by the circuit breaker, " +
        "equity, intraday drawdown, largest position as a share of equity, and open exposure.",
      annotations: READ_ONLY,
    },
    async () => json(await getRiskStatus(getControlPlane())),
  );

  return server;
}

async function main() {
  const server = createFentraMcpServer();
  // stdio: the transport every documented MCP host speaks for a local server.
  // Nothing may be written to stdout except protocol frames, so logs go to stderr.
  await server.connect(new StdioServerTransport());
  console.error("Fentra MCP server ready on stdio.");
}

// Only run the transport when executed directly; importing the module for
// tests or for an HTTP transport must not open stdio.
if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error("Fentra MCP server failed to start:", err);
    process.exit(1);
  });
}
