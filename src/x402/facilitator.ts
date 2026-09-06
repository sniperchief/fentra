/**
 * Payment verification for the paid risk endpoint.
 *
 * Fentra does not verify payments itself. There is no signature recovery, no
 * RPC call and no chain reading in this file: that is the facilitator's job
 * under x402, and reimplementing it would be both wrong and less safe. In LIVE
 * mode this module decodes the payment header and POSTs it to the facilitator's
 * documented `/verify` endpoint. In DEMO MODE it performs the structural
 * checks it can do honestly and then reports the result as *simulated*.
 *
 * Settlement is out of scope. `/verify` proves the payment authorization is
 * valid; it does not move funds. See the README for why `/settle` is not called.
 */

import { paymentRequirements, paymentRequirementsV1, type X402Config } from "./config";
import type { FacilitatorRequest, PaymentPayload, VerifyResponse } from "./types";

/**
 * Documented x402 payment header names.
 *
 * The v1 HTTP transport uses `X-PAYMENT`; the v2 transport renamed it to
 * `PAYMENT-SIGNATURE`. Both are read so either generation of client works.
 * Neither name is Fentra's invention.
 */
export const PAYMENT_HEADERS = ["payment-signature", "x-payment"] as const;

export interface VerifiedPayment {
  /** "verified" only ever means a facilitator said so. */
  status: "verified" | "simulated";
  mode: "live" | "demo";
  network: string;
  asset: string;
  /** Atomic units required for this call. */
  amount: string;
  scheme: string;
  /** Present only when a facilitator identified the payer. */
  payer?: string;
  /**
   * Always false. Fentra verifies the payment authorization but does not call
   * the facilitator's /settle endpoint, so no transfer is broadcast here.
   */
  settled: false;
  /** Present in demo mode. Says plainly that no money moved. */
  note?: string;
}

export type PaymentOutcome =
  | { ok: true; payment: VerifiedPayment }
  | { ok: false; reason: string };

/** Reads the payment header under either of its documented names. */
export function readPaymentHeader(headers: Headers): string | null {
  for (const name of PAYMENT_HEADERS) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  return null;
}

/** Decodes the base64 JSON payment header. Returns null if it is not one. */
export function decodePaymentHeader(header: string): PaymentPayload | null {
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as PaymentPayload;
  } catch {
    return null;
  }
}

/**
 * Checks the payload describes the payment this endpoint asked for.
 *
 * This is not a substitute for verification — it proves nothing about funds —
 * but it lets a malformed or mismatched payload be rejected with a 402 before
 * a facilitator round trip, and it is the only honest check available in demo
 * mode. Returns an error string, or null when the payload is well formed.
 */
export function structuralMismatch(payload: PaymentPayload, cfg: X402Config): string | null {
  if (payload.x402Version !== 1 && payload.x402Version !== 2) {
    return `Unsupported x402Version ${String(payload.x402Version)}. This resource speaks v1 and v2.`;
  }
  if (!payload.payload || typeof payload.payload !== "object") {
    return "Payment payload is missing its `payload` object.";
  }
  if (typeof payload.payload.signature !== "string" || payload.payload.signature.length === 0) {
    return "Payment payload is missing a signature.";
  }

  // v2 carries the chosen requirements under `accepted`; v1 puts scheme and
  // network at the top level.
  const scheme = payload.accepted?.scheme ?? payload.scheme;
  const network = payload.accepted?.network ?? payload.network;

  if (scheme !== cfg.scheme) {
    return `Scheme "${String(scheme)}" does not match the required "${cfg.scheme}".`;
  }
  if (network !== cfg.network) {
    return `Network "${String(network)}" does not match the required "${cfg.network}".`;
  }

  // Only present on v2 payloads, so absence is not an error. The price is read
  // under either spelling, because live B402 listings use the v1 name on v2.
  //
  // These fields arrive as attacker-controlled JSON, so each one is type-checked
  // before it is used. A number where a string belongs must be a 402, not an
  // unhandled TypeError on a public endpoint.
  const { payTo, asset } = payload.accepted ?? {};
  const amount = payload.accepted?.amount ?? payload.accepted?.maxAmountRequired;
  if (payTo !== undefined) {
    if (typeof payTo !== "string") return "Payment `payTo` must be an address string.";
    if (payTo.toLowerCase() !== cfg.payTo.toLowerCase()) {
      return `Payment is addressed to ${payTo}, not to this resource's payTo address.`;
    }
  }
  if (asset !== undefined) {
    if (typeof asset !== "string") return "Payment `asset` must be a contract address string.";
    if (asset.toLowerCase() !== cfg.asset.toLowerCase()) {
      return `Asset ${asset} is not the required ${cfg.assetSymbol} contract.`;
    }
  }
  if (amount !== undefined) {
    if (typeof amount !== "string" && typeof amount !== "number") {
      return "Payment amount must be an integer in atomic units.";
    }
    let paid: bigint;
    try {
      paid = BigInt(amount);
    } catch {
      return `Amount "${String(amount)}" is not an integer in atomic units.`;
    }
    if (paid < BigInt(cfg.amountAtomic)) {
      return `Amount ${String(amount)} is below the required ${cfg.amountAtomic} atomic units.`;
    }
  }
  return null;
}

/**
 * Verifies a payment header.
 *
 * Callers must treat a non-ok outcome as "no payment": the risk engine is not
 * to be reached on that path.
 */
export async function verifyPayment(
  header: string | null,
  cfg: X402Config,
  resourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentOutcome> {
  if (!header) return { ok: false, reason: "No x402 payment header was supplied." };

  const payload = decodePaymentHeader(header);
  if (!payload) {
    return { ok: false, reason: "Payment header is not base64-encoded JSON." };
  }

  const mismatch = structuralMismatch(payload, cfg);
  if (mismatch) return { ok: false, reason: mismatch };

  const base = {
    network: cfg.network,
    asset: cfg.asset,
    amount: cfg.amountAtomic,
    scheme: cfg.scheme,
    settled: false as const,
  };

  if (cfg.mode === "demo") {
    return {
      ok: true,
      payment: {
        ...base,
        status: "simulated",
        mode: "demo",
        note:
          "DEMO MODE. The payment header was checked for shape only. It was not verified by " +
          "an x402 facilitator, nothing was settled on-chain, and no USDC was transferred.",
      },
    };
  }

  const result = await callFacilitatorVerify(payload, cfg, resourceUrl, fetchImpl);
  if (!result.isValid) {
    return { ok: false, reason: result.invalidReason ?? "The facilitator rejected the payment." };
  }

  return {
    ok: true,
    payment: { ...base, status: "verified", mode: "live", payer: result.payer },
  };
}

/**
 * POSTs to the facilitator's `/verify` endpoint.
 *
 * Request and response shapes are the spec's:
 * `{ x402Version, paymentPayload, paymentRequirements }` in,
 * `{ isValid, invalidReason?, payer? }` out.
 *
 * A network failure or a malformed reply is reported as invalid. Failing open
 * would hand out paid verdicts for free, so the failure direction is fixed.
 */
async function callFacilitatorVerify(
  paymentPayload: PaymentPayload,
  cfg: X402Config,
  resourceUrl: string,
  fetchImpl: typeof fetch,
): Promise<VerifyResponse> {
  // The requirements must be sent in the same generation the payer used, or the
  // facilitator cannot match the payload against them.
  const body: FacilitatorRequest = {
    x402Version: cfg.protocolVersion,
    paymentPayload,
    paymentRequirements:
      cfg.protocolVersion === 1 ? paymentRequirementsV1(cfg, resourceUrl) : paymentRequirements(cfg),
  };

  // Read here and nowhere else, so the key cannot reach a response body.
  const apiKey = process.env.FENTRA_X402_FACILITATOR_API_KEY?.trim();

  try {
    const res = await fetchImpl(`${cfg.facilitatorUrl}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.maxTimeoutSeconds * 1000),
    });

    if (!res.ok) {
      return { isValid: false, invalidReason: `Facilitator returned HTTP ${res.status}.` };
    }
    const json = (await res.json()) as VerifyResponse;
    if (typeof json?.isValid !== "boolean") {
      return { isValid: false, invalidReason: "Facilitator returned an unrecognised response." };
    }
    return json;
  } catch {
    return { isValid: false, invalidReason: "The x402 facilitator could not be reached." };
  }
}
