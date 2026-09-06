/**
 * Thin Binance REST client.
 *
 * Public market data needs no credentials. Signed endpoints follow the
 * documented scheme: the API key travels in the `X-MBX-APIKEY` header and the
 * query string is signed with HMAC SHA-256 over the raw parameter string, with
 * `timestamp` and `recvWindow` included.
 *
 * Runs server-side only. The secret is read from the environment and is never
 * serialised into any API response.
 */

import crypto from "node:crypto";

export const PUBLIC_SPOT_BASE = "https://api.binance.com";

/**
 * Public market-data host, overridable with BINANCE_PUBLIC_BASE.
 *
 * Binance serves the same unauthenticated `/api/v3/*` endpoints from several
 * hosts, and which of them a given network can reach is not something the
 * application gets to decide: some ISPs resolve `binance.com` and not
 * `binance.vision`, some the other way round. Since a live order cannot be
 * sized without a live quote, an unreachable quote host stops trading
 * altogether — so the host is configuration, not a constant.
 *
 * Read per call rather than at import, so the process environment is what
 * decides rather than module load order.
 */
export function publicBase(): string {
  return process.env.BINANCE_PUBLIC_BASE?.trim() || PUBLIC_SPOT_BASE;
}

/**
 * USDⓈ-M futures hosts, per the current Binance derivatives documentation.
 * The testnet moved from `testnet.binancefuture.com` to `demo-fapi.binance.com`;
 * the old host still answers, but the documented one is authoritative here.
 */
export const PRODUCTION_FUTURES_BASE = "https://fapi.binance.com";
export const TESTNET_FUTURES_BASE = "https://demo-fapi.binance.com";

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
  /** USDⓈ-M futures base URL. Testnet by default. */
  futuresBase: string;
  testnet: boolean;
}

export class BinanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "BinanceApiError";
  }
}

/**
 * Turns a transport failure into something an operator can act on.
 *
 * `fetch` reports every network problem as the bare string "fetch failed" and
 * hides the reason on `cause`. A blocked DNS entry, a refused connection and a
 * timeout then look identical in the UI, which is useless when the fix is to
 * point at a different host. The host is named; the query string never is,
 * because it carries the request signature.
 */
function transportError(err: unknown, base: string, path: string): BinanceApiError {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  const reason = cause?.code ?? cause?.message ?? (err as Error)?.message ?? "unknown error";
  const hint =
    reason === "ENOTFOUND" || reason === "EAI_AGAIN"
      ? ". The host did not resolve; set BINANCE_FUTURES_BASE / BINANCE_PUBLIC_BASE to a host this network can reach."
      : "";
  return new BinanceApiError(`Could not reach ${base}${path}: ${reason}${hint}`, 0);
}

function toQuery(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
}

/** Public, unauthenticated market data. Safe to call in demo mode. */
export async function publicGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  base = publicBase(),
): Promise<T> {
  const qs = toQuery(params);
  const url = `${base}${path}${qs ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw transportError(err, base, path);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new BinanceApiError(
      (body as { msg?: string })?.msg ?? `Binance public request failed (${res.status})`,
      res.status,
      (body as { code?: number })?.code,
    );
  }
  return body as T;
}

/**
 * Builds the signed query string for an authenticated endpoint.
 *
 * The signature is HMAC SHA-256 over the exact query string that gets sent, so
 * the string is built once and reused verbatim rather than being regenerated
 * from the params, which is the usual source of -1022 signature errors.
 *
 * Exported so the signing can be tested against Binance's documented vector
 * without live credentials.
 */
export function buildSignedQuery(
  apiSecret: string,
  params: Record<string, string | number | undefined>,
): string {
  const query = toQuery(params);
  const signature = crypto.createHmac("sha256", apiSecret).update(query).digest("hex");
  return `${query}&signature=${signature}`;
}

/** Signed request against an authenticated endpoint. */
export async function signedRequest<T>(
  creds: BinanceCredentials,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const signed = buildSignedQuery(creds.apiSecret, {
    ...params,
    recvWindow: 5000,
    timestamp: Date.now(),
  });
  const url = `${creds.futuresBase}${path}?${signed}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "X-MBX-APIKEY": creds.apiKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    // Never let the raw error escape: the URL it may carry contains the
    // request signature.
    throw transportError(err, creds.futuresBase, path);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new BinanceApiError(
      (body as { msg?: string })?.msg ?? `Binance request failed (${res.status})`,
      res.status,
      (body as { code?: number })?.code,
    );
  }
  return body as T;
}

/**
 * Reads credentials from the environment. Returns null when unset, which is
 * what puts the application into demo mode rather than guessing at auth.
 */
export function loadCredentials(): BinanceCredentials | null {
  const apiKey = process.env.BINANCE_API_KEY?.trim();
  const apiSecret = process.env.BINANCE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;

  const testnet = process.env.BINANCE_TESTNET !== "false";
  const defaultBase = testnet ? TESTNET_FUTURES_BASE : PRODUCTION_FUTURES_BASE;

  return {
    apiKey,
    apiSecret,
    testnet,
    // Overridable, because Binance has moved the testnet host before.
    futuresBase: process.env.BINANCE_FUTURES_BASE?.trim() || defaultBase,
  };
}
