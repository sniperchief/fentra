/**
 * Public risk-verdict endpoint.
 *
 * Lets another AI agent submit a proposed trade and receive the same
 * deterministic ALLOW / BLOCK / HALT verdict Fentra applies to its own
 * agent. Read-only: it never executes, never touches history.
 *
 * x402 (stretch feature): when FENTRA_X402_PRICE_USDC is set, the endpoint
 * answers unpaid requests with HTTP 402 and a payment-requirements body in the
 * x402 shape. Payment verification requires a facilitator, which is not wired
 * up here, so with the price set the endpoint gates rather than settles. It is
 * off by default and never reports a payment as received.
 */

import { NextResponse } from "next/server";
import { getControlPlane } from "@/server/session";
import { coerceProposal } from "@/agent/tools";
import { applyPolicyPatch } from "@/policy/policy-store";
import type { RiskPolicy } from "@/risk/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const price = process.env.FENTRA_X402_PRICE_USDC?.trim();

  if (price && !req.headers.get("x-payment")) {
    return NextResponse.json(
      {
        x402Version: 1,
        error: "Payment required.",
        accepts: [
          {
            scheme: "exact",
            network: process.env.FENTRA_X402_NETWORK ?? "base-sepolia",
            maxAmountRequired: price,
            asset: "USDC",
            payTo: process.env.FENTRA_X402_PAY_TO ?? null,
            resource: "/api/risk/check",
            description: "Deterministic Fentra risk verdict for one proposed trade.",
          },
        ],
      },
      { status: 402 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    trade?: Record<string, unknown>;
    policy?: Partial<RiskPolicy>;
  } | null;

  if (!body?.trade) {
    return NextResponse.json({ error: "Body must include a `trade` object." }, { status: 400 });
  }

  const cp = getControlPlane();
  const policy = body.policy ? applyPolicyPatch(cp.policy, body.policy) : undefined;
  const evaluation = await cp.evaluateOnly(coerceProposal(body.trade), policy);

  return NextResponse.json({
    decision: evaluation.decision,
    reasons: evaluation.reasons,
    checks: evaluation.checks,
    metrics: evaluation.metrics,
    policy: evaluation.policySnapshot,
    // Stated explicitly so a calling agent cannot mistake this for a fill.
    executed: false,
    note: "Advisory verdict only. No order was placed.",
  });
}
