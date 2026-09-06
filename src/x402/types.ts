/**
 * x402 protocol types, transcribed from the specification.
 *
 * Nothing here is Fentra's invention. Field names and shapes come from the
 * x402 spec (`specs/x402-specification-v1.md`, `specs/x402-specification-v2.md`
 * and the HTTP transport docs). They are reproduced rather than simplified so
 * an off-the-shelf x402 client can talk to this server unmodified.
 *
 * See README "Public risk API (x402)" for the research notes behind this file.
 */

/** One acceptable way to pay. v2 field names. */
export interface PaymentRequirements {
  /** Payment scheme identifier, e.g. "permit2-exact" on BNB Chain. */
  scheme: string;
  /** CAIP-2 network id, e.g. "eip155:56" for BNB Chain mainnet. */
  network: string;
  /** Price in atomic token units, as a decimal string. The written v2 name. */
  amount: string;
  /**
   * The same price under the v1 name.
   *
   * Every live Binance B402 listing publishes `maxAmountRequired` even at
   * `x402Version: 2`, so both are emitted and a client reading either finds the
   * same value. Verified against the B402 Bazaar, not assumed.
   */
  maxAmountRequired: string;
  /** Token contract address, or an ISO 4217 code for fiat. */
  asset: string;
  /** Merchant receiving address. */
  payTo: string;
  maxTimeoutSeconds: number;
  /** Scheme-specific data. */
  extra?: Record<string, unknown>;
}

/**
 * One acceptable way to pay, v1 field names.
 *
 * v1 names the price `maxAmountRequired` and carries the resource description
 * inside the entry. This is the generation live public facilitators serve for
 * Base and Solana, so it is not legacy: it is the one that settles today.
 */
export interface PaymentRequirementsV1 {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: Record<string, unknown> | null;
  extra?: Record<string, unknown>;
}

/** What is being paid for. v2 only. */
export interface ResourceDescriptor {
  url: string;
  description?: string;
  mimeType?: string;
}

/** The body of an HTTP 402 response. */
export interface PaymentRequiredResponse {
  x402Version: number;
  error?: string;
  resource: ResourceDescriptor;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

/**
 * The decoded payment header.
 *
 * v2 nests the chosen requirements under `accepted`; v1 carries `scheme` and
 * `network` at the top level. Both are accepted, so the optional fields here
 * are a union of the two versions rather than a loosened v2.
 */
export interface PaymentPayload {
  x402Version: number;
  /** v1 only. */
  scheme?: string;
  /** v1 only. */
  network?: string;
  /** v2 only. */
  resource?: ResourceDescriptor;
  /** v2 only: the requirements the payer chose to satisfy. */
  accepted?: Partial<PaymentRequirements>;
  /** Signature and authorization. Scheme-specific. */
  payload?: {
    signature?: string;
    authorization?: Record<string, unknown>;
    [key: string]: unknown;
  };
  extensions?: Record<string, unknown>;
}

/** Facilitator POST /verify response. */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

/** Facilitator POST /settle response. Settlement is not performed by Fentra. */
export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction?: string;
  network?: string;
}

/** The body of an HTTP 402 response under v1. */
export interface PaymentRequiredResponseV1 {
  x402Version: 1;
  error?: string;
  accepts: PaymentRequirementsV1[];
}

/** Facilitator request body, shared by /verify and /settle. */
export interface FacilitatorRequest {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements | PaymentRequirementsV1;
}
