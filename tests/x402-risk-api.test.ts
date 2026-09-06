/**
 * Tests for the paid x402 risk API.
 *
 * Three things are proved here.
 *
 * First, that payment gates the endpoint: no header, a malformed header, a
 * header for the wrong network or an underpaying header all return 402, and on
 * every one of those paths the risk engine is never entered.
 *
 * Second, that the endpoint is a wrapper and not a second risk system. The real
 * `evaluateTrade` from `@/risk/risk-engine` is wrapped rather than replaced, so
 * the assertions below are on the genuine implementation being called — and the
 * call order proves payment is settled before it runs.
 *
 * Third, that this endpoint cannot trade. The executor behind it throws on
 * `executeTrade`, so any path that reached execution would fail loudly.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPlane, type ControlPlaneState } from "@/server/control-plane";
import { DEFAULT_POLICY } from "@/policy/policy-store";
import { clearX402Ledger, x402Summary } from "@/x402/ledger";
import { toAtomicUnits } from "@/x402/config";
import { TOOL_DEFS } from "@/agent/tools";
import type { ApprovedTrade, ExecutionResult, TradingExecutor } from "@/binance/types";
import type { AccountState, MarketState, Position } from "@/risk/types";

/* ------------------------------------------------------------------ *
 * Hoisted test doubles. `vi.mock` factories run before the module body,
 * so anything they close over has to be created by `vi.hoisted`.
 * ------------------------------------------------------------------ */

const h = vi.hoisted(() => ({
  /** Records the sequence of interesting events, to assert ordering. */
  calls: [] as string[],
  controlPlane: null as unknown,
}));

vi.mock("@/server/session", () => ({
  getControlPlane: () => h.controlPlane,
}));

// The real engine is delegated to, not replaced: the verdicts asserted below
// are produced by the same `evaluateTrade` the core product uses.
vi.mock("@/risk/risk-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/risk/risk-engine")>();
  return {
    ...actual,
    evaluateTrade: (input: Parameters<typeof actual.evaluateTrade>[0]) => {
      h.calls.push("evaluateTrade");
      return actual.evaluateTrade(input);
    },
  };
});

const { POST, GET } = await import("@/app/api/risk/check/route");
const { GET: INFO } = await import("@/app/api/risk/check/info/route");

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** Fails the test if the endpoint ever reaches execution. */
class NoExecuteExecutor implements TradingExecutor {
  readonly venue = "DEMO" as const;
  executeTrade = vi.fn(async (_t: ApprovedTrade): Promise<ExecutionResult> => {
    throw new Error("The x402 risk API must never reach the executor.");
  });

  constructor(
    private account: AccountState,
    private positions: Position[] = [],
  ) {}

  async describeConnection() {
    return { connected: false, label: "Spy", detail: "test double" };
  }
  async getAccountState() {
    return this.account;
  }
  async getPositions() {
    return this.positions;
  }
  async getMarketData(symbol: string): Promise<MarketState> {
    return {
      symbol,
      price: 68000,
      priceChangePercent: 0,
      source: "SYNTHETIC",
      venueMaxLeverage: 125,
      fetchedAt: 0,
    };
  }
}

const healthyAccount: AccountState = {
  equity: 10000,
  availableBalance: 9000,
  peakEquityToday: 10000,
  startOfDayEquity: 10000,
  tradingHalted: false,
};

let executor: NoExecuteExecutor;

function useAccount(account: AccountState, positions: Position[] = []) {
  executor = new NoExecuteExecutor(account, positions);
  const state: ControlPlaneState = {
    policy: { ...DEFAULT_POLICY },
    history: [],
    halted: false,
    peakEquityToday: account.peakEquityToday,
  };
  h.controlPlane = new ControlPlane(state, executor, ["BTCUSDT"]);
}

const PAY_TO = "0x1111111111111111111111111111111111111111";
const USDC_BSC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
/** $0.01 at 18 decimals. */
const PRICE_ATOMIC = "10000000000000000";

/** Builds a base64 x402 v2 payment header. */
function paymentHeader(
  accepted: Record<string, unknown> = {},
  root: Record<string, unknown> = {},
): string {
  const payload = {
    x402Version: 2,
    resource: { url: "http://localhost/api/risk/check" },
    accepted: {
      scheme: "permit2-exact",
      network: "eip155:56",
      amount: PRICE_ATOMIC,
      asset: USDC_BSC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 120,
      ...accepted,
    },
    payload: {
      signature: "0xdeadbeef",
      authorization: { from: "0xpayer", to: PAY_TO, value: PRICE_ATOMIC },
    },
    ...root,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

const TRADE = { symbol: "BTCUSDT", side: "BUY", type: "MARKET", notional: 1000, leverage: 3 };

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/risk/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** Demo mode: no facilitator configured, so payTo is the zero address. */
function demoMode() {
  vi.stubEnv("FENTRA_X402_FACILITATOR_URL", "");
  vi.stubEnv("FENTRA_X402_PAY_TO", "");
}

function liveMode() {
  vi.stubEnv("FENTRA_X402_FACILITATOR_URL", "https://facilitator.example/v2/x402");
  vi.stubEnv("FENTRA_X402_PAY_TO", PAY_TO);
}

const ZERO = "0x0000000000000000000000000000000000000000";

beforeEach(() => {
  h.calls.length = 0;
  clearX402Ledger();
  useAccount(healthyAccount);
  demoMode();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ *
 * The payment gate
 * ------------------------------------------------------------------ */

describe("payment gate", () => {
  it("returns 402 with x402 payment requirements when no payment is supplied", async () => {
    const res = await post(TRADE);
    expect(res.status).toBe(402);

    const body = await res.json();
    expect(body.x402Version).toBe(2);
    expect(typeof body.error).toBe("string");
    expect(body.resource.url).toContain("/api/risk/check");

    // The exact PaymentRequirements shape from the x402 specification.
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]).toMatchObject({
      scheme: "permit2-exact",
      network: "eip155:56",
      amount: PRICE_ATOMIC,
      asset: USDC_BSC,
      payTo: ZERO,
    });
    expect(typeof body.accepts[0].maxTimeoutSeconds).toBe("number");
  });

  it("does not run the risk engine when payment is missing", async () => {
    await post(TRADE);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("rejects a payment header that is not base64 JSON", async () => {
    const res = await post(TRADE, { "X-PAYMENT": "not-a-real-payment" });
    expect(res.status).toBe(402);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("rejects a payment for the wrong network", async () => {
    const res = await post(TRADE, {
      "PAYMENT-SIGNATURE": paymentHeader({ network: "eip155:8453", payTo: ZERO }),
    });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/network/i);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("rejects a payment for the wrong scheme", async () => {
    const res = await post(TRADE, {
      "PAYMENT-SIGNATURE": paymentHeader({ scheme: "exact", payTo: ZERO }),
    });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/scheme/i);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("rejects a payment below the asking price", async () => {
    const res = await post(TRADE, {
      "PAYMENT-SIGNATURE": paymentHeader({ amount: "1", payTo: ZERO }),
    });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/below the required/i);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("rejects a payment addressed to someone else", async () => {
    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: PAY_TO }) });
    expect(res.status).toBe(402);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("rejects a payload with no signature", async () => {
    const header = paymentHeader({ payTo: ZERO }, { payload: { authorization: {} } });
    const res = await post(TRADE, { "PAYMENT-SIGNATURE": header });
    expect(res.status).toBe(402);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("answers a bare GET with the price rather than a verdict", async () => {
    const res = await GET(new Request("http://localhost/api/risk/check"));
    expect(res.status).toBe(402);
    expect((await res.json()).accepts[0].amount).toBe(PRICE_ATOMIC);
  });
});

/* ------------------------------------------------------------------ *
 * Paid checks
 * ------------------------------------------------------------------ */

describe("paid risk check", () => {
  it("returns the risk verdict once payment is accepted", async () => {
    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.decision).toBe("ALLOW");
    expect(body.reasons.length).toBeGreaterThan(0);
    expect(body.checks).toHaveLength(5);
    expect(body.metrics.currentEquity).toBe(10000);
  });

  it("returns the same verdict the core risk engine produces", async () => {
    // 4x the per-symbol cap: the engine blocks this, and so must the API.
    const res = await post(
      { ...TRADE, notional: 8000 },
      { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) },
    );
    const body = await res.json();
    expect(body.decision).toBe("BLOCK");
    expect(body.reasons.join(" ")).toMatch(/position size|order notional/i);
  });

  it("returns HALT when the circuit breaker has tripped", async () => {
    useAccount({ ...healthyAccount, equity: 9000, peakEquityToday: 10000 });
    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });
    expect((await res.json()).decision).toBe("HALT");
  });

  it("uses the real evaluateTrade rather than duplicated risk logic", async () => {
    await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });
    expect(h.calls.filter((c) => c === "evaluateTrade")).toHaveLength(1);
  });

  it("accepts a proposal wrapped as { trade }, for the original API shape", async () => {
    const res = await post(
      { trade: TRADE },
      { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).decision).toBe("ALLOW");
  });

  it("rejects a body with no proposal in it, without charging for a verdict", async () => {
    const res = await post({}, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });
    expect(res.status).toBe(400);
    expect(h.calls).not.toContain("evaluateTrade");
  });
});

/* ------------------------------------------------------------------ *
 * The endpoint cannot trade
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Hostile payment payloads
 *
 * The header is attacker-controlled JSON typed only by an interface, so a
 * field of the wrong type used to reach `.toLowerCase()` and throw — turning a
 * malformed request on a public endpoint into a 500. Every one of these must
 * be a 402 and must leave the risk engine unentered.
 * ------------------------------------------------------------------ */

describe("malformed payment payloads", () => {
  const cases: Array<[string, string]> = [
    ["a numeric payTo", paymentHeader({ payTo: 12345 as unknown as string })],
    ["an object asset", paymentHeader({ asset: { evil: true } as unknown as string })],
    ["an object amount", paymentHeader({ amount: { evil: true } as unknown as string })],
    ["a non-integer amount", paymentHeader({ amount: "1e30" })],
    ["a null accepted block", paymentHeader({}, { accepted: null })],
    ["an array payload", paymentHeader({}, { payload: ["x"] })],
    ["a string x402Version", paymentHeader({}, { x402Version: "2" })],
    ["no payload at all", Buffer.from(JSON.stringify({ x402Version: 2 })).toString("base64")],
    ["base64 that is not JSON", Buffer.from("not json at all").toString("base64")],
    ["a header that is not base64", "%%%not-base64%%%"],
  ];

  for (const [label, header] of cases) {
    it(`answers 402 rather than throwing for ${label}`, async () => {
      const res = await post(TRADE, { "X-PAYMENT": header });
      expect(res.status).toBe(402);
      expect(h.calls).not.toContain("evaluateTrade");
      expect(executor.executeTrade).not.toHaveBeenCalled();
    });
  }
});

describe("read-only guarantee", () => {
  const inputs = [
    { label: "an allowed trade", body: TRADE },
    { label: "a blocked trade", body: { ...TRADE, notional: 9000 } },
    { label: "an over-leveraged trade", body: { ...TRADE, leverage: 50 } },
    { label: "a sell", body: { ...TRADE, side: "SELL" } },
    { label: "a limit order", body: { ...TRADE, type: "LIMIT", price: 68000 } },
    { label: "a spot trade", body: { ...TRADE, market: "SPOT" } },
    { label: "a nonsense trade", body: { ...TRADE, notional: -1, leverage: 0 } },
    { label: "an unknown symbol", body: { ...TRADE, symbol: "DOGEUSDT" } },
  ];

  for (const { label, body } of inputs) {
    it(`never calls executeTrade for ${label}`, async () => {
      await post(body, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });
      expect(executor.executeTrade).not.toHaveBeenCalled();
    });
  }

  it("reports executed:false on every successful verdict", async () => {
    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });
    const body = await res.json();
    expect(body.executed).toBe(false);
    expect(body.note).toMatch(/cannot place an order/i);
  });

  it("leaves the control plane history untouched", async () => {
    await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });
    expect((h.controlPlane as ControlPlane).history).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Demo mode honesty
 * ------------------------------------------------------------------ */

describe("demo mode", () => {
  it("labels the payment as simulated, never as verified", async () => {
    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });
    const body = await res.json();
    expect(body.payment.status).toBe("simulated");
    expect(body.payment.mode).toBe("demo");
    expect(body.payment.status).not.toBe("verified");
  });

  it("states plainly that no funds moved, and invents no transaction", async () => {
    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });
    const body = await res.json();
    expect(body.payment.note).toMatch(/no USDC was transferred/i);
    expect(body.payment.settled).toBe(false);

    // No fabricated settlement evidence anywhere in the response.
    const raw = JSON.stringify(body);
    expect(body.payment).not.toHaveProperty("transaction");
    expect(body.payment).not.toHaveProperty("txHash");
    expect(raw).not.toMatch(/txhash|transactionHash/i);
  });

  it("advertises the demo caveat in the 402 payment requirements", async () => {
    const body = await (await post(TRADE)).json();
    expect(body.accepts[0].extra.mode).toBe("demo");
    expect(body.accepts[0].extra.note).toMatch(/DEMO MODE/);
  });

  it("uses the zero address rather than implying a real merchant wallet", async () => {
    const body = await (await post(TRADE)).json();
    expect(body.accepts[0].payTo).toBe(ZERO);
  });

  it("reports no revenue, so nothing can read as earned", () => {
    expect(x402Summary().mode).toBe("demo");
    expect(x402Summary().authorizedUsdc).toBeNull();
    expect(x402Summary().revenueUsdc).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Live mode against a mocked facilitator
 * ------------------------------------------------------------------ */

describe("live mode", () => {
  beforeEach(liveMode);

  it("verifies through the facilitator and returns a verified payment", async () => {
    const fetchMock = vi.fn(async () => {
      h.calls.push("facilitator");
      return new Response(JSON.stringify({ isValid: true, payer: "0xpayer" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.payment.status).toBe("verified");
    expect(body.payment.mode).toBe("live");
    expect(body.payment.payer).toBe("0xpayer");
    expect(body.decision).toBe("ALLOW");
  });

  it("verifies payment before the risk engine runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        h.calls.push("facilitator");
        return new Response(JSON.stringify({ isValid: true, payer: "0xpayer" }), { status: 200 });
      }),
    );

    await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });
    expect(h.calls).toEqual(["facilitator", "evaluateTrade"]);
  });

  it("POSTs the spec-shaped body to the facilitator /verify endpoint", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ isValid: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://facilitator.example/v2/x402/verify");
    expect(init.method).toBe("POST");

    const sent = JSON.parse(init.body as string);
    expect(sent).toHaveProperty("x402Version");
    expect(sent).toHaveProperty("paymentPayload");
    expect(sent).toHaveProperty("paymentRequirements");
    expect(sent.paymentRequirements.payTo).toBe(PAY_TO);
    expect(sent.paymentRequirements.amount).toBe(PRICE_ATOMIC);
  });

  it("returns 402 and skips the risk engine when the facilitator says invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ isValid: false, invalidReason: "insufficient_funds" }), {
            status: 200,
          }),
      ),
    );

    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("insufficient_funds");
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("fails closed when the facilitator is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });
    expect(res.status).toBe(402);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("fails closed when the facilitator returns an error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });
    expect(res.status).toBe(402);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("never leaks the facilitator API key into a response", async () => {
    vi.stubEnv("FENTRA_X402_FACILITATOR_API_KEY", "super-secret-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ isValid: true }), { status: 200 })),
    );

    const res = await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });
    expect(JSON.stringify(await res.json())).not.toContain("super-secret-key");
  });
});

/* ------------------------------------------------------------------ *
 * The dashboard log
 * ------------------------------------------------------------------ */

describe("x402 ledger", () => {
  it("logs a paid check with its verdict", async () => {
    await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader({ payTo: ZERO }) });

    const summary = x402Summary();
    expect(summary.checksToday).toBe(1);
    expect(summary.recent[0]).toMatchObject({
      symbol: "BTCUSDT",
      side: "BUY",
      notional: 1000,
      leverage: 3,
      decision: "ALLOW",
      status: "simulated",
      mode: "demo",
      settled: false,
    });
  });

  it("does not log a call that failed the payment gate", async () => {
    await post(TRADE);
    expect(x402Summary().checksToday).toBe(0);
  });

  it("counts authorized value from verified payments", async () => {
    liveMode();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ isValid: true }), { status: 200 })),
    );

    await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });
    await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });

    const summary = x402Summary();
    expect(summary.checksToday).toBe(2);
    expect(summary.authorizedUsdc).toBeCloseTo(0.02, 10);
  });

  it("never reports revenue for a payment that was not settled", async () => {
    liveMode();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ isValid: true }), { status: 200 })),
    );

    await post(TRADE, { "PAYMENT-SIGNATURE": paymentHeader() });

    // Verification proves the authorization is good; it does not move funds.
    // Fentra does not call /settle, so nothing may be reported as received.
    const summary = x402Summary();
    expect(summary.recent[0].settled).toBe(false);
    expect(summary.revenueUsdc).toBe(0);
    expect(summary.authorizedUsdc).toBeCloseTo(0.01, 10);
  });
});

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

describe("GET /api/risk/check/info", () => {
  it("describes the service without requiring payment", async () => {
    const res = await INFO(new Request("http://localhost/api/risk/check/info"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.service).toBe("Fentra Risk API");
    expect(body.endpoint).toBe("POST /api/risk/check");
    expect(body.price).toBe("0.01 USDC");
    expect(body.network).toBe("BNB Chain");
    expect(body.payment).toBe("x402");
  });

  it("labels the mode so a caller knows whether payments are real", async () => {
    const body = await (await INFO(new Request("http://localhost/api/risk/check/info"))).json();
    expect(body.x402.mode).toBe("demo");
    expect(body.x402.modeDescription).toMatch(/DEMO MODE/);
    expect(body.x402.paymentHeader).toContain("X-PAYMENT");
  });

  it("exposes no credentials", async () => {
    vi.stubEnv("BINANCE_API_KEY", "binance-key");
    vi.stubEnv("BINANCE_API_SECRET", "binance-secret");
    vi.stubEnv("FENTRA_X402_FACILITATOR_API_KEY", "facilitator-key");

    const raw = JSON.stringify(
      await (await INFO(new Request("http://localhost/api/risk/check/info"))).json(),
    );
    expect(raw).not.toContain("binance-key");
    expect(raw).not.toContain("binance-secret");
    expect(raw).not.toContain("facilitator-key");
  });
});

/* ------------------------------------------------------------------ *
 * Pricing arithmetic
 * ------------------------------------------------------------------ */

describe("atomic unit conversion", () => {
  it("converts the demo price without floating point error", () => {
    expect(toAtomicUnits("0.01", 18)).toBe("10000000000000000");
    expect(toAtomicUnits("0.01", 6)).toBe("10000");
    expect(toAtomicUnits("1", 18)).toBe("1000000000000000000");
    expect(toAtomicUnits("1.5", 6)).toBe("1500000");
  });
});

/* ------------------------------------------------------------------ *
 * Binance B402 interop
 *
 * These encode what live B402 listings actually publish, read from the
 * public Bazaar rather than inferred from the spec. Every entry there is
 * `x402Version: 2` on `eip155:56`, prices in 18-decimal atomic units, and
 * -- the part the written v2 spec does not tell you -- names the price
 * `maxAmountRequired`, not `amount`.
 * ------------------------------------------------------------------ */

describe("Binance B402 interop", () => {
  /** Stablecoins observed in live B402 listings, all 18-decimal on BSC. */
  const BSC_ASSETS = {
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
    USD1: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
  };

  it("publishes the price under both names, as live B402 listings do", async () => {
    const a = (await (await post(TRADE)).json()).accepts[0];
    // The name every real Bazaar entry uses.
    expect(a.maxAmountRequired).toBe("10000000000000000");
    // The name the written v2 spec uses. Same value, so either client works.
    expect(a.amount).toBe("10000000000000000");
  });

  it("prices 0.01 in 18-decimal units, the going rate on BNB Chain", async () => {
    const a = (await (await post(TRADE)).json()).accepts[0];
    expect(a.maxAmountRequired).toBe(toAtomicUnits("0.01", 18));
  });

  it("defaults to BNB Chain mainnet and a scheme B402 actually serves", async () => {
    const a = (await (await post(TRADE)).json()).accepts[0];
    expect(a.network).toBe("eip155:56");
    // permit2-exact and eip3009 are the two schemes in the Bazaar; permit2-exact
    // is the one listed against all four supported stablecoins.
    expect(["permit2-exact", "eip3009"]).toContain(a.scheme);
  });

  it("defaults to the Binance-Peg USDC contract on BSC", async () => {
    const a = (await (await post(TRADE)).json()).accepts[0];
    expect(a.asset).toBe(BSC_ASSETS.USDC);
  });

  it("supports the other BSC stablecoins by configuration alone", async () => {
    vi.stubEnv("FENTRA_X402_ASSET", BSC_ASSETS.USDT);
    vi.stubEnv("FENTRA_X402_ASSET_SYMBOL", "USDT");

    const a = (await (await post(TRADE)).json()).accepts[0];
    expect(a.asset).toBe(BSC_ASSETS.USDT);
    expect(a.maxAmountRequired).toBe("10000000000000000");
  });

  it("accepts a payer echoing the price under either name", async () => {
    vi.stubEnv("FENTRA_X402_FACILITATOR_URL", "https://facilitator.example");
    vi.stubEnv("FENTRA_X402_PAY_TO", PAY_TO);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ isValid: true }), { status: 200 })),
    );

    // A B402-style payer echoes `maxAmountRequired` and omits `amount`.
    const header = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: {
          scheme: "permit2-exact",
          network: "eip155:56",
          maxAmountRequired: PRICE_ATOMIC,
          asset: USDC_BSC,
          payTo: PAY_TO,
        },
        payload: { signature: "0xsig" },
      }),
    ).toString("base64");

    const res = await post(TRADE, { "PAYMENT-SIGNATURE": header });
    expect(res.status).toBe(200);
  });

  it("still rejects an underpayment expressed under the v1 name", async () => {
    const header = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: {
          scheme: "permit2-exact",
          network: "eip155:56",
          maxAmountRequired: "1",
          asset: USDC_BSC,
          payTo: ZERO,
        },
        payload: { signature: "0xsig" },
      }),
    ).toString("base64");

    const res = await post(TRADE, { "PAYMENT-SIGNATURE": header });
    expect(res.status).toBe(402);
    expect(h.calls).not.toContain("evaluateTrade");
  });
});

/* ------------------------------------------------------------------ *
 * x402 v1 wire format (Base / Solana via third-party facilitators)
 *
 * v1 is not a legacy fallback: it is the generation live public
 * facilitators actually serve, and the one a real payment settles on.
 * These assert the 402 document and the facilitator request are the v1
 * shapes, not v2 with fields renamed.
 * ------------------------------------------------------------------ */

describe("x402 v1 mode", () => {
  const BASE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  /** v1 rails: Base Sepolia, EIP-3009 `exact`, 6-decimal USDC. */
  function v1Demo() {
    vi.stubEnv("FENTRA_X402_PROTOCOL_VERSION", "1");
  }
  function v1Live() {
    v1Demo();
    vi.stubEnv("FENTRA_X402_FACILITATOR_URL", "https://x402.org/facilitator");
    vi.stubEnv("FENTRA_X402_PAY_TO", PAY_TO);
  }

  /** A v1 payment header: scheme and network sit at the top level. */
  function v1Header(overrides: Record<string, unknown> = {}) {
    return Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: "exact",
        network: "base-sepolia",
        payload: {
          signature: "0xdeadbeef",
          authorization: { from: "0xpayer", to: PAY_TO, value: "10000" },
        },
        ...overrides,
      }),
    ).toString("base64");
  }

  it("emits a v1 402 document, not a v2 one", async () => {
    v1Demo();
    const res = await post(TRADE);
    expect(res.status).toBe(402);

    const body = await res.json();
    expect(body.x402Version).toBe(1);
    // v1 describes the resource inside each accepts entry.
    expect(body.resource).toBeUndefined();

    const a = body.accepts[0];
    expect(a.scheme).toBe("exact");
    expect(a.network).toBe("base-sepolia");
    expect(a.maxAmountRequired).toBe("10000"); // 0.01 at 6 decimals
    expect(a.amount).toBeUndefined(); // that is the v2 name
    expect(a.asset).toBe(BASE_USDC);
    expect(typeof a.resource).toBe("string");
    expect(a.description).toContain("risk verdict");
    expect(a.mimeType).toBe("application/json");
  });

  it("advertises the token EIP-712 domain a payer needs in order to sign", async () => {
    v1Demo();
    const body = await (await post(TRADE)).json();
    expect(body.accepts[0].extra).toMatchObject({ name: "USDC", version: "2" });
  });

  it("prices 0.01 USDC at six decimals, not eighteen", async () => {
    v1Demo();
    const body = await (await post(TRADE)).json();
    expect(body.accepts[0].maxAmountRequired).toBe("10000");
  });

  it("accepts a v1 payment header and returns the verdict", async () => {
    v1Live();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ isValid: true, payer: "0xp" }), { status: 200 })),
    );

    const res = await post(TRADE, { "X-PAYMENT": v1Header() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision).toBe("ALLOW");
    expect(body.payment.status).toBe("verified");
  });

  it("sends v1-shaped requirements to the facilitator", async () => {
    v1Live();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ isValid: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await post(TRADE, { "X-PAYMENT": v1Header() });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x402.org/facilitator/verify");

    const sent = JSON.parse(init.body as string);
    expect(sent.x402Version).toBe(1);
    // The requirements must go in the same generation the payer signed against.
    expect(sent.paymentRequirements.maxAmountRequired).toBe("10000");
    expect(sent.paymentRequirements.amount).toBeUndefined();
    expect(sent.paymentRequirements.network).toBe("base-sepolia");
    expect(sent.paymentRequirements.scheme).toBe("exact");
    expect(typeof sent.paymentRequirements.resource).toBe("string");
  });

  it("still refuses a v1 payment for the wrong network", async () => {
    v1Live();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ isValid: true }), { status: 200 })),
    );

    const res = await post(TRADE, { "X-PAYMENT": v1Header({ network: "eip155:56" }) });
    expect(res.status).toBe(402);
    expect(h.calls).not.toContain("evaluateTrade");
  });

  it("reports Base Sepolia on the info endpoint", async () => {
    v1Demo();
    const body = await (await INFO(new Request("http://localhost/api/risk/check/info"))).json();
    expect(body.network).toBe("Base Sepolia");
    expect(body.x402.version).toBe(1);
    expect(body.x402.accepts[0].maxAmountRequired).toBe("10000");
  });

  it("defaults to v2 BNB Chain rails when the version is not set", async () => {
    const body = await (await INFO(new Request("http://localhost/api/risk/check/info"))).json();
    expect(body.network).toBe("BNB Chain");
    expect(body.x402.version).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * The model is not part of this
 * ------------------------------------------------------------------ */

describe("LLM isolation", () => {
  it("gives the agent no tool that touches payments or the paid endpoint", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(names).not.toContain("x402");
    for (const name of names) {
      expect(name).not.toMatch(/x402|payment|pay|wallet|merchant|invoice/i);
    }
  });

  it("keeps the payment layer out of the agent and MCP surfaces entirely", () => {
    // A structural check: if either surface ever imports the x402 modules, the
    // merchant configuration becomes reachable from model-facing code.
    for (const file of ["src/agent/tools.ts", "src/agent/agent.ts", "src/mcp/server.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/@\/x402/);
    }
  });
});
