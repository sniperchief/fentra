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

```
POST /api/risk/check
{ "trade": { "symbol": "BTCUSDT", "side": "BUY", "type": "MARKET",
             "notional": 2000, "leverage": 20, "market": "USDM_FUTURES" } }
```

Returns the same deterministic verdict Fentra applies to its own agent, so another AI agent can
ask "should I make this trade?" before acting. Read-only: it never executes and never touches
history.

Setting `FENTRA_X402_PRICE_USDC` gates the endpoint with an HTTP 402 and an x402-shaped payment
requirements body. **Payment verification requires a facilitator, which is not wired up**, so with
a price set the endpoint gates rather than settles. It is off by default and never reports a
payment as received.

---

## Tests

```bash
npm test
```

81 tests. Beyond per-rule coverage, the ones that matter most use a spy executor to prove the
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
  starts, because Binance does not expose an intraday peak. A consequence is that the drawdown
  circuit breaker cannot be demonstrated against a live account without actually losing money —
  the seeded scenario runs in Demo Mode, where staging a drawdown does not misstate a real balance.
- The x402 endpoint gates but does not settle payments.
