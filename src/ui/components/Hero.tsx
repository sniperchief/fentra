"use client";

import Link from "next/link";
import type { AppState } from "@/ui/types";
import { Pipeline } from "./Pipeline";
import { Label } from "./primitives";

/**
 * Landing hero.
 *
 * The pipeline here is a diagram of the execution path, drawn in its idle
 * state — the live one lives in the console. Venue and agent labels come
 * from the server when a status probe succeeded, and fall back to generic
 * wording rather than claiming a connection that was never confirmed.
 */
export function Hero({ state }: { state: AppState | null }) {
  return (
    <section className="relative overflow-hidden border-b border-line bg-canvas">
      <div className="grid-field grid-fade pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative mx-auto max-w-[1560px] px-4 pb-12 pt-14 sm:px-6 sm:pt-24">
        <div className="flex items-center gap-2">
          <span className="h-[5px] w-[5px] animate-dot-pulse rounded-full bg-accent" />
          <span className="font-mono text-[11px] uppercase tracking-label text-accent">
            Risk control plane · Binance Agent OS
          </span>
        </div>

        {/* Caps run wider than sentence case, so the ramp steps down a size
            and the tracking opens up to match. */}
        <h1 className="mt-6 text-[36px] font-semibold uppercase leading-[1.02] tracking-[-0.02em] text-ink sm:text-[54px] lg:text-[66px]">
          AI can act.
          <br />
          <span className="text-accent">Fentra sets the limits.</span>
        </h1>

        <p className="mt-7 max-w-[44ch] text-[17px] font-medium leading-snug text-ink sm:text-[19.5px]">
          The deterministic risk layer between autonomous AI agents and financial execution.
        </p>

        <p className="mt-4 max-w-[58ch] text-[16px] leading-relaxed text-ash sm:text-[17px]">
          Fentra evaluates every proposed trade against your risk policy, live account state, and
          market conditions — before it reaches Binance.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/app"
            className="border border-ink bg-ink px-6 py-3 font-mono text-[12.5px] uppercase tracking-label text-white transition-colors hover:bg-ink/85"
          >
            Run Console
          </Link>
          <a
            href="#how-it-works"
            className="border border-line bg-paper px-6 py-3 font-mono text-[12.5px] uppercase tracking-label text-ink/70 transition-colors hover:border-ink/40 hover:text-ink"
          >
            How it works
          </a>
        </div>

        {/* The system, as one picture. */}
        <div className="mt-14 border border-line bg-paper shadow-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 sm:px-5">
            <Label className="text-accent">Execution path</Label>
            <span className="font-mono text-[10.5px] uppercase tracking-label text-faint">
              one route · no bypass
            </span>
          </div>
          <Pipeline
            stage="IDLE"
            decision={null}
            agentLabel={
              state ? (state.agentConfigured ? state.agentModel : "deterministic proposer") : "trading agent"
            }
            venueLabel={
              state ? state.connection.venue.replace("_", " ").toLowerCase() : "usdⓈ-m futures"
            }
            venueConnected={state?.connection.connected ?? false}
            halted={state?.snapshot.account.tradingHalted ?? false}
          />
          <p className="border-t border-line px-4 py-3 text-[13px] leading-relaxed text-faint sm:px-5">
            The agent proposes. Application code decides. There is no edge from the agent to the
            exchange that does not pass through the gate.
          </p>
        </div>
      </div>
    </section>
  );
}
