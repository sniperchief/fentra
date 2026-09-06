/**
 * GET /api/x402/log
 *
 * The external paid-check log for the dashboard panel.
 *
 * Deliberately separate from `/api/state`. That endpoint calls Binance for
 * account, positions and quotes, so it fails whenever the venue is unreachable
 * or the local clock drifts out of the signature window — and a payment log has
 * no business disappearing because an exchange timed out. This route reads
 * process memory and nothing else, so it answers even when Binance does not.
 */

import { NextResponse } from "next/server";
import { x402Summary } from "@/x402/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(x402Summary());
}
