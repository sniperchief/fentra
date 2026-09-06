/**
 * Fentra's paid risk API. POST /api/risk/check
 *
 * Any external agent can submit a proposed trade and receive the same
 * deterministic ALLOW / BLOCK / HALT verdict Fentra applies to its own agent,
 * after paying a fixed USDC fee over x402 on BNB Chain.
 *
 * This is a wrapper, not a second risk system. It calls
 * `ControlPlane.evaluateOnly`, which calls the one `evaluateTrade` in
 * `@/risk/risk-engine` — there is no risk logic in this file.
 *
 * Two properties hold on every path through this handler:
 *
 *   1. Payment is settled before risk is evaluated. Every `return` above the
 *      evaluation is a 402; the engine is unreachable without a payment the
 *      facilitator accepted (LIVE) or a well-formed payment header (DEMO).
 *   2. Nothing here can trade. `evaluateOnly` reads account, positions and
 *      market state and returns a verdict; the executor is reached only from
 *      `ControlPlane.submitProposal`, which this file never calls.
 */

import { NextResponse } from "next/server";
import { getControlPlane } from "@/server/session";
import { coerceProposal } from "@/agent/tools";
import {
  paymentRequirements,
  paymentRequirementsV1,
  resourceDescriptor,
  x402Config,
} from "@/x402/config";
import { readPaymentHeader, verifyPayment } from "@/x402/facilitator";
import { recordX402Check } from "@/x402/ledger";
import type { PaymentRequiredResponse, PaymentRequiredResponseV1 } from "@/x402/types";
import type { X402Config } from "@/x402/config";

export const dynamic = "force-dynamic";

/**
 * The HTTP 402 body, in the shape the x402 specification defines for the
 * configured generation. Emitted verbatim so a standard x402 client can read it
 * without special-casing Fentra.
 *
 * v1 and v2 are different documents, not a v2 with fields renamed: v1 puts the
 * resource inside each `accepts` entry and calls the price `maxAmountRequired`.
 */
function paymentRequired(cfg: X402Config, resourceUrl: string, error: string) {
  if (cfg.protocolVersion === 1) {
    const body: PaymentRequiredResponseV1 = {
      x402Version: 1,
      error,
      accepts: [paymentRequirementsV1(cfg, resourceUrl)],
    };
    return NextResponse.json(body, { status: 402 });
  }

  const body: PaymentRequiredResponse = {
    x402Version: 2,
    error,
    resource: resourceDescriptor(resourceUrl),
    accepts: [paymentRequirements(cfg)],
  };
  return NextResponse.json(body, { status: 402 });
}

export async function POST(req: Request) {
  const cfg = x402Config();
  const resourceUrl = new URL(req.url).toString();

  // ---- Payment gate. Nothing below this block runs without getting past it.
  const outcome = await verifyPayment(readPaymentHeader(req.headers), cfg, resourceUrl);
  if (!outcome.ok) {
    return paymentRequired(cfg, resourceUrl, outcome.reason);
  }

  // Accept either a bare proposal or one wrapped as { trade: {...} }.
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const raw = (body?.trade ?? body) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object" || !raw.symbol) {
    return NextResponse.json(
      {
        error: "Body must be a trade proposal with at least a `symbol`.",
        example: { symbol: "BTCUSDT", side: "BUY", type: "MARKET", notional: 2000, leverage: 3 },
      },
      { status: 400 },
    );
  }

  // Malformed values are deliberately not rejected here: `coerceProposal`
  // normalises them and the engine's Order Sanity check reports what is wrong,
  // which is a more useful answer than a 400.
  const proposal = coerceProposal(raw);

  // The verdict is evaluated against Fentra's own account, positions and
  // policy. A caller cannot supply a policy: a verdict produced under limits
  // the caller chose would not mean anything.
  const evaluation = await getControlPlane().evaluateOnly(proposal);

  recordX402Check({
    symbol: proposal.symbol,
    side: proposal.side,
    notional: proposal.notional,
    leverage: proposal.leverage,
    decision: evaluation.decision,
    mode: outcome.payment.mode,
    status: outcome.payment.status,
    settled: outcome.payment.settled,
    priceUsdc: cfg.priceUsdc,
  });

  return NextResponse.json({
    decision: evaluation.decision,
    reasons: evaluation.reasons,
    checks: evaluation.checks,
    metrics: evaluation.metrics,
    policy: evaluation.policySnapshot,
    payment: outcome.payment,
    // Stated explicitly so a calling agent cannot mistake a verdict for a fill.
    executed: false,
    note: "Advisory verdict only. This endpoint cannot place an order.",
  });
}

/** A bare GET is answered the way x402 expects: with the price. */
export async function GET(req: Request) {
  const cfg = x402Config();
  return paymentRequired(
    cfg,
    new URL(req.url).toString(),
    `POST a trade proposal to this URL. ${cfg.priceUsdc} ${cfg.assetSymbol} per check. See /api/risk/check/info.`,
  );
}
