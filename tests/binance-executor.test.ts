/**
 * Live Binance executor tests.
 *
 * The executor runs after the risk engine has already said ALLOW, so its job is
 * to submit the trade that was approved and nothing else. These assert the ways
 * it could quietly submit something different: sizing from a price Binance did
 * not just quote, rounding a quantity up past the approved notional, or placing
 * an order after the leverage the policy approved failed to apply.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BinanceExecutor } from "@/binance/binance-executor";
const creds = { apiKey: "k", apiSecret: "s", futuresBase: "https://x", testnet: true } as never;
const approved = (o = {}) => ({ symbol: "BTCUSDT", side: "BUY" as const, type: "MARKET" as const, notional: 2000, leverage: 3, market: "USDM_FUTURES" as const, approvalId: "a1b2c3d4", approvedAt: 0, ...o });

describe("live executor", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does not submit an order when the leverage change is refused", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      paths.push(new URL(String(url)).pathname);
      if (String(url).includes("/api/v3/ticker")) return new Response(JSON.stringify({ symbol: "BTCUSDT", lastPrice: "100000", priceChangePercent: "1" }), { status: 200 });
      if (String(url).includes("/fapi/v1/leverage")) return new Response(JSON.stringify({ code: -4028, msg: "Leverage 3 is not valid" }), { status: 400 });
      return new Response(JSON.stringify({ orderId: 1, status: "NEW" }), { status: 200 });
    }));
    const r = await new BinanceExecutor(creds).executeTrade(approved());
    expect(r.ok).toBe(false);
    expect(paths.some((p) => p.includes("/fapi/v1/order"))).toBe(false);
    expect(r.message).toContain("leverage");
  });

  it("does not submit an order sized from a non-live quote", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      paths.push(new URL(String(url)).pathname);
      if (String(url).includes("/api/v3/ticker")) return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ orderId: 1, status: "NEW" }), { status: 200 });
    }));
    // A symbol no earlier test has cached, so the quote really is synthetic.
    const r = await new BinanceExecutor(creds).executeTrade(approved({ symbol: "SOLUSDT" }));
    expect(r.ok).toBe(false);
    expect(paths.some((p) => p.includes("/fapi/v1/order"))).toBe(false);
    expect(paths.some((p) => p.includes("/fapi/v1/leverage"))).toBe(false);
  });

  it("rounds the quantity down so the order never exceeds the approved notional", async () => {
    let sent = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/v3/ticker")) return new Response(JSON.stringify({ symbol: "BTCUSDT", lastPrice: "100000", priceChangePercent: "0" }), { status: 200 });
      if (String(url).includes("/fapi/v1/leverage")) return new Response("{}", { status: 200 });
      sent = new URL(String(url)).searchParams.get("quantity") ?? "";
      return new Response(JSON.stringify({ orderId: 1, status: "NEW" }), { status: 200 });
    }));
    // $150 at 100,000 is 0.0015 BTC. Rounding up to 0.002 would be a $200 order.
    const r = await new BinanceExecutor(creds).executeTrade(approved({ notional: 150 }));
    expect(r.ok).toBe(true);
    expect(Number(sent) * 100000).toBeLessThanOrEqual(150);
  });

  it("refuses an order whose quantity rounds to zero", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      paths.push(new URL(String(url)).pathname);
      if (String(url).includes("/api/v3/ticker")) return new Response(JSON.stringify({ symbol: "BTCUSDT", lastPrice: "100000", priceChangePercent: "0" }), { status: 200 });
      return new Response(JSON.stringify({ orderId: 1, status: "NEW" }), { status: 200 });
    }));
    const r = await new BinanceExecutor(creds).executeTrade(approved({ notional: 50 }));
    expect(r.ok).toBe(false);
    expect(paths.some((p) => p.includes("/fapi/v1/order"))).toBe(false);
  });

  it("asks Binance for the order outcome, not just an acknowledgement", async () => {
    let respType = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/v3/ticker")) return new Response(JSON.stringify({ symbol: "BTCUSDT", lastPrice: "100000", priceChangePercent: "0" }), { status: 200 });
      if (String(url).includes("/fapi/v1/leverage")) return new Response("{}", { status: 200 });
      respType = new URL(String(url)).searchParams.get("newOrderRespType") ?? "";
      return new Response(JSON.stringify({ orderId: 7, status: "FILLED", executedQty: "0.02", avgPrice: "100000" }), { status: 200 });
    }));
    const r = await new BinanceExecutor(creds).executeTrade(approved());
    expect(respType).toBe("RESULT");
    expect(r.filledQty).toBe(0.02);
    expect(r.filledPrice).toBe(100000);
    expect(r.message).toContain("filled 0.02");
  });

  it("reports a rejected order as a failure even though Binance answered 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/v3/ticker")) return new Response(JSON.stringify({ symbol: "BTCUSDT", lastPrice: "100000", priceChangePercent: "0" }), { status: 200 });
      if (String(url).includes("/fapi/v1/leverage")) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ orderId: 8, status: "EXPIRED", executedQty: "0", avgPrice: "0" }), { status: 200 });
    }));
    const r = await new BinanceExecutor(creds).executeTrade(approved());
    expect(r.ok).toBe(false);
    expect(r.filledPrice).toBeUndefined();
    expect(r.message).toContain("nothing was filled");
  });

  it("does not invent a fill price for an order that is still working", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/v3/ticker")) return new Response(JSON.stringify({ symbol: "BTCUSDT", lastPrice: "100000", priceChangePercent: "0" }), { status: 200 });
      if (String(url).includes("/fapi/v1/leverage")) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ orderId: 9, status: "NEW", executedQty: "0", avgPrice: "0" }), { status: 200 });
    }));
    const r = await new BinanceExecutor(creds).executeTrade(approved());
    expect(r.ok).toBe(true);
    expect(r.filledQty).toBe(0);
    expect(r.filledPrice).toBeUndefined();
    expect(r.message).toContain("not yet filled");
  });

  it("values open positions at the mark price, not the entry price", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      totalMarginBalance: "10000", availableBalance: "9000",
      positions: [{ symbol: "BTCUSDT", positionAmt: "0.1", entryPrice: "50000", leverage: "3", unrealizedProfit: "5000" }],
    }), { status: 200 })));
    const [p] = await new BinanceExecutor(creds).getPositions();
    expect(p.markPrice).toBeCloseTo(100000, 6);
    expect(p.notional).toBeCloseTo(10000, 6);
  });

  it("values a short position at the mark price", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      totalMarginBalance: "10000", availableBalance: "9000",
      positions: [{ symbol: "BTCUSDT", positionAmt: "-0.1", entryPrice: "100000", leverage: "3", unrealizedProfit: "1000" }],
    }), { status: 200 })));
    const [p] = await new BinanceExecutor(creds).getPositions();
    expect(p.side).toBe("SHORT");
    expect(p.markPrice).toBeCloseTo(90000, 6);
    expect(p.notional).toBeCloseTo(9000, 6);
  });
});
