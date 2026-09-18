"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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

type NavItem = (typeof NAV)[number];

function isActive(item: NavItem, pathname: string): boolean {
  if (!("match" in item)) return false;
  return item.match === "/" ? pathname === "/" : pathname.startsWith(item.match);
}

/** Inline desktop navigation. Hidden below `md`, where the menu takes over. */
function Nav() {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {NAV.map((item) => {
        const active = isActive(item, pathname);
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

/** Two-state icon: three bars when closed, a cross when open. */
function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {open ? (
        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      )}
    </svg>
  );
}

/**
 * Shared masthead. The landing page passes no state and a CTA into the
 * console; the console passes live state and a link back to the overview.
 *
 * Desktop shows everything inline. Below `md` the header carries only the
 * wordmark and a menu button, and every link, the CTA and the venue status
 * move into a menu that fills the screen beneath it. The header is sticky, so
 * the menu is reachable from anywhere on the page.
 */
export function TopBar({
  state = null,
  cta,
}: {
  state?: AppState | null;
  cta: { label: string; href: string; primary?: boolean };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const connection = state?.connection;
  const demo = connection?.venue === "DEMO";

  // Close on navigation. A link to `/#how-it-works` does not change the
  // pathname when already on `/`, so the links also close the menu on click.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const ctaClass =
    cta.primary === false
      ? "border-line bg-paper text-ink/70 hover:border-ink/40 hover:text-ink"
      : "border-ink bg-ink text-white hover:bg-ink/85";

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1560px] items-center gap-4 px-4 sm:px-6">
        {/* Equal-weight flanks on desktop, so the nav sits centred in the
            header rather than merely after the wordmark. */}
        <div className="flex min-w-0 flex-1 items-center">
          <Link href="/" className="flex shrink-0 items-center">
            <Wordmark />
          </Link>
        </div>

        <Nav />

        <div className="hidden min-w-0 flex-1 items-center justify-end gap-3 md:flex">
          {demo ? (
            <span
              title={connection?.detail}
              className="border border-line px-2 py-[5px] font-mono text-[10.5px] uppercase tracking-label text-mute"
            >
              Demo mode
            </span>
          ) : null}
          {connection ? (
            <span
              title={connection.detail}
              className="flex items-center gap-1.5 border border-line bg-paper px-2.5 py-[5px] font-mono text-[11px] uppercase tracking-label text-ink/70"
            >
              <Dot tone={connection.connected ? "ok" : demo ? "neutral" : "warn"} pulse />
              <span>{connection.label}</span>
            </span>
          ) : null}
          <Link
            href={cta.href}
            className={`border px-4 py-2 font-mono text-[11px] uppercase tracking-label transition-colors ${ctaClass}`}
          >
            {cta.label}
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-ink md:hidden"
        >
          <MenuIcon open={open} />
        </button>
      </div>

      {open ? (
        <div
          id="mobile-menu"
          className="absolute inset-x-0 top-full flex h-[calc(100dvh-3.5rem)] flex-col overflow-y-auto bg-canvas md:hidden"
        >
          <nav className="flex flex-col px-5 pt-2">
            {NAV.map((item) => {
              const active = isActive(item, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between border-b border-hair py-5 font-mono text-[15px] uppercase tracking-label ${
                    active ? "text-ink" : "text-mute"
                  }`}
                >
                  {item.label}
                  {active ? <span aria-hidden className="h-[7px] w-[7px] bg-accent" /> : null}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto space-y-4 border-t border-line px-5 pb-8 pt-5">
            {connection ? (
              <div
                title={connection.detail}
                className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-label text-ink/70"
              >
                <Dot tone={connection.connected ? "ok" : demo ? "neutral" : "warn"} pulse />
                {connection.label}
              </div>
            ) : null}
            <Link
              href={cta.href}
              onClick={() => setOpen(false)}
              className={`block border px-4 py-4 text-center font-mono text-[12.5px] uppercase tracking-label transition-colors ${ctaClass}`}
            >
              {cta.label}
            </Link>
          </div>
        </div>
      ) : null}
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
