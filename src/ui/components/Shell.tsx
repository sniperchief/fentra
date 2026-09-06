"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppState, Stage } from "@/ui/types";
import { pct, usd } from "@/ui/types";
import { Dot, Label, Status } from "./primitives";

/* ------------------------------------------------------------------ *
 * Application chrome: the wordmark, the live system status strip, and
 * the halt banner. All three read from real server state.
 * ------------------------------------------------------------------ */

export function Wordmark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      className={`font-semibold tracking-[-0.02em] text-ink ${
        size === "sm" ? "text-[17px]" : "text-[19.5px]"
      }`}
    >
      Fen<span className="text-accent">tra</span>
    </span>
  );
}

/**
 * The three destinations, in the order someone meets them.
 *
 * `match` is the pathname that marks an item current. "How it works" is a
 * section of the overview rather than a page of its own, so it has none: it
 * navigates without ever claiming to be the current page.
 */
const NAV = [
  { href: "/", label: "Overview", match: "/" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/agents", label: "Agents", match: "/agents" },
] as const;

/**
 * Primary navigation.
 *
 * Collapses to a horizontally scrollable row on narrow screens rather than a
 * hamburger: three items do not justify a disclosure, and a menu that hides
 * the agent surface would defeat the point of advertising it.
 */
function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {NAV.map((item) => {
        const active =
          "match" in item && item.match !== undefined
            ? item.match === "/"
              ? pathname === "/"
              : pathname.startsWith(item.match)
            : false;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 border-b-2 px-2.5 py-[7px] font-mono text-[11px] uppercase tracking-label transition-colors ${
              active
                ? "border-accent text-ink"
                : "border-transparent text-mute hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Shared masthead. The landing page passes no state and a CTA into the
 * console; the console passes live state and a link back to the overview.
 */
export function TopBar({
  state = null,
  cta,
}: {
  state?: AppState | null;
  cta: { label: string; href: string; primary?: boolean };
}) {
  const connection = state?.connection;
  const demo = connection?.venue === "DEMO";

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1560px] items-center gap-4 px-4 sm:px-6">
        {/* Equal-weight flanks, so the nav sits centred in the header rather
            than merely after the wordmark. Both sides may shrink, which keeps
            the centre honest once the status chip appears. */}
        <div className="flex min-w-0 flex-1 items-center">
          <Link href="/" className="flex items-center">
            <Wordmark />
          </Link>
        </div>

        <Nav />

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
          {demo ? (
            <span
              title={connection?.detail}
              className="hidden border border-line px-2 py-[5px] font-mono text-[10.5px] uppercase tracking-label text-mute sm:inline"
            >
              Demo mode
            </span>
          ) : null}
          {connection ? (
            <span
              title={connection.detail}
              className="flex items-center gap-1.5 border border-line bg-paper px-2.5 py-[7px] font-mono text-[11px] uppercase tracking-label text-ink/70 sm:py-[5px]"
            >
              <Dot tone={connection.connected ? "ok" : demo ? "neutral" : "warn"} pulse />
              <span className="hidden sm:inline">{connection.label}</span>
            </span>
          ) : null}
          <Link
            href={cta.href}
            className={`border px-4 py-2 font-mono text-[11px] uppercase tracking-label transition-colors ${
              cta.primary === false
                ? "border-line bg-paper text-ink/70 hover:border-ink/40 hover:text-ink"
                : "border-ink bg-ink text-white hover:bg-ink/85"
            }`}
          >
            {cta.label}
          </Link>
        </div>
      </div>
    </header>
  );
}

/** The four system states, in the order the pipeline runs. */
export function StatusStrip({
  state,
  stage,
}: {
  state: AppState;
  stage: Stage;
}) {
  const halted = state.snapshot.account.tradingHalted;
  const demo = state.connection.venue === "DEMO";

  const cells = [
    {
      label: "Agent",
      value:
        stage === "PROPOSING"
          ? "Analyzing"
          : state.agentConfigured
            ? "Active"
            : "Fallback",
      tone:
        stage === "PROPOSING"
          ? ("accent" as const)
          : state.agentConfigured
            ? ("ok" as const)
            : ("neutral" as const),
      hint: state.agentConfigured ? state.agentModel : "no API key — deterministic proposer",
    },
    {
      label: "Risk engine",
      value: halted ? "Latched" : "Enforcing",
      tone: halted ? ("crit" as const) : ("ok" as const),
      hint: "Deterministic policy evaluation on every proposal",
    },
    {
      label: "Binance",
      value: state.connection.connected ? "Connected" : demo ? "Demo" : "Unreachable",
      tone: state.connection.connected ? ("ok" as const) : demo ? ("neutral" as const) : ("warn" as const),
      hint: state.connection.detail,
    },
    {
      label: "Execution",
      value: halted ? "Stopped" : "Protected",
      tone: halted ? ("crit" as const) : ("ok" as const),
      hint: "Reachable only through the control plane after an ALLOW verdict",
    },
  ];

  return (
    <div className="grid grid-cols-2 border border-line bg-paper sm:grid-cols-4">
      {cells.map((c, i) => (
        <div
          key={c.label}
          title={c.hint}
          className={`px-4 py-3 ${i % 2 === 1 ? "border-l border-line" : ""} ${
            i < 2 ? "border-b border-line sm:border-b-0" : ""
          } sm:border-l sm:first:border-l-0`}
        >
          <Label>{c.label}</Label>
          <div className="mt-2">
            <Status tone={c.tone} pulse={c.tone !== "neutral"} className="text-[12.5px]">
              {c.value}
            </Status>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The halt state. Deliberately unlike a blocked trade: a blocked trade is one
 * refusal, this stops the trading day.
 */
export function HaltBanner({ state }: { state: AppState }) {
  const { account } = state.snapshot;
  const drawdown = state.snapshot.dailyDrawdown;

  return (
    <div className="animate-fade-up border border-halt bg-halt text-white">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/20 px-4 py-3">
        <span className="font-mono text-[16px] font-semibold uppercase tracking-label">
          Trading halted
        </span>
        <span className="font-mono text-[11.5px] uppercase tracking-label text-white/70">
          Circuit breaker latched for the day
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4">
        {[
          { label: "Peak equity", value: usd(account.peakEquityToday) },
          { label: "Current equity", value: usd(account.equity) },
          { label: "Drawdown", value: pct(drawdown) },
          { label: "Maximum", value: pct(state.policy.maxDailyDrawdownPct) },
        ].map((m) => (
          <div key={m.label}>
            <span className="block font-mono text-[11px] uppercase leading-none tracking-label text-white/55">
              {m.label}
            </span>
            <span className="mt-1.5 block font-mono text-[19.5px] font-medium leading-none tnum">
              {m.value}
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-white/20 px-4 py-3">
        <p className="max-w-4xl text-[13px] leading-relaxed text-white/80">{account.haltReason}</p>
        <p className="mt-2 font-mono text-[11.5px] uppercase tracking-label text-white">
          All new trades are blocked
        </p>
      </div>
    </div>
  );
}
