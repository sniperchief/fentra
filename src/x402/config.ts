/**
 * x402 configuration for the paid risk endpoint.
 *
 * Everything here is read from the environment and everything here is public:
 * a price, a network, a token address and the merchant receiving address. No
 * secret is exposed by this module. The facilitator API key, if one is set, is
 * read only inside `facilitator.ts` and never returned to a caller.
 *
 * The merchant address is deliberately its own variable. Fentra's Binance
 * trading credentials (BINANCE_API_KEY / BINANCE_API_SECRET) are never read
 * here, so the payment path and the execution path share no credential.
 *
 * Two protocol generations are supported, because they are not interchangeable
 * on the wire and the network decides which one you get:
 *
 *   v2 — BNB Chain via Binance's B402 facilitator. CAIP-2 network ids, a
 *        Permit2-based scheme and a top-level `resource` object. Live B402
 *        listings still name the price `maxAmountRequired`, so both that and
 *        the spec's `amount` are emitted.
 *   v1 — Base and Solana via third-party facilitators. Named networks, the
 *        EIP-3009 `exact` scheme, `maxAmountRequired`, and the resource
 *        described inside each `accepts` entry.
 *
 * Binance Agent OS supports all three chains, so which one Fentra advertises is
 * configuration rather than a rewrite.
 */

import type { PaymentRequirements, PaymentRequirementsV1, ResourceDescriptor } from "./types";

/** The x402 wire generation this deployment speaks. */
export type X402ProtocolVersion = 1 | 2;

/** One fixed price for the demo. Not tiered, not metered. */
const DEFAULT_PRICE_USDC = "0.01";

const DEFAULT_TIMEOUT_SECONDS = 120;

/**
 * Per-generation rail defaults.
 *
 * Setting `FENTRA_X402_PROTOCOL_VERSION` alone is enough to move between them;
 * every individual field remains overridable on top.
 */
const RAILS = {
  // BNB Chain mainnet. The `exact` scheme does not apply here; live B402
  // listings use `permit2-exact` and `eip3009`, and `permit2-exact` is the one
  // that works across all four supported stablecoins.
  //
  // Every BSC stablecoin in the Bazaar is 18-decimal, unlike 6-decimal USDC on
  // Ethereum, so 0.01 is 10000000000000000 atomic units -- which is also the
  // going rate real B402 endpoints charge.
  2: {
    network: "eip155:56",
    scheme: "permit2-exact",
    asset: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    assetDecimals: 18,
    networkLabel: "BNB Chain",
  },
  // Base Sepolia. The `exact` scheme is EIP-3009 `transferWithAuthorization`,
  // which the facilitator submits and pays gas for, so a payer needs USDC only
  // and no ETH. This is the generation live public facilitators actually serve.
  1: {
    network: "base-sepolia",
    scheme: "exact",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    assetDecimals: 6,
    networkLabel: "Base Sepolia",
  },
} as const;

/**
 * Stand-in merchant address used only when no real one is configured.
 *
 * The zero address cannot receive funds and cannot be mistaken for a live
 * merchant wallet, which is the point: DEMO MODE must never display an address
 * that looks like somewhere money actually went.
 */
export const DEMO_PAY_TO = "0x0000000000000000000000000000000000000000";

export type X402Mode = "live" | "demo";

export interface X402Config {
  /** "live" once a facilitator and a real merchant address are both set. */
  mode: X402Mode;
  /** Which x402 wire generation this deployment speaks. */
  protocolVersion: X402ProtocolVersion;
  /** Human-facing price, e.g. "0.01". */
  priceUsdc: string;
  /** Price in atomic token units, the form the protocol uses. */
  amountAtomic: string;
  network: string;
  /** Human-readable chain name, for the UI and the info endpoint. */
  networkLabel: string;
  scheme: string;
  asset: string;
  assetDecimals: number;
  assetSymbol: string;
  /** EIP-712 domain version of the token, needed by payers to sign. */
  assetVersion: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** Base URL of the x402 facilitator. Absent in demo mode. */
  facilitatorUrl?: string;
}

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

/**
 * Numeric environment override with a fallback.
 *
 * An unparseable value falls back rather than becoming NaN: NaN decimals make
 * `toAtomicUnits` throw, which would turn a typo in the deployment environment
 * into a 500 on every request to the paid endpoint.
 */
const envInt = (key: string, fallback: number, min: number, max: number): number => {
  const raw = env(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Converts a decimal price string to atomic units without floating point.
 *
 * "0.01" at 18 decimals is 10000000000000000, a value that cannot survive a
 * round trip through a JS number, so the conversion is done in BigInt.
 */
export function toAtomicUnits(price: string, decimals: number): string {
  const [whole = "0", fraction = ""] = price.trim().split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new Error(`Invalid price "${price}".`);
  }
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  const units = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
  return units.toString();
}

export function x402Config(): X402Config {
  const protocolVersion: X402ProtocolVersion =
    env("FENTRA_X402_PROTOCOL_VERSION") === "1" ? 1 : 2;
  const rails = RAILS[protocolVersion];

  const priceUsdc = env("FENTRA_X402_PRICE_USDC") ?? DEFAULT_PRICE_USDC;
  const assetDecimals = envInt("FENTRA_X402_ASSET_DECIMALS", rails.assetDecimals, 0, 36);
  const facilitatorUrl = env("FENTRA_X402_FACILITATOR_URL")?.replace(/\/+$/, "");
  const payTo = env("FENTRA_X402_PAY_TO");

  // Live mode needs somewhere to verify the payment and somewhere to send it.
  // Missing either one means the payment cannot be real, so the endpoint says
  // so rather than implying a settlement that is not happening.
  const mode: X402Mode = facilitatorUrl && payTo ? "live" : "demo";

  return {
    mode,
    protocolVersion,
    priceUsdc,
    amountAtomic: toAtomicUnits(priceUsdc, assetDecimals),
    network: env("FENTRA_X402_NETWORK") ?? rails.network,
    networkLabel: env("FENTRA_X402_NETWORK_LABEL") ?? rails.networkLabel,
    scheme: env("FENTRA_X402_SCHEME") ?? rails.scheme,
    asset: env("FENTRA_X402_ASSET") ?? rails.asset,
    assetDecimals,
    assetSymbol: env("FENTRA_X402_ASSET_SYMBOL") ?? "USDC",
    assetVersion: env("FENTRA_X402_ASSET_VERSION") ?? "2",
    payTo: payTo ?? DEMO_PAY_TO,
    maxTimeoutSeconds: envInt("FENTRA_X402_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, 1, 3600),
    facilitatorUrl,
  };
}

/**
 * Scheme-specific `extra`.
 *
 * For the EIP-3009 `exact` scheme this carries the token's EIP-712 domain,
 * which a payer needs in order to produce a signature the facilitator will
 * accept. Omitting it would leave clients guessing.
 */
function extraFor(cfg: X402Config): Record<string, unknown> {
  const demoCaveat =
    cfg.mode === "demo"
      ? {
          mode: "demo",
          note:
            "DEMO MODE. No facilitator is configured, so a payment presented here is " +
            "structurally checked and then simulated. It is not verified on-chain and no " +
            "funds move. payTo is the zero address, not a live merchant wallet.",
        }
      : { mode: "live" };

  return {
    name: cfg.assetSymbol,
    version: cfg.assetVersion,
    decimals: cfg.assetDecimals,
    humanAmount: `${cfg.priceUsdc} ${cfg.assetSymbol}`,
    ...demoCaveat,
  };
}

/** The single v2 `accepts` entry. */
export function paymentRequirements(cfg: X402Config): PaymentRequirements {
  return {
    scheme: cfg.scheme,
    network: cfg.network,
    amount: cfg.amountAtomic,
    // Binance B402 publishes the price under the v1 name even on v2 listings.
    maxAmountRequired: cfg.amountAtomic,
    asset: cfg.asset,
    payTo: cfg.payTo,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds,
    extra: extraFor(cfg),
  };
}

/**
 * The single v1 `accepts` entry.
 *
 * v1 names the price `maxAmountRequired` and carries the resource, description
 * and mimeType inside the entry rather than beside it.
 */
export function paymentRequirementsV1(cfg: X402Config, resourceUrl: string): PaymentRequirementsV1 {
  return {
    scheme: cfg.scheme,
    network: cfg.network,
    maxAmountRequired: cfg.amountAtomic,
    resource: resourceUrl,
    description: RESOURCE_DESCRIPTION,
    mimeType: "application/json",
    payTo: cfg.payTo,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds,
    asset: cfg.asset,
    extra: extraFor(cfg),
  };
}

const RESOURCE_DESCRIPTION =
  "One deterministic Fentra risk verdict (ALLOW / BLOCK / HALT) for a proposed trade.";

export function resourceDescriptor(url: string): ResourceDescriptor {
  return { url, description: RESOURCE_DESCRIPTION, mimeType: "application/json" };
}
