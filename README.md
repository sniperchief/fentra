# Fentra

**A deterministic risk control plane between an AI trading agent and Binance execution.**

Built for the Binance Agent OS Mini Hackathon — Track A: Build an AI Agent with Agent OS.

> The AI can propose any trade. It cannot execute one that violates the user's risk policy.

Binance Agent OS gives AI agents real trading capability. Fentra adds the layer that decides
whether a *specific* trade should happen, given the user's financial risk policy and the live state
of their portfolio.

This is not tool permissioning. The question a generic governance layer answers is *"is this agent
allowed to call `place_order`?"* The question Fentra answers is *"should this exact order —
$5,000 of BTCUSDT at 3x, against $10,482 of equity with $1,400 already at risk and the account
1.6% off its intraday high — be allowed right now?"* That requires live account state, live market
state, and arithmetic. It cannot be expressed as a static permission.

---

## The core guarantee

```
User
  ↓
Fentra AI Agent   ── reads market data, account state, positions
  ↓
Trade Proposal       ── structured, untrusted
  ↓
Deterministic Risk Engine   ── pure function, no LLM
  ↓
ALLOW / BLOCK / HALT
  ↓ (ALLOW only)
Execution Service    ── the ONLY caller of the executor
  ↓
Binance
```

The LLM has **no tool that places an order**, changes leverage, changes margin mode, or edits the
risk policy. Its entire write surface is one tool, `propose_trade`, which submits to the control
plane and receives a verdict it cannot influence. Execution lives in
[`src/server/control-plane.ts`](src/server/control-plane.ts) and is reachable only inside the
`ALLOW` branch.

This is enforced by code, not by prompt instructions, and it is the thing the test suite actually
asserts:

```
RiskEngine = BLOCK  →  ExecutionAdapter.executeTrade() must NOT be called.
RiskEngine = HALT   →  ExecutionAdapter.executeTrade() must NOT be called.
```

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 51 tests
```

No configuration is required. With no keys set, Fentra runs in **Demo Mode**: live public
Binance market data, locally simulated fills, and a clear label saying so. The risk-control demo
works end to end without any credentials.

To add the AI agent and/or live execution, copy `.env.example` to `.env.local`:

| Variable | Effect if unset |
| --- | --- |
| `ANTHROPIC_API_KEY` | Falls back to a deterministic proposer, labelled as such in the UI |
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Demo Mode — nothing is sent to Binance |
| `BINANCE_TESTNET` | Defaults to `true`. Set to `false` only to trade real funds |

---

## Binance integration findings

Research pass over the official Binance documentation, and what it means for this architecture.

**1. Agent OS's user-facing surface is a hosted MCP server.**
Binance operates an Agentic MCP server at `https://agent.binance.com/mcp/agentic`, spoken over
Streamable HTTP. Access is authorised through a browser-based *Binance Agentic Account Access*
consent screen, with granular scopes — market data, account, trade, transfer. There is **no
withdrawal scope**; an agent can never move funds to an external address. Trading covers Spot,
Margin, Convert, USDⓈ-M Futures and COIN-M Futures, all bound to a dedicated **Agentic
sub-account** that the user must fund themselves — an agent cannot sweep funds in from the main
account. Documented clients are interactive MCP hosts: Claude Code, Claude Desktop, ChatGPT,
Codex CLI, VS Code, Grok.

**2. There is no documented way for a third-party backend to inherit that authorisation.**
This was the decisive finding. The Binance docs describe an interactive, desktop-oriented OAuth
consent flow between a user's MCP client and Binance. Nothing documents a mechanism by which a
custom middleware or proxy could obtain, forward, or delegate a user's Agent OS MCP session, and
the docs explicitly warn against pasting the endpoint around. Per the project's own research rules,
undocumented behaviour is treated as unsupported.

**Consequence:** Fentra is *not* built as an MCP proxy sitting in front of Binance's hosted MCP
server. That design would have required inventing a session-delegation mechanism Binance does not
document. Fentra is a self-built agent application instead.

**3. The supported programmatic path for a self-built agent backend is the standard signed REST
API.** Binance's own [Skills Hub](https://github.com/binance/binance-skills-hub) — the official
repository of agent skills — authenticates exactly this way: user-issued API keys supplied through
environment variables. Fentra follows the documented scheme: `X-MBX-APIKEY` header, HMAC-SHA256
signature over the raw query string, with `timestamp` and `recvWindow`. Public market data endpoints
need no credentials, which is why Demo Mode still shows real prices.

**4. Testnet is a first-class target, and it has moved.** Live execution defaults to the USDⓈ-M
futures testnet, so the full path can be exercised without risking funds. Note that Binance
relocated this: `testnet.binancefuture.com` now redirects to `demo.binance.com`, and the
derivatives docs give the REST base as `https://demo-fapi.binance.com`. Both hosts still answer,
but Fentra uses the documented one, overridable with `BINANCE_FUTURES_BASE`. Real-money trading
requires deliberately setting `BINANCE_TESTNET=false`.

### Where Fentra fits

Fentra is complementary to the hosted MCP server rather than a replacement for it. Binance's
MCP scopes answer *"may this agent trade at all?"* Fentra answers *"should this trade happen,
given this portfolio right now?"* — a portfolio-level financial control that a scope cannot express.
Because the venue sits behind a `TradingExecutor` interface, the same risk engine would front a
future officially-supported Agent OS execution path without changes above the adapter.

---

## Risk policy

Configurable in the UI, enforced in application code. Defaults:

| Limit | Default | Rule |
| --- | --- | --- |
| Max position size | 20% of equity | Exposure **after the fill**, per symbol, netted against open positions |
| Max leverage | 5x | Both the order's leverage and resulting account leverage |
| Max daily drawdown | 5% | `(peakEquity − currentEquity) / peakEquity` against an intraday high-water mark |
| Max order notional | $5,000 | Per-order ceiling |
| Max price deviation | 5% | Limit price vs. live market price |

Policy edits are validated and clamped server-side ([`policy-store.ts`](src/policy/policy-store.ts)),
so a malformed request can never widen a limit or disable the risk layer.

### The five checks

Every check runs on every proposal, so the UI shows the full report rather than the first failure.

1. **Drawdown circuit breaker** — `HALT` dominates `BLOCK`. Once tripped it *latches* for the day
   and stays latched even if equity recovers. It also latches on polling alone, before any trade is
   proposed.
2. **Position size** — projected symbol exposure after the fill vs. the equity cap. A `SELL` against
   an open long correctly reduces exposure rather than adding to it.
3. **Leverage** — requested order leverage, and effective account leverage after the fill.
4. **Order notional** — per-order ceiling.
5. **Order Sanity Validation** — the order measured against the live market: limit price deviation,
   non-positive or non-finite notional, fractional leverage, leverage beyond what the venue offers,
   leverage on a spot order, symbol/quote mismatch, missing limit price.

### Beyond `place_order`

An agent must not be able to sidestep the policy by changing a risk-sensitive setting first, so
leverage changes and margin-mode changes are evaluated against the same policy
(`evaluateAccountOperation`). Switching to CROSSED margin is blocked, because it puts the whole
sub-account balance behind a position. Cancellations stay available even while halted, since
cancelling reduces exposure.

---

## Demo script

Four scenarios are wired into the dashboard. Each submits a real proposal through the real control
plane — nothing is animated or stubbed. Each also resets to the seeded baseline first, so it
demonstrates its own rule rather than inheriting exposure from the previous one.

| # | Scenario | Result | Why |
| --- | --- | --- | --- |
| 1 | BTCUSDT BUY $2,000 3x | **ALLOW** | Inside every limit; a simulated fill follows |
| 2 | BTCUSDT BUY $2,000 10x | **BLOCK** | `Requested 10x exceeds the 5x policy limit` |
| 3 | BTCUSDT BUY $5,000 3x | **BLOCK** | `Exposure would reach $5,000, above the 20% of equity cap ($2,096.44)` |
| 4 | Peak $11,000 → equity $10,340 | **HALT** | 6% drawdown against a 5% limit |

**The point of scenario 4:** after it trips, run scenario 1 again — the identical trade that was
allowed a moment ago. It returns `HALT` and never reaches the executor. The protection is
application state, not an instruction the model is trusted to follow.

You can also drive it conversationally:

- *"Analyze BTC and find a trade opportunity."*
- *"Go long BTCUSDT with $2,000 at 10x leverage."* → blocked on leverage
- *"Put $5,000 into BTCUSDT at 3x."* → blocked on position size

**Reset** in the Demo Scenarios panel restores the seeded state and clears the halt.

---

## Security model

- The Binance secret is read from the environment server-side and never serialised into any API
  response or reaches the browser.
- The LLM has read tools plus `propose_trade`. It has no execution tool, no policy-write tool, and
  no way to reach `BinanceExecutor` — enforced by module structure, not by prompt.
- Risk verdicts are computed by a pure function. The model's own risk arithmetic is never trusted;
  its proposal is data that gets measured.
- Malformed proposals are coerced, not trusted, then rejected by Order Sanity Validation with a
  readable reason.
- The halt latch lives in the control plane, so it applies identically in demo and live mode.
- Simulated fills are labelled `simulated: true` with venue `DEMO` end to end. Fentra never
  claims a trade reached Binance when it did not.

---

## Architecture

```
src/
  agent/
    agent.ts             Manual tool loop (claude-opus-5)
    heuristic-agent.ts   Deterministic fallback when no API key is set
    prompts.ts           System prompt
    tools.ts             Read tools + check_trade_risk + propose_trade.
                         No execution tool.
  risk/
    risk-engine.ts       evaluateTrade() — pure. evaluateAccountOperation().
    risk-rules.ts        The five checks, individually pure
    types.ts             Domain types. No Binance, no UI, no LLM.
  binance/
    trading-executor.ts  Executor selection: credentials → live, else demo
    binance-client.ts    Signed REST (HMAC-SHA256) + public endpoints
    binance-executor.ts  USDⓈ-M futures adapter
    demo-executor.ts     Simulated fills against live prices
    market-data.ts       Public quotes, cached, degrades honestly
    types.ts             TradingExecutor interface, ApprovedTrade
  mcp/
    server.ts            MCP server (stdio). Three read-only tools.
    tools/               check-trade-risk, get-risk-policy, get-risk-status
  policy/policy-store.ts Defaults, validation, clamping
  server/
    control-plane.ts     The gate. Only caller of executeTrade().
    session.ts           Process-local state
    scenarios.ts         Seeded demo scenarios
  app/                   Next.js App Router — landing, console, API routes
  ui/components/         Console and landing components
tests/
  risk-engine.test.ts    29 tests — every rule, determinism, sanity validation
  control-plane.test.ts  17 tests — execution gating, halt latching, isolation
  mcp-tools.test.ts      15 tests — MCP verdicts, and that MCP cannot execute
  binance-client.test.ts 10 tests — request signing, credential loading
  policy-store.test.ts   10 tests — clamping, mode switching
```

The rest of the application depends on the `TradingExecutor` interface, never on Binance SDK
details:

```ts
interface TradingExecutor {
  getAccountState(): Promise<AccountState>;
  getPositions(): Promise<Position[]>;
  getMarketData(symbol: string): Promise<MarketState>;
  executeTrade(trade: ApprovedTrade): Promise<ExecutionResult>;
}
```

`ApprovedTrade` carries an `approvalId` and can only be constructed inside the control plane after
an `ALLOW` verdict — the executor is not able to accept anything else.

---

## Fentra MCP server

Fentra's risk engine is also exposed over the **Model Context Protocol**, so any MCP-capable agent
— Claude Code, Claude Desktop, ChatGPT, Codex, VS Code — can consult it before trading through its
own Binance authorization.

```text
AI agent
   |
   |  proposes BTCUSDT BUY $2,000 3x
   v
fentra_check_trade_risk
   |
   v
ALLOW  ->  agent executes through its own Binance capability
BLOCK  ->  agent explains the failing rule and does not execute
HALT   ->  agent stops trading for the day
```

**Fentra MCP does not execute trades.** It registers three read-only tools and no `place_order`,
`execute_trade` or `submit_trade`. Nothing on this transport can reach a Binance trading endpoint:
the tools call `evaluateOnly` and `getSnapshot`, neither of which touches the executor. Execution
stays with the agent's own authorized Binance capability, or with this application's internal gate.

This is complementary to Binance's Agentic MCP server rather than a replacement. Binance's scopes
answer *"may this agent trade at all?"*; Fentra answers *"should this trade happen, given this
portfolio right now?"* An agent granted Binance market-data scope plus Fentra for risk gets a
policy-bound workflow that neither provides alone.

### Start it

```bash
npm run mcp
```

Speaks MCP over stdio. `.env.local` is loaded if present, so the server sees the same Binance
credentials and policy as the web application; without credentials it runs against the demo
portfolio and live public prices, exactly like the console.

### Tools

| Tool | Returns |
| --- | --- |
| `fentra_check_trade_risk` | `ALLOW` / `BLOCK` / `HALT` for one proposed trade, with every check |
| `fentra_get_risk_policy` | The configured limits, read live from the control plane |
| `fentra_get_risk_status` | Equity, intraday drawdown, largest position, halt state |

MCP tool names cannot contain a dot, hence `fentra_` rather than `fentra.`.

#### `fentra_check_trade_risk`

```json
{ "symbol": "BTCUSDT", "side": "BUY", "type": "MARKET",
  "notional": 2000, "leverage": 3, "market": "USDM_FUTURES" }
```

```json
{
  "decision": "BLOCK",
  "reasons": ["Leverage: Requested 10x exceeds the 5x policy limit."],
  "checks": [
    { "check": "Leverage", "passed": false,
      "detail": "Requested 10x exceeds the 5x policy limit." }
  ],
  "metrics": {
    "currentEquity": 10482.21,
    "positionExposure": 0.19,
    "positionExposureUsd": 2000,
    "leverage": 10,
    "accountLeverageAfter": 0.32,
    "dailyDrawdown": 0.0158
  },
  "executed": false,
  "note": "Advisory verdict only. Fentra placed no order; execution remains with your authorized Binance capability."
}
```

`reasons` is empty on `ALLOW`. Rejected trades are never resized for you — the verdict describes
the trade as submitted, and choosing a compliant size is the agent's job.

#### `fentra_get_risk_policy`

```json
{ "maxPositionPercent": 20, "maxLeverage": 5, "maxDailyDrawdownPercent": 5,
  "maxOrderNotional": 5000, "maxOrderNotionalMode": "ABSOLUTE",
  "maxPriceDeviationPercent": 5 }
```

Read from the live policy object, never hardcoded; editing the policy in the console changes what
this returns. A `PCT_OF_EQUITY` cap is resolved to USDT against current equity.

#### `fentra_get_risk_status`

```json
{ "status": "ACTIVE", "currentEquity": 10482.21, "peakEquityToday": 10650,
  "dailyDrawdown": 1.58, "largestPositionPercent": 13.4, "openExposure": 1400,
  "accountLeverage": 0.13, "tradingHalted": false }
```

Percentages here are whole numbers (`1.58` = 1.58%), matching how an agent reads a policy.

### Connect a client

The repo ships a project-scoped [`.mcp.json`](.mcp.json), so **Claude Code** picks the server up
from the project root with no further setup. For **Claude Desktop**, add to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fentra": {
      "command": "npx",
      "args": ["tsx", "--env-file-if-exists=.env.local", "src/mcp/server.ts"],
      "cwd": "/absolute/path/to/fentra"
    }
  }
}
```

### Inside this application

The in-process agent gets the same check as a read-only `check_trade_risk` tool, so it can dry-run
its sizing before submitting. That tool is advisory and changes nothing about enforcement:
`propose_trade` remains the only write path, and `ControlPlane.submitProposal` still evaluates
independently and reaches the executor only on `ALLOW`. A pre-check verdict is not a reservation —
the engine re-evaluates against live state when the proposal actually arrives.

---

## Public risk API (x402, stretch)

Fentra's risk engine is exposed as a paid API, so an external AI agent can buy a verdict before it
trades. One call, one fixed price, settled in USDC on BNB Chain over [x402](https://www.x402.org).

```
GET  /api/risk/check/info    free service description
POST /api/risk/check         0.01 USDC per check
GET  /api/x402/log           the paid-check log behind the dashboard panel
GET  /llms.txt               machine-readable service description
GET  /agents                 integration guide, for the humans wiring it up
```

```bash
# Unpaid: the server answers with the price.
curl -i -X POST localhost:3000/api/risk/check \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSDT","side":"BUY","type":"MARKET","notional":2000,"leverage":20}'
# HTTP/1.1 402 Payment Required

# Paid: base64 x402 payment payload in the header.
curl -X POST localhost:3000/api/risk/check \
  -H 'Content-Type: application/json' \
  -H "PAYMENT-SIGNATURE: $(base64 -w0 payment.json)" \
  -d '{"symbol":"BTCUSDT","side":"BUY","type":"MARKET","notional":2000,"leverage":20}'
# { "decision": "BLOCK", "reasons": [...], "payment": { "status": "...", "mode": "..." } }
```

This is a wrapper, not a second risk system. It calls `ControlPlane.evaluateOnly`, which calls the
one `evaluateTrade` in `src/risk/risk-engine.ts`. Proposals are evaluated against Fentra's own
account, positions and policy; a caller cannot supply their own policy, because a verdict produced
under limits the caller chose would not mean anything.

**It cannot trade.** `TradingExecutor.executeTrade` is reachable only from
`ControlPlane.submitProposal`, which this route never calls. Eight differently-shaped inputs assert
it in the test suite.

### Research findings

Recorded before implementing, from the sources below.

**The handshake, and that there are two of them.** The server answers an unpaid request with HTTP
402 and a JSON body; the client retries with a base64-encoded `PaymentPayload` in a header. But v1
and v2 are different documents, not one with fields renamed, and the network decides which you get:

|  | v1 | v2 |
|---|---|---|
| 402 body | `{ x402Version, error, accepts }` | adds a top-level `resource` object |
| price field | `maxAmountRequired` | `amount` |
| resource | inside each `accepts` entry | beside `accepts` |
| network id | name, e.g. `base-sepolia` | CAIP-2, e.g. `eip155:56` |
| header | `X-PAYMENT` | `PAYMENT-SIGNATURE` |
| served by | Base and Solana facilitators | BNB Chain / Binance B402 |

Fentra implements both and accepts either header name. Which one it advertises is one environment
variable. None of this is Fentra's invention; the shapes are transcribed into `src/x402/types.ts`
from the specification, and the v1 request shape was confirmed against a live facilitator.

**Verification is the facilitator's job.** The resource server does not read the chain. It POSTs
`{ x402Version, paymentPayload, paymentRequirements }` to the facilitator's `/verify` and gets back
`{ isValid, invalidReason?, payer? }`. `/settle` has the same request shape and returns
`{ success, transaction, network, ... }`. Fentra implements `/verify` only — see the caveat below.

**What live B402 endpoints actually publish.** Binance's B402 Bazaar is its public discovery layer
for x402-paid endpoints, documented at
`https://www.binance.com/bapi/ramp/v1/public/ramp/b402` and served unauthenticated from Binance's
own domain. Reading the 20 live listings corrected one thing the written v2 spec does not tell you:

```json
{ "resource": "https://…/v1/probability", "x402Version": 2,
  "accepts": [{ "scheme": "eip3009", "network": "eip155:56",
                "asset": "0x8d0D…8B0d", "maxAmountRequired": "10000000000000000",
                "payTo": "0xA8b2…1d68" }] }
```

Every entry names the price **`maxAmountRequired`**, not the v2 spec's `amount`, while still
declaring `x402Version: 2`. Fentra emits both, with the same value, so a client reading either
spelling gets the right number. The listings also confirm `eip155:56`, 18-decimal atomic units,
0.01 as the going rate, and two schemes in production use — `permit2-exact` and `eip3009` — across
USDC (`0x8AC7…580d`), USDT (`0x55d3≥955`), USD1 (`0x8d0D…8B0d`) and U (`0xcE24♦6`).

Treat that as corroboration, not as the contract: those listings are what third-party merchants
publish, and the authority on what the facilitator *accepts* is Binance's own `/supported`
endpoint, which is not reachable without the API key its product page tells you to apply for.

**Settlement is USDC on BNB Chain.** Binance x402 is a BNB-Chain payment flow (`eip155:56`) over
off-chain authorization and on-chain settlement, with the facilitator sponsoring gas, so neither
buyer nor merchant needs BNB. BSC tokens do not implement EIP-3009, so the standard `exact` scheme
does not apply there; Binance uses a Permit2-based scheme (`permit2-exact`) with EIP-712 typed-data
signatures. Note that Binance-Peg USDC on BSC is **18-decimal**, not 6-decimal as on Ethereum, so
$0.01 is `10000000000000000` atomic units — computed in `BigInt`, never in a JS number.

**Any x402 client works.** A Binance Agentic Wallet is not required on the paying side. Trust Wallet
AgentKit supports Binance x402 natively and Binance's Agentic Wallet is being added, but the payer
only has to produce a valid signed authorization for the advertised scheme.

Sources: [x402.org](https://www.x402.org) ·
[x402 specification](https://github.com/coinbase/x402/tree/main/specs) ·
[Binance x402](https://www.binance.com/binancex402) ·
[Binance onchainpay-x402 docs](https://developers.binance.com/docs/onchainpay-x402/b402-bazaar) ·
[B402 Bazaar, read live](https://www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar/search) ·
[Binance Agentic Hub](https://web3.binance.com/agentic-hub)

### LIVE MODE and DEMO MODE

The endpoint always requires payment. There is no free tier and no bypass: an absent, malformed,
mismatched or underpaying header returns 402 and the risk engine is never entered. What differs
between the two modes is only whether the payment is *verified*.

| | LIVE MODE | DEMO MODE |
|---|---|---|
| Trigger | `FENTRA_X402_FACILITATOR_URL` **and** `FENTRA_X402_PAY_TO` both set | anything less (the default) |
| Verification | facilitator `/verify` | structural checks on the payload only |
| Response | `"payment": { "status": "verified", "mode": "live" }` | `"payment": { "status": "simulated", "mode": "demo" }` |
| `payTo` advertised | the configured merchant address | the zero address |
| Dashboard revenue | USDC total | `Simulated` |

**DEMO MODE never claims a payment happened.** The response carries an explicit note that nothing
was verified on-chain and no USDC was transferred, the 402 payment requirements carry the same
caveat, no transaction hash is fabricated, and the dashboard panel says "Demo mode" and "Payment
simulated" on every row. Tests assert each of those.

Fentra ships in DEMO MODE. Binance's V2 x402 APIs are reached through an approved partner developer
account — `clientId` / `accessToken` with RSA-signed `X-Tesla-*` headers — which is not something a
hackathon can obtain, so rather than guess at a credentialled handshake the payment step stops at a
clearly-labelled simulation. Point `FENTRA_X402_FACILITATOR_URL` at any spec-compliant facilitator
and the same code path runs for real; the live path is covered by tests against a mocked facilitator.

### Going live: where the two values come from

Two settings flip DEMO MODE to LIVE MODE. Neither is a secret, and neither is a
private key — Fentra only ever needs a public receiving address.

**`FENTRA_X402_PAY_TO` — your merchant address.** Any wallet address you control.
Make a fresh one (MetaMask → add account → copy address) and use that; it must
not be a Binance trading account or an execution wallet. Fentra only reads it to
put in the payment requirements, so it never needs the private key.

**`FENTRA_X402_FACILITATOR_URL` — a public x402 facilitator.** These verify and
settle payments so a merchant does not have to touch a chain. Binance Agent OS
x402 covers BNB Chain (Binance's own B402 facilitator), Base and Solana (via
third-party facilitators). What each one actually serves, checked live:

| Facilitator | Networks | Generation | Key needed | Status |
|---|---|---|---|---|
| `https://x402.org/facilitator` | Base Sepolia | v1 `exact` + v2 | no | live, **verified working** |
| `https://facilitator.x402.rs` | 12 testnets incl. BSC testnet `eip155:97` | v1 base-sepolia; v2 elsewhere | no | live |
| `https://facilitator.b402.ai` | BSC mainnet + testnet | — | no | **offline** (no DNS) |
| Binance `/papi/v2/b402/*` | BNB Chain | v2 `permit2-exact` | partner `clientId` + RSA signing | gated |

Fentra defaults to the BNB Chain v2 rails because that is the production target,
but the combination that settles today is **v1 `exact` on Base Sepolia**. Setting
`FENTRA_X402_PROTOCOL_VERSION=1` switches the whole rail — network, scheme, asset
and decimals — in one variable; each field stays individually overridable.

```bash
FENTRA_X402_PROTOCOL_VERSION=1
FENTRA_X402_FACILITATOR_URL=https://x402.org/facilitator
FENTRA_X402_PAY_TO=0xYourReceivingAddress
```

That is the whole configuration. It yields `scheme: exact`, `network:
base-sepolia`, `asset: 0x036CbD…F7e` (Base Sepolia USDC) and
`maxAmountRequired: "10000"` — 0.01 USDC at six decimals.

### Paying for real

```bash
npm run x402:pay -- http://localhost:3000/api/risk/check --notional 2000 --leverage 20
```

`scripts/x402-pay.mjs` is the client side of the handshake — the external agent.
It uses the official `x402-fetch` package rather than signing anything by hand,
so the payment is produced exactly as the protocol specifies.

Set `X402_PAYER_PRIVATE_KEY` to a **throwaway** test key first. The wallet needs
Base Sepolia USDC from [faucet.circle.com](https://faucet.circle.com) and nothing
else: the `exact` scheme is gasless for the payer, because the facilitator
submits the transfer and pays the gas.

Verified against the live Coinbase facilitator with an unfunded wallet:

```
Unpaid request  -> HTTP 402      server states its price
Payer      0x1566…D9eD           client signs an EIP-3009 authorization
Paid request    -> HTTP 402      facilitator checked the chain and refused:
                                 invalid_exact_evm_insufficient_balance
```

Every step of the handshake ran — the 402, the signature, the `X-PAYMENT` retry,
the facilitator round trip, the on-chain check, and Fentra failing closed. The
only missing ingredient was USDC in the wallet. Fund it and the same run returns
a verdict with `"payment": { "status": "verified", "mode": "live" }`.

### Caveats

- **Verification, not settlement.** Fentra calls `/verify`, which proves a payment authorization is
  valid, and does not call `/settle`, which is what actually broadcasts the transfer. Every response
  says `"settled": false`. Wiring settlement is the next step and is deliberately not guessed at.
- **Confirm the asset before going live.** The default asset address and 18-decimal assumption are
  the documented Binance-Peg USDC values on BSC. Check them against the facilitator's `/supported`
  endpoint before pointing this at real money.
- Failure is closed in every direction: an unreachable facilitator, a non-200 reply and an
  unrecognised response body are all treated as unpaid.

### Discovery

`/agents` is the integration page: copy-ready x402 and MCP snippets, the live payment terms, and a
button that fires a genuine unpaid request so a visitor can see the real 402 without a wallet.
`/llms.txt` is the same contract as plain text, following the convention for docs an agent can read
without parsing a rendered page.

Both derive every value from the running configuration rather than hardcoding it, so the price,
network, mode and `payTo` on the page are the ones a caller will actually be charged and verified
against. The snippets also carry whatever origin the page was served from, so tunnelling the server
to a public URL makes them copy-paste correct with no edit — and the page says so plainly when the
origin is localhost and therefore unreachable.

This is documentation, not a directory. It describes one endpoint and advertises nothing else.

### Why the log has its own endpoint

`/api/x402/log` exists so the dashboard panel does not depend on Binance. `/api/state` fetches the
account, positions and quotes, so it fails whenever the venue is unreachable or the local clock
drifts outside the signature window (`-1021`) — and the dashboard keeps its last good state when a
poll fails. Serving the payment log from there meant an exchange timeout could silently freeze it.
This route reads process memory and nothing else.

A useful consequence: the x402 feature now modifies no core file at all. `/api/state` and
`ui/types.ts` are byte-identical to their pre-feature versions.

### Keys stay out of it

The merchant receiving address is its own variable and is never Fentra's trading account.
`src/x402/config.ts` does not read `BINANCE_API_KEY` or `BINANCE_API_SECRET`, so the payment path
and the execution path share no credential. The facilitator API key is read in one function in
`src/x402/facilitator.ts` and never reaches a response body. The LLM has no tool that touches any of
it — `src/agent/tools.ts` and `src/mcp/server.ts` do not import `@/x402` at all, which is asserted
in the tests.

---

## Tests

```bash
npm test
```

142 tests. Beyond per-rule coverage, the ones that matter most use a spy executor to prove the
absence of an execution call:

- `BLOCK: never calls the execution adapter`
- `HALT: never calls the execution adapter`
- `latches the breaker and refuses every later trade, including compliant ones`
- `keeps the breaker latched even after equity recovers`
- `a tightened policy blocks a trade that previously passed`
- `halts on polling alone, before any trade is proposed`
- `adopts the first observed equity as the high-water mark when none is known`
- `exposes exactly three read-only tools and no way to trade` (MCP)
- `never calls the executor when checking a trade` (MCP)
- `never calls executeTrade for ...` — eight input shapes against the paid x402 endpoint
- `verifies payment before the risk engine runs` (x402)
- `uses the real evaluateTrade rather than duplicated risk logic` (x402)
- `labels the payment as simulated, never as verified` (x402 demo mode)
- `emits a v1 402 document, not a v2 one` and `sends v1-shaped requirements to the facilitator`
- `publishes the price under both names, as live B402 listings do` (B402 interop)

"The trade was blocked" is proved by the executor never being called, not by a status string.

The live Binance path is validated without credentials: `buildSignedQuery` is asserted against the
HMAC-SHA256 key/secret/signature example published in the Binance REST documentation, and
credential loading is asserted to default to testnet and to require an explicit `BINANCE_TESTNET=false`
to reach the live host.

```bash
npm run check:binance   # read-only credential check; never places an order
```

Verifies the key authenticates, reports balance and clock skew, and decodes Binance error codes
(`-2015` permissions/IP, `-1022` bad secret, `-1021` clock drift) before you launch the app.

---

## Limitations

Stated plainly, since this is a hackathon MVP:

- State is process-local (no database). One operator, one server process; restarting resets it.
- The live executor covers USDⓈ-M futures market and limit orders. Spot, margin and convert are
  modelled in the type system but not implemented against the live API.
- Venue leverage caps used by sanity validation are a conservative static table, not a live
  leverage-bracket lookup. The user policy is the tighter constraint in practice.
- Live-mode intraday high-water mark starts from the first equity reading after the process
  starts, because Binance does not expose an intraday peak. The drawdown scenario therefore stages
  its precondition by raising that mark relative to whatever the account is actually worth, rather
  than overriding the balance — so it demonstrates the breaker in Demo Mode and on the futures
  testnet without ever displaying an invented equity figure. It is refused against a real-funds
  account, where a fabricated drawdown must not drive a live risk decision.
- The x402 endpoint verifies payments but does not settle them, and ships in DEMO MODE by
  default; see "Public risk API" above for exactly what that does and does not claim. LIVE MODE
  is proven against a public facilitator on Base Sepolia. BNB Chain mainnet needs Binance's
  partner-credentialled B402 API, which a hackathon cannot obtain.

---

## License

MIT — see [LICENSE](LICENSE).

Note the warranty disclaimer in particular. Fentra can place real orders when Binance credentials
are configured; it is provided as is, with no warranty, and the authors are not liable for trading
losses. Run it against the futures testnet unless you have decided otherwise deliberately.
