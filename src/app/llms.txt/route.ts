/**
 * GET /llms.txt
 *
 * Machine-readable service description, following the llms.txt convention for
 * plain-text docs an agent can read without parsing a rendered page.
 *
 * Generated from the same configuration the endpoint enforces, so it cannot
 * drift: the price, network and mode here are the ones a caller will actually
 * be charged and verified against. It says plainly when payments are simulated.
 */

import { paymentRequirements, paymentRequirementsV1, x402Config } from "@/x402/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = x402Config();
  const origin = new URL(req.url).origin;
  const endpoint = `${origin}/api/risk/check`;
  const accepts =
    cfg.protocolVersion === 1 ? paymentRequirementsV1(cfg, endpoint) : paymentRequirements(cfg);

  const modeBlock =
    cfg.mode === "live"
      ? `LIVE MODE. Payments are verified by an x402 facilitator before any verdict is
returned. Fentra calls /verify but not /settle, so a payment is authorized and
confirmed against on-chain balance, not transferred. Responses report
"settled": false.`
      : `DEMO MODE. No facilitator is configured. A well-formed payment header is
accepted and then reported as "simulated". Nothing is verified on-chain and no
funds move. The payTo address is the zero address, not a merchant wallet.`;

  const body = `# Fentra

> A deterministic risk control plane between an AI trading agent and Binance
> execution. Every proposed trade is evaluated against a risk policy, live
> account state and market conditions before it can reach the exchange.

Fentra exposes its risk engine to other software. Both surfaces below return the
same ALLOW / BLOCK / HALT verdict the human console shows, produced by the same
evaluateTrade function. Neither can place an order.

## Paid HTTP API (x402)

POST ${endpoint}
Price: ${cfg.priceUsdc} ${cfg.assetSymbol} per call
Network: ${cfg.networkLabel} (${cfg.network})
Protocol: x402 v${cfg.protocolVersion}, scheme "${cfg.scheme}"
Payment header: PAYMENT-SIGNATURE or X-PAYMENT (base64 PaymentPayload)
Pay to: ${accepts.payTo}
Asset: ${accepts.asset}

An unpaid request returns HTTP 402 with payment requirements in the standard
x402 format. Sign the authorization, retry with the payment header, receive the
verdict. Any x402-compatible client works; you do not need to implement the
protocol yourself.

${modeBlock}

Request body:
  { "symbol": "BTCUSDT", "side": "BUY", "type": "MARKET",
    "notional": 2000, "leverage": 20, "market": "USDM_FUTURES" }

  side    BUY | SELL
  type    MARKET | LIMIT   (price required for LIMIT)
  market  SPOT | USDM_FUTURES, defaults to USDM_FUTURES
  Trades are evaluated against Fentra's own account and policy. Callers cannot
  supply their own policy.

Response body:
  { "decision": "ALLOW" | "BLOCK" | "HALT",
    "reasons": [ "..." ],
    "checks": [ /* five risk checks with the numbers behind each */ ],
    "metrics": { /* equity, exposure, leverage, drawdown after the trade */ },
    "payment": { "status": "...", "mode": "...", "settled": false },
    "executed": false }

## Local MCP server

Three read-only tools over stdio, no payment:
  fentra_check_trade_risk   verdict for one proposed trade
  fentra_get_risk_policy    the active limits
  fentra_get_risk_status    equity, exposure and halt state

Run: npx tsx --env-file-if-exists=.env.local src/mcp/server.ts
The MCP server registers no tool that can trade.

## Other endpoints

GET ${origin}/api/risk/check/info   full service description as JSON
GET ${origin}/api/x402/log          log of external paid checks
GET ${origin}/agents                integration guide for humans

## Guarantees

- The verdict is deterministic. The same inputs always produce the same answer,
  and no language model takes part in the decision.
- Payment is verified before the risk engine runs. There is no free tier and no
  bypass; an absent, malformed or underpaying request is refused with a 402.
- This API is read-only with respect to trading. It returns verdicts and cannot
  reach the execution adapter under any input.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
