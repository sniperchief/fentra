/**
 * Credential check: `npm run check:binance`
 *
 * Confirms the API key, secret and host in .env.local actually authenticate
 * against Binance before you launch the app, so a bad key shows up here rather
 * than as a silent fall back to Demo Mode.
 *
 * Read-only. It never places an order.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Minimal .env.local reader, so the script has no dependencies.
function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

loadEnvLocal();

const apiKey = process.env.BINANCE_API_KEY?.trim();
const apiSecret = process.env.BINANCE_API_SECRET?.trim();
const testnet = process.env.BINANCE_TESTNET !== "false";
const base =
  process.env.BINANCE_FUTURES_BASE?.trim() ||
  (testnet ? "https://demo-fapi.binance.com" : "https://fapi.binance.com");

console.log(`mode : ${testnet ? "TESTNET" : "*** LIVE — REAL FUNDS ***"}`);
console.log(`host : ${base}`);

if (!apiKey || !apiSecret) {
  console.log("\nNo credentials set. Fentra will run in Demo Mode.");
  console.log("Add BINANCE_API_KEY and BINANCE_API_SECRET to .env.local to connect.");
  process.exit(0);
}
console.log(`key  : ${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (${apiKey.length} chars)`);

async function signedGet(pathname, params = {}) {
  const qs = new URLSearchParams({ ...params, recvWindow: "5000", timestamp: String(Date.now()) })
    .toString();
  const signature = crypto.createHmac("sha256", apiSecret).update(qs).digest("hex");
  const res = await fetch(`${base}${pathname}?${qs}&signature=${signature}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

// Clock skew is the most common cause of signature failures.
const t = await fetch(`${base}/fapi/v1/time`).then((r) => r.json());
const skew = Date.now() - t.serverTime;
console.log(`clock: ${skew > 0 ? "+" : ""}${skew} ms vs Binance`);
if (Math.abs(skew) > 1000) {
  console.log("       ⚠ Over 1s of skew will cause -1021 signature errors. Sync your system clock.");
}

const acct = await signedGet("/fapi/v2/account");

if (!acct.ok) {
  const code = acct.body?.code;
  console.log(`\n✗ FAILED (HTTP ${acct.status}${code ? `, code ${code}` : ""})`);
  console.log(`  ${acct.body?.msg ?? "unknown error"}`);
  const hints = {
    "-2015": "Key invalid, futures not enabled on it, or your IP is not allowlisted.",
    "-1022": "Signature invalid — check the secret was copied whole, with no whitespace.",
    "-1021": "Timestamp outside recvWindow — sync your system clock.",
    "-2014": "Malformed API key.",
  };
  if (hints[String(code)]) console.log(`  hint: ${hints[String(code)]}`);
  console.log("\n  Testnet keys only work on the testnet host, and vice versa.");
  process.exit(1);
}

const positions = (acct.body.positions ?? []).filter((p) => Number(p.positionAmt) !== 0);
console.log("\n✓ AUTHENTICATED");
console.log(`  margin balance : ${Number(acct.body.totalMarginBalance).toFixed(2)} USDT`);
console.log(`  available      : ${Number(acct.body.availableBalance).toFixed(2)} USDT`);
console.log(`  open positions : ${positions.length}`);
for (const p of positions) {
  console.log(`    ${p.symbol} ${Number(p.positionAmt) > 0 ? "LONG" : "SHORT"} @ ${p.entryPrice} (${p.leverage}x)`);
}

// Recent orders, so a filled trade can be traced back to the approval that
// allowed it. Fentra tags every order it places as `fentra-<approvalId>`;
// `safetrade-` is the pre-rename prefix, still recognised so historical
// testnet orders are not misreported as manual.
const ORDER_TAGS = ["fentra-", "safetrade-"];
for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]) {
  const orders = await signedGet("/fapi/v1/allOrders", { symbol, limit: 5 });
  if (!orders.ok || !Array.isArray(orders.body) || orders.body.length === 0) continue;

  console.log(`\n  recent ${symbol} orders:`);
  for (const o of orders.body.slice(-5)) {
    const tag = String(o.clientOrderId ?? "");
    const matched = ORDER_TAGS.find((t) => tag.startsWith(t));
    const origin = matched ? "Fentra" : "manual/other";
    const price = Number(o.avgPrice) > 0 ? Number(o.avgPrice).toFixed(2) : "—";
    console.log(
      `    #${o.orderId}  ${o.side.padEnd(4)} ${Number(o.origQty)} @ ${price}` +
        `  ${o.status.padEnd(8)} ${new Date(o.time).toLocaleString()}  [${origin}]`,
    );
    if (matched) {
      console.log(`      approval: ${tag.slice(matched.length)}`);
    }
  }
}

if (Number(acct.body.totalMarginBalance) <= 0) {
  console.log("\n  ⚠ Zero balance. Every proposal will be BLOCKED by the risk engine,");
  console.log("    because 20% of $0 equity is $0 and there is no margin behind a position.");
  console.log("    That is correct behaviour, but it makes for a dull demo — fund the");
  console.log("    testnet account, or unset the Binance keys to use Demo Mode.");
}
console.log("\nFentra will start in Binance Connected mode.");
