/**
 * Pays for one Fentra risk check over x402, end to end, for real.
 *
 *   node scripts/x402-pay.mjs [url] [--notional 2000] [--leverage 20]
 *
 * This is a *client*. It is the counterpart to the server in
 * src/app/api/risk/check — the external agent, playing its part of the
 * handshake. It uses the official `x402-fetch` package rather than signing
 * anything by hand, so the payment is produced exactly the way the protocol
 * specifies: request, read the 402, sign an EIP-3009 authorization, retry with
 * the X-PAYMENT header.
 *
 * You need:
 *   X402_PAYER_PRIVATE_KEY   a funded testnet key (0x-prefixed, 64 hex chars)
 *
 * The wallet needs testnet USDC on Base Sepolia and nothing else — the `exact`
 * scheme is gasless for the payer, because the facilitator submits the transfer
 * and pays the gas. Get USDC from https://faucet.circle.com (pick Base Sepolia).
 *
 * NEVER put a mainnet key in here. This is a throwaway test wallet.
 */

import { wrapFetchWithPayment, decodeXPaymentResponse, createSigner } from "x402-fetch";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000/api/risk/check";
const network = flag("network", "base-sepolia");
const key = process.env.X402_PAYER_PRIVATE_KEY?.trim();

const trade = {
  symbol: flag("symbol", "BTCUSDT"),
  side: flag("side", "BUY"),
  type: "MARKET",
  notional: Number(flag("notional", "2000")),
  leverage: Number(flag("leverage", "20")),
  market: "USDM_FUTURES",
};

const line = (s = "") => process.stdout.write(`${s}\n`);

if (!key) {
  line("X402_PAYER_PRIVATE_KEY is not set.");
  line();
  line("  1. Make a throwaway wallet (MetaMask -> new account -> export private key).");
  line("  2. Fund it with Base Sepolia USDC at https://faucet.circle.com");
  line("  3. $env:X402_PAYER_PRIVATE_KEY = '0x...'   (PowerShell)");
  line();
  line("No ETH needed: the facilitator pays gas for the transfer.");
  process.exit(1);
}

line(`Resource   ${url}`);
line(`Network    ${network}`);
line(`Proposal   ${trade.symbol} ${trade.side} $${trade.notional} ${trade.leverage}x`);
line();

// ---- 1. Show what the server asks for, unpaid. ----------------------------
const unpaid = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(trade),
});

line(`Unpaid request  -> HTTP ${unpaid.status}`);
if (unpaid.status !== 402) {
  line("Expected 402 Payment Required. Is the server in LIVE mode?");
  line(await unpaid.text());
  process.exit(1);
}

const requirements = await unpaid.json();
const accepts = requirements.accepts?.[0] ?? {};
line(`  x402Version   ${requirements.x402Version}`);
line(`  scheme        ${accepts.scheme}`);
line(`  network       ${accepts.network}`);
line(`  price         ${accepts.maxAmountRequired ?? accepts.amount} (atomic)`);
line(`  asset         ${accepts.asset}`);
line(`  payTo         ${accepts.payTo}`);
line();

if (accepts.payTo === "0x0000000000000000000000000000000000000000") {
  line("payTo is the zero address, so the server is in DEMO MODE.");
  line("Set FENTRA_X402_FACILITATOR_URL and FENTRA_X402_PAY_TO, then restart it.");
  process.exit(1);
}

// ---- 2. Pay and retry. ----------------------------------------------------
const signer = await createSigner(network, key);
line(`Payer      ${signer.account?.address ?? signer.address ?? "(unknown)"}`);
line("Paying and retrying...");
line();

const fetchWithPay = wrapFetchWithPayment(fetch, signer);

const paid = await fetchWithPay(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(trade),
});

line(`Paid request    -> HTTP ${paid.status}`);
const body = await paid.json();

if (!paid.ok) {
  line(JSON.stringify(body, null, 2));
  process.exit(1);
}

// ---- 3. The verdict. ------------------------------------------------------
line();
line(`  DECISION      ${body.decision}`);
for (const reason of body.reasons ?? []) line(`                ${reason}`);
line();
line(`  payment       ${body.payment?.status} / ${body.payment?.mode}`);
line(`  executed      ${body.executed}`);

const settlement = paid.headers.get("x-payment-response");
if (settlement) {
  try {
    const decoded = decodeXPaymentResponse(settlement);
    line();
    line("  Settlement");
    line(`    success     ${decoded.success}`);
    line(`    tx          ${decoded.transaction}`);
    line(`    network     ${decoded.network}`);
  } catch {
    line(`  settlement header: ${settlement}`);
  }
}
line();
