/**
 * GET /api/risk/check/info
 *
 * Free, unauthenticated service description, so an external agent can work out
 * how to call the paid endpoint without having to pay to read an error first.
 *
 * This is documentation, not a directory: it describes exactly one endpoint and
 * advertises nothing else. It returns only public configuration — a price, a
 * network, a token address and the merchant receiving address — and never any
 * credential, key or Binance account detail.
 */

import { NextResponse } from "next/server";
import { paymentRequirements, paymentRequirementsV1, x402Config } from "@/x402/config";
import { PAYMENT_HEADERS } from "@/x402/facilitator";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = x402Config();
  const endpointUrl = new URL("/api/risk/check", req.url).toString();

  return NextResponse.json({
    service: "Fentra Risk API",
    description:
      "Deterministic pre-trade risk verdicts. Submit a proposed trade, receive " +
      "ALLOW, BLOCK or HALT with the reasons and metrics behind it. The same risk " +
      "engine Fentra applies to its own trading agent. Advisory only: this service " +
      "never places an order.",
    endpoint: "POST /api/risk/check",
    url: endpointUrl,
    price: `${cfg.priceUsdc} ${cfg.assetSymbol}`,
    network: cfg.networkLabel,
    payment: "x402",

    x402: {
      version: cfg.protocolVersion,
      /** Both documented HTTP transport header names are accepted. */
      paymentHeader: PAYMENT_HEADERS.map((h) => h.toUpperCase()),
      accepts: [
        cfg.protocolVersion === 1 ? paymentRequirementsV1(cfg, endpointUrl) : paymentRequirements(cfg),
      ],
      /**
       * LIVE   — the payment is verified by an x402 facilitator.
       * DEMO   — the payment is simulated and labelled as such. No funds move.
       */
      mode: cfg.mode,
      modeDescription:
        cfg.mode === "live"
          ? "LIVE MODE. Payments are verified through the configured x402 facilitator before a verdict is returned."
          : "DEMO MODE. No facilitator is configured. A well-formed payment header is accepted, then reported as simulated. No payment is verified on-chain and no USDC is transferred.",
      /** Fentra verifies the payment authorization; it does not call /settle. */
      settlement: "not-performed",
    },

    request: {
      contentType: "application/json",
      schema: {
        symbol: "string, e.g. BTCUSDT",
        side: '"BUY" | "SELL"',
        type: '"MARKET" | "LIMIT"',
        notional: "number, order value in USDT",
        leverage: "number, 1 for spot",
        market: '"SPOT" | "USDM_FUTURES", optional, defaults to USDM_FUTURES',
        price: "number, required for LIMIT orders",
      },
      example: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        notional: 2000,
        leverage: 3,
        market: "USDM_FUTURES",
      },
      note:
        "Trades are evaluated against Fentra's demo account, positions and risk policy. " +
        "Callers cannot supply their own policy.",
    },

    response: {
      decision: '"ALLOW" | "BLOCK" | "HALT"',
      reasons: "string[]",
      checks: "the five risk checks, each with pass/fail and the numbers behind it",
      metrics: "equity, exposure, leverage and drawdown after the proposed trade",
      payment: "{ status, mode, network, asset, amount, settled }",
      executed: "always false",
    },
  });
}
