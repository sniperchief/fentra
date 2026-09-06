"use client";

import Link from "next/link";
import { DEFAULT_POLICY } from "@/policy/policy-store";
import type { X402Mode } from "@/x402/config";
import { DECISION_THEME, pct, usd0 } from "@/ui/types";
import { Label } from "./primitives";

/* ------------------------------------------------------------------ *
 * Landing-page explainers. Static content only — no application state,
 * no proposals, no verdicts. The console owns all of that.
 * ------------------------------------------------------------------ */

const STEPS = [
  {
    n: "01",
    title: "The agent proposes",
    body: "A Claude agent reads live market data, account equity, open positions and the active policy, then calls propose_trade. It has no tool that places an order, sets leverage, or edits the policy.",
  },
  {
    n: "02",
    title: "The risk engine evaluates",
    body: "Five deterministic checks run against real account and market state. Every check always runs, so the report shows the whole picture rather than the first failure.",
  },
  {
    n: "03",
    title: "A verdict is produced",
    body: "ALLOW, BLOCK or HALT — computed by a pure function in application code. The proposal is data that gets measured, not an argument that gets weighed.",
  },
  {
    n: "04",
    title: "Only ALLOW executes",
    body: "The Binance adapter is reachable from exactly one place: the branch after an ALLOW verdict. Refused proposals never reach it, and both outcomes are written to the audit log.",
  },
];

const CHECKS = [
  {
    title: "Position size",
    measure: "Exposure in one symbol after the fill, against equity",
    limit: pct(DEFAULT_POLICY.maxPositionSizePct, 0) + " of equity",
  },
  {
    title: "Leverage",
    measure: "Requested order leverage, and account leverage once it fills",
    limit: `${DEFAULT_POLICY.maxLeverage}x`,
  },
  {
    title: "Order notional",
    measure: "Ceiling on a single order, as a flat amount or a share of equity",
    limit: usd0(DEFAULT_POLICY.maxOrderNotional),
  },
  {
    title: "Market sanity",
    measure: "Symbol, size, venue maximum leverage, limit price against the live mark",
    limit: `±${pct(DEFAULT_POLICY.maxPriceDeviationPct, 0)} deviation`,
  },
  {
    title: "Daily drawdown",
    measure: "Intraday fall from the equity high-water mark; latches for the day",
    limit: pct(DEFAULT_POLICY.maxDailyDrawdownPct, 0),
  },
];

const VERDICTS = [
  {
    key: "ALLOW" as const,
    body: "Every check passed. The order is approved and submitted to the exchange adapter.",
  },
  {
    key: "BLOCK" as const,
    body: "A check failed. The order is refused with the rule and the numbers behind it. The executor is never called.",
  },
  {
    key: "HALT" as const,
    body: "The drawdown circuit breaker tripped. Trading stops for the day and every further proposal is refused, compliant or not.",
  },
];

const PRINCIPLES = [
  {
    k: "Deterministic",
    v: "The same proposal, account and policy always produce the same verdict. No model takes part in the decision.",
  },
  {
    k: "Non-bypassable",
    v: "There is no prompt, tool call or argument that routes around the gate. The path simply does not exist in the code.",
  },
  {
    k: "Auditable",
    v: "Every proposal is recorded with the checks it passed or failed, whether or not it ever reached the exchange.",
  },
];

export function HowItWorks({ x402Mode }: { x402Mode?: X402Mode }) {
  const paymentSample =
    x402Mode === "live"
      ? '{ "status": "verified", "mode": "live" }'
      : '{ "status": "simulated", "mode": "demo" }';
  return (
    <>
      {/* ---- How it works ------------------------------------------- */}
      <Section id="how-it-works" eyebrow="How it works" title="Four steps, one path">
        <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-paper px-5 py-5">
              <span className="font-mono text-[12.5px] tnum text-accent">{s.n}</span>
              <h3 className="mt-3 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                {s.title}
              </h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-ash">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ---- The checks --------------------------------------------- */}
      <Section
        eyebrow="Risk policy"
        title="Five checks on every proposal"
        lede="The policy is yours to set. These are the defaults the console starts from — each one editable at runtime, each one enforced identically in demo and live mode."
      >
        <div className="border border-line bg-paper">
          <div className="hidden grid-cols-[200px_minmax(0,1fr)_170px] gap-4 border-b border-line px-5 py-2.5 sm:grid">
            <Label>Check</Label>
            <Label>What it measures</Label>
            <Label>Default limit</Label>
          </div>
          <div className="divide-y divide-hair">
            {CHECKS.map((c) => (
              <div
                key={c.title}
                className="grid gap-2 px-5 py-3.5 sm:grid-cols-[200px_minmax(0,1fr)_170px] sm:items-baseline sm:gap-4"
              >
                <span className="font-mono text-[14px] uppercase tracking-label text-ink">
                  {c.title}
                </span>
                <span className="text-[14.5px] leading-relaxed text-ash">{c.measure}</span>
                <span className="font-mono text-[15px] tnum text-accent">{c.limit}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ---- The three verdicts ------------------------------------- */}
      <Section
        eyebrow="Outcomes"
        title="Three verdicts, one of them final"
        lede="A blocked trade is one refusal. A halt stops the trading day. The interface never lets those two read the same."
      >
        <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
          {VERDICTS.map((v) => {
            const theme = DECISION_THEME[v.key];
            return (
              <div key={v.key} className={`bg-paper px-5 py-5 border-l-2 ${theme.border}`}>
                <div className={`font-mono text-[28px] font-semibold leading-none ${theme.text}`}>
                  {v.key}
                </div>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ash">{v.body}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---- Why it holds ------------------------------------------- */}
      <Section eyebrow="Guarantees" title="Why the agent cannot route around it">
        <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div key={p.k} className="bg-paper px-5 py-5">
              <Label className="text-ink/60">{p.k}</Label>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-ash">{p.v}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ---- Paid verdict endpoint (x402) --------------------------- */}
      <Section
        eyebrow="Paid endpoint · x402"
        title="Any agent can buy a verdict"
        lede="POST a proposed trade to /api/risk/check, pay 0.01 USDC on BNB Chain over x402, and receive the same deterministic decision Fentra applies to its own agent. Advisory only — it never executes and never touches history."
      >
        <div className="border border-line bg-paper">
          <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
            <Label>POST /api/risk/check</Label>
            <span className="font-mono text-[10.5px] uppercase tracking-label text-faint">
              0.01 USDC · read-only · no order placed
            </span>
          </div>
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed text-ash">
{`POST /api/risk/check            → 402 Payment Required
  { "x402Version": 2, "accepts": [{ "amount": "0.01 USDC",
    "network": "eip155:56", "scheme": "permit2-exact" }] }

POST /api/risk/check            ← PAYMENT-SIGNATURE: <base64>
{ "symbol": "BTCUSDT", "side": "BUY", "type": "MARKET",
  "notional": 2000, "leverage": 10 }

→ { "decision": "BLOCK",
    "reasons": ["Leverage: Requested 10x exceeds the 5x policy limit."],
    "payment": ${paymentSample},
    "executed": false }`}
          </pre>
          <div className="border-t border-line px-5 py-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-label text-faint">
              {x402Mode === "live"
                ? "Live mode · payment verified by an x402 facilitator"
                : x402Mode === "demo"
                  ? "Demo mode · payment simulated, no USDC transferred"
                  : "Payment required"}{" "}
              · GET /api/risk/check/info
            </span>
          </div>
        </div>
      </Section>

      {/* ---- Closing CTA -------------------------------------------- */}
      <section className="border-t border-line bg-paper">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-6 px-4 py-12 sm:px-6">
          <div>
            <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[37px]">
              Every trade evaluated.
              <br />
              <span className="text-accent">Nothing bypasses policy.</span>
            </h2>
            <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-ash">
              Open the console to watch a proposal move through the gate — allowed, blocked, or
              stopped by the circuit breaker.
            </p>
          </div>
          <Link
            href="/app"
            className="border border-ink bg-ink px-6 py-3 font-mono text-[12.5px] uppercase tracking-label text-white transition-colors hover:bg-ink/85"
          >
            Run Console
          </Link>
        </div>
      </section>
    </>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-b border-line scroll-mt-14">
      <div className="mx-auto max-w-[1560px] px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-[9px] w-[2px] bg-accent" />
          <Label className="text-accent">{eyebrow}</Label>
        </div>
        <h2 className="mt-4 max-w-[24ch] text-[28px] font-semibold leading-[1.08] tracking-[-0.028em] text-ink sm:text-[37px]">
          {title}
        </h2>
        {lede ? (
          <p className="mt-4 max-w-[62ch] text-[15.5px] leading-relaxed text-ash">{lede}</p>
        ) : null}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}
