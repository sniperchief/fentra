"use client";

import type { PortfolioSnapshot } from "@/server/control-plane";
import type { RiskPolicy } from "@/risk/types";
import { Label, Metric, Panel, Status } from "./primitives";
import { num, pct, signed, usd, usd0 } from "@/ui/types";

/**
 * Only the figures the risk engine actually consumes. Exchange metrics that
 * play no part in a policy decision are deliberately absent.
 */
export function AccountPanel({
  snapshot,
  policy,
}: {
  snapshot: PortfolioSnapshot;
  policy: RiskPolicy;
}) {
  const { account, markets, positions } = snapshot;
  const halted = account.tradingHalted;
  const ddHot = snapshot.dailyDrawdown > policy.maxDailyDrawdownPct * 0.6;
  // Every quote has to be live before the strip claims live prices; one symbol
  // falling back to a reference price makes the whole row "reference".
  const live = markets.length > 0 && markets.every((m) => m.source === "BINANCE_PUBLIC");

  return (
    <Panel
      label="Account"
      className="flex-1"
      bodyClassName="p-0"
      meta={
        <Status tone={halted ? "crit" : "ok"} pulse={!halted}>
          {halted ? "Halted" : "Trading active"}
        </Status>
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-5 py-5 sm:grid-cols-3">
        <Metric label="Equity" value={usd(account.equity)} size="lg" />
        <Metric
          label="Today's P&L"
          value={signed(snapshot.todayPnl)}
          tone={snapshot.todayPnl >= 0 ? "ok" : "warn"}
          size="lg"
        />
        <Metric
          label="Daily drawdown"
          value={pct(snapshot.dailyDrawdown)}
          tone={halted ? "crit" : ddHot ? "warn" : "neutral"}
          hint={`limit ${pct(policy.maxDailyDrawdownPct, 1)}`}
        />
        <Metric
          label="Peak equity"
          value={usd0(account.peakEquityToday)}
          hint="intraday high-water"
        />
        <Metric label="Open exposure" value={usd0(snapshot.exposure)} />
        <Metric
          label="Account leverage"
          value={`${num(snapshot.accountLeverage, 2)}x`}
          hint={`max ${policy.maxLeverage}x`}
        />
      </div>

      {positions.length > 0 ? (
        <div className="border-t border-hair px-5 py-3">
          <Label>Open positions</Label>
          <div className="mt-2.5 space-y-1.5">
            {positions.map((p) => (
              <div
                key={`${p.symbol}-${p.side}`}
                className="flex items-baseline justify-between gap-2 font-mono text-[12.5px] tnum"
              >
                <span className="text-ink">
                  {p.symbol}{" "}
                  <span className={p.side === "LONG" ? "text-allow" : "text-block"}>{p.side}</span>
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="text-ash">{usd0(p.notional)}</span>
                  <span
                    className={`w-[74px] text-right sm:w-[86px] ${
                      p.unrealizedPnl >= 0 ? "text-allow" : "text-block"
                    }`}
                  >
                    {signed(p.unrealizedPnl)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-hair px-5 py-3">
        <div className="flex items-baseline justify-between">
          <Label>Market</Label>
          <span className="font-mono text-[10.5px] uppercase tracking-label text-faint">
            {live ? "Binance public" : "reference"}
          </span>
        </div>
        <div className="mt-2.5 space-y-1.5">
          {markets.map((m) => (
            <div
              key={m.symbol}
              className="flex items-baseline justify-between gap-2 font-mono text-[12.5px] tnum"
            >
              <span className="text-ash">{m.symbol}</span>
              <span className="flex items-baseline gap-3">
                <span className="text-ink">
                  {m.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </span>
                <span
                  className={`w-[64px] text-right sm:w-[74px] ${
                    m.priceChangePercent >= 0 ? "text-allow" : "text-block"
                  }`}
                >
                  {m.priceChangePercent >= 0 ? "+" : ""}
                  {m.priceChangePercent.toFixed(2)}%
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
