"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Hero } from "@/ui/components/Hero";
import { HowItWorks } from "@/ui/components/HowItWorks";
import { StatusStrip, TopBar } from "@/ui/components/Shell";
import { Label } from "@/ui/components/primitives";
import type { AppState } from "@/ui/types";
import type { X402Mode } from "@/x402/config";

/**
 * The landing page: what Fentra is and how it works.
 *
 * It carries no application surface — no agent, no proposals, no verdicts.
 * Those live at /app. The one live thing here is the system status strip,
 * read once from /api/state so the page reports the real venue rather than
 * asserting a connection.
 */
export default function Landing() {
  const [state, setState] = useState<AppState | null>(null);
  // Read separately from /api/state, which depends on Binance being reachable.
  const [x402Mode, setX402Mode] = useState<X402Mode | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/state", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setState(d);
      })
      .catch(() => undefined);
    fetch("/api/x402/log", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setX402Mode(d.mode as X402Mode);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <TopBar cta={{ label: "Run Console", href: "/app" }} />

      <Hero state={state} />

      {/* Live system status. Rendered only once the probe has answered. */}
      {state ? (
        <section className="border-b border-line">
          <div className="mx-auto max-w-[1560px] px-4 py-10 sm:px-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-center gap-2">
                <span aria-hidden className="h-[9px] w-[2px] bg-accent" />
                <Label className="text-accent">System status</Label>
              </div>
              <span className="font-mono text-[11px] uppercase tracking-label text-faint">
                live from the running instance
              </span>
            </div>
            <StatusStrip state={state} stage="IDLE" />
          </div>
        </section>
      ) : null}

      <HowItWorks x402Mode={x402Mode} />

      <footer className="mx-auto max-w-[1560px] px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-[70ch] text-[13px] leading-relaxed text-faint">
            The agent proposes; application code decides. The model has no tool that places an order,
            changes leverage, or edits the risk policy — execution is reachable only through the
            control plane after an ALLOW verdict.
          </p>
          <div className="flex items-center gap-4">
            <Link
              href="/app"
              className="font-mono text-[11px] uppercase tracking-label text-ink/70 underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              Run Console
            </Link>
            <span className="font-mono text-[11px] uppercase tracking-label text-faint">
              Binance Agent OS · Track A
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
