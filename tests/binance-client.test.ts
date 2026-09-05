/**
 * Signing tests for the live Binance path.
 *
 * These validate the authentication code without credentials, so the live
 * executor is provably correct even when the demo runs in Demo Mode. The first
 * test uses the key/secret/signature triple published in the Binance REST
 * documentation as its worked example.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PRODUCTION_FUTURES_BASE,
  TESTNET_FUTURES_BASE,
  buildSignedQuery,
  loadCredentials,
} from "@/binance/binance-client";

describe("request signing", () => {
  it("matches the signature published in the Binance documentation", () => {
    // Documented example: SIGNED endpoint, HMAC SHA256, query string.
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const signed = buildSignedQuery(secret, {
      symbol: "LTCBTC",
      side: "BUY",
      type: "LIMIT",
      timeInForce: "GTC",
      quantity: 1,
      price: 0.1,
      recvWindow: 5000,
      timestamp: 1499827319559,
    });

    expect(signed).toBe(
      "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1" +
        "&recvWindow=5000&timestamp=1499827319559" +
        "&signature=c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71",
    );
  });

  it("signs the exact string it sends, so params and signature cannot drift", () => {
    const signed = buildSignedQuery("secret", { symbol: "BTCUSDT", timestamp: 1 });
    const [query, signature] = signed.split("&signature=");
    expect(query).toBe("symbol=BTCUSDT&timestamp=1");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("omits undefined and empty params rather than signing blanks", () => {
    const signed = buildSignedQuery("secret", {
      symbol: "BTCUSDT",
      price: undefined,
      timeInForce: "",
      timestamp: 1,
    });
    expect(signed.split("&signature=")[0]).toBe("symbol=BTCUSDT&timestamp=1");
  });

  it("produces a different signature for a different secret", () => {
    const params = { symbol: "BTCUSDT", timestamp: 1 };
    expect(buildSignedQuery("a", params)).not.toBe(buildSignedQuery("b", params));
  });
});

describe("credential loading", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;
    delete process.env.BINANCE_TESTNET;
    delete process.env.BINANCE_FUTURES_BASE;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns null with no credentials, which is what selects Demo Mode", () => {
    expect(loadCredentials()).toBeNull();
  });

  it("returns null when only one half of the pair is set", () => {
    process.env.BINANCE_API_KEY = "key";
    expect(loadCredentials()).toBeNull();
  });

  it("defaults to the testnet host, never to live", () => {
    process.env.BINANCE_API_KEY = "key";
    process.env.BINANCE_API_SECRET = "secret";
    const creds = loadCredentials();
    expect(creds?.testnet).toBe(true);
    expect(creds?.futuresBase).toBe(TESTNET_FUTURES_BASE);
  });

  it("requires an explicit opt-out to reach the live host", () => {
    process.env.BINANCE_API_KEY = "key";
    process.env.BINANCE_API_SECRET = "secret";
    process.env.BINANCE_TESTNET = "false";
    const creds = loadCredentials();
    expect(creds?.testnet).toBe(false);
    expect(creds?.futuresBase).toBe(PRODUCTION_FUTURES_BASE);
  });

  it("treats any value other than 'false' as testnet", () => {
    process.env.BINANCE_API_KEY = "key";
    process.env.BINANCE_API_SECRET = "secret";
    process.env.BINANCE_TESTNET = "no";
    expect(loadCredentials()?.testnet).toBe(true);
  });

  it("honours a host override, since Binance has moved the testnet before", () => {
    process.env.BINANCE_API_KEY = "key";
    process.env.BINANCE_API_SECRET = "secret";
    process.env.BINANCE_FUTURES_BASE = "https://testnet.binancefuture.com";
    expect(loadCredentials()?.futuresBase).toBe("https://testnet.binancefuture.com");
  });
});
