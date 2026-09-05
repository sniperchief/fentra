"use client";

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ *
 * The Fentra UI kit.
 *
 * Square edges, hairline borders, uppercase mono labels. Everything in
 * the control plane is built from these so the interface reads as one
 * system rather than a collection of cards.
 * ------------------------------------------------------------------ */

export type Tone = "neutral" | "ok" | "warn" | "crit" | "accent" | "idle";

const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-ash",
  ok: "bg-allow",
  warn: "bg-block",
  crit: "bg-halt",
  accent: "bg-accent",
  idle: "bg-faint",
};

const TEXT_TONE: Record<Tone, string> = {
  neutral: "text-ash",
  ok: "text-allow",
  warn: "text-block",
  crit: "text-halt",
  accent: "text-accent",
  idle: "text-mute",
};

/** Small uppercase mono caption used for every field label in the app. */
export function Label({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`block font-mono text-[11px] uppercase leading-none tracking-label text-mute ${className}`}
    >
      {children}
    </span>
  );
}

export function Dot({
  tone = "neutral",
  pulse = false,
  className = "",
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block h-[5px] w-[5px] shrink-0 rounded-full ${DOT_TONE[tone]} ${
        pulse ? "animate-dot-pulse" : ""
      } ${className}`}
    />
  );
}

/** Dot + uppercase state word. The app's only status affordance. */
export function Status({
  tone = "neutral",
  children,
  pulse = false,
  title,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  pulse?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-label ${TEXT_TONE[tone]} ${className}`}
    >
      <Dot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

export function Panel({
  label,
  meta,
  children,
  className = "",
  bodyClassName = "p-5",
  id,
  accent = false,
  titleAccent = false,
}: {
  label: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  /** Marks the panel as structurally important (the risk engine). */
  accent?: boolean;
  /** Accents the title. Reserved for panels on the proposal-to-execution path. */
  titleAccent?: boolean;
}) {
  return (
    <section
      id={id}
      className={`flex flex-col border bg-paper shadow-panel ${
        accent ? "border-ink/25" : "border-line"
      } ${className}`}
    >
      <header
        className={`flex min-h-[46px] shrink-0 items-center justify-between gap-3 border-b px-5 ${
          accent ? "border-ink/15 bg-ink/[0.02]" : "border-line"
        }`}
      >
        <h2
          className={`flex items-center gap-2 font-mono text-[11.5px] font-medium uppercase leading-none tracking-label ${
            titleAccent ? "text-accent" : "text-ink/70"
          }`}
        >
          {titleAccent ? <span aria-hidden className="h-[10px] w-[2px] bg-accent" /> : null}
          {label}
        </h2>
        {meta ? <div className="flex items-center gap-3">{meta}</div> : null}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Label-over-value metric. Values are always monospace and tabular. */
export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
  size = "md",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
}) {
  const sizing =
    size === "lg"
      ? "text-[21px] sm:text-[24px]"
      : size === "sm"
        ? "text-[15px]"
        : "text-[17px] sm:text-[19.5px]";
  const color = tone === "neutral" ? "text-ink" : TEXT_TONE[tone];
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className={`mt-1.5 truncate font-mono ${sizing} font-medium leading-none tnum ${color}`}>
        {value}
      </div>
      {hint ? <div className="mt-1.5 font-mono text-[11.5px] leading-none text-faint">{hint}</div> : null}
    </div>
  );
}

/** A thin proportional bar: observed against its policy limit. */
export function LimitBar({
  ratio,
  tone = "ok",
  animate = true,
}: {
  ratio: number;
  tone?: Tone;
  animate?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return (
    <div className="h-[3px] w-full overflow-hidden bg-hair">
      <div
        className={`h-full origin-left ${DOT_TONE[tone]} ${animate ? "animate-bar-grow" : ""}`}
        style={{ width: `${Math.max(clamped * 100, ratio > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const border =
    tone === "ok"
      ? "border-allow/35 text-allow"
      : tone === "warn"
        ? "border-block/35 text-block"
        : tone === "crit"
          ? "border-halt/40 text-halt"
          : tone === "accent"
            ? "border-accent/35 text-accent"
            : "border-line text-ash";
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-[3px] font-mono text-[10.5px] uppercase leading-none tracking-label ${border} ${className}`}
    >
      {children}
    </span>
  );
}

/** Square, restrained button. Primary is the only filled variant in the app. */
export function Button({
  children,
  onClick,
  type = "button",
  variant = "ghost",
  disabled,
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "ghost" | "quiet";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-ink text-white border-ink hover:bg-ink/85"
      : variant === "quiet"
        ? "border-transparent text-mute hover:text-ink"
        : "border-line bg-paper text-ink/80 hover:border-ink/40 hover:text-ink";
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 border px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-label transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** Empty-state block: consistent voice across every panel. */
export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      <div className="font-mono text-[11.5px] uppercase tracking-label text-mute">{title}</div>
      {body ? (
        <p className="mt-2 max-w-[34ch] text-[14px] leading-relaxed text-faint">{body}</p>
      ) : null}
    </div>
  );
}

/** Leader-dot row: LABEL ......... VALUE. Used in the activity stream. */
export function LeaderRow({
  left,
  right,
  tone = "neutral",
}: {
  left: ReactNode;
  right: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="flex items-baseline gap-2 font-mono text-[12px]">
      <span className="shrink-0 text-ash">{left}</span>
      <span className="rule-dotted h-px min-w-[12px] flex-1 translate-y-[-3px] opacity-70" />
      <span className={`shrink-0 ${TEXT_TONE[tone]}`}>{right}</span>
    </div>
  );
}
