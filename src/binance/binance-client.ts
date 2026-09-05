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
  base = PUBLIC_SPOT_BASE,
): Promise<T> {
  const qs = toQuery(params);
  const url = `${base}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
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

  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": creds.apiKey, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
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
