"use client";

/**
 * The x402 risk API log.
 *
 * A record of external agents paying for a Fentra risk verdict. It shows what
 * was asked, what the engine answered, and — plainly — whether the payment
 * behind it was real. In DEMO MODE the panel says "simulated" on the header,
 * on the revenue figure and on every row, because a simulated payment must
 * never be able to read as a real one.
 */

import { useEffect, useState } from "react";
import type { X402Summary } from "@/x402/ledger";
import { Chip, Empty, Label, Metric, Panel, Status } from "./primitives";
import { clockTime, usd, usd0, DECISION_THEME } from "@/ui/types";

/**
 * Polls its own endpoint rather than reading the shared app state.
 *
 * `/api/state` reaches out to Binance and fails when the venue is unreachable,
 * which would otherwise freeze this panel for reasons that have nothing to do
 * with payments. `/api/x402/log` reads memory only, so the log keeps updating
 * regardless of the exchange.
 */
export function X402Panel() {
  const [x402, setX402] = useState<X402Summary | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/x402/log", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as X402Summary;
        if (alive) setX402(next);
      } catch {
        // A failed poll leaves the last good figures on screen.
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!x402) {
    return (
      <Panel label="x402 risk API" className="w-full">
        <Empty title="Loading external check log" />
      </Panel>
    );
  }

  const demo = x402.mode === "demo";

  return (
    <Panel
      label="x402 risk API"
      meta={
        <>
          <Status tone={demo ? "warn" : "ok"} title={x402.network}>
            {demo ? "Demo mode" : "Live mode"}
          </Status>
          <span className="font-mono text-[11px] uppercase tracking-label text-faint">
            {x402.priceUsdc} {x402.assetSymbol} / check
          </span>
        </>
      }
      className="w-full"
    >
      <div className="grid grid-cols-2 gap-5">
        <Metric label="Checks today" value={x402.checksToday} />
        <Metric
          // "Authorized" not "Revenue": a verified payment is a good signature
          // over available funds, not money received. Only settlement moves it,
          // and Fentra does not settle, so the two are never conflated here.
          label={x402.revenueUsdc > 0 ? "Revenue" : "Authorized"}
          value={
            x402.revenueUsdc > 0
              ? usd(x402.revenueUsdc, 2)
              : x402.authorizedUsdc === null
                ? "Simulated"
                : usd(x402.authorizedUsdc, 2)
          }
          tone={demo ? "idle" : x402.revenueUsdc > 0 ? "ok" : "warn"}
          hint={
            demo
              ? "No payment verified"
              : x402.revenueUsdc > 0
                ? `Settled in ${x402.assetSymbol}`
                : "Verified, not settled"
          }
        />
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <Label>Latest</Label>
        {x402.recent.length === 0 ? (
          <Empty
            title="No external checks yet"
            body="POST a trade proposal to /api/risk/check with an x402 payment header to appear here."
          />
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {x402.recent.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5 border-b border-hair pb-2.5 last:border-0 last:pb-0"
              >
                <span className="font-mono text-[12px] text-ash">
                  {r.symbol} · {r.side} · {usd0(r.notional)} · {r.leverage}x
                </span>
                <span className="flex items-center gap-2">
                  <Chip
                    tone={
                      r.decision === "ALLOW" ? "ok" : r.decision === "BLOCK" ? "warn" : "crit"
                    }
                    className={DECISION_THEME[r.decision].border}
                  >
                    {r.decision}
                  </Chip>
                  <span
                    className={`font-mono text-[11px] uppercase tracking-label ${
                      r.status === "simulated" ? "text-mute" : "text-allow"
                    }`}
                  >
                    {r.status === "simulated"
                      ? "Payment simulated"
                      : r.settled
                        ? `Paid ${r.priceUsdc} ${x402.assetSymbol}`
                        : `Authorized ${r.priceUsdc} ${x402.assetSymbol}`}
                  </span>
                  <span className="font-mono text-[11px] text-faint">{clockTime(r.timestamp)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
        {demo
          ? "Demo mode: payments are simulated for demonstration. No USDC was transferred and no transaction was broadcast."
          : `Live mode: each check was paid for with a real ${x402.assetSymbol} authorization, verified by an x402 facilitator before the risk engine ran. Fentra verifies but does not settle, so the funds were confirmed and committed, not transferred.`}{" "}
        External callers receive a verdict only — this endpoint cannot place an order.
      </p>
    </Panel>
  );
}
