/**
 * A small log of external paid risk checks.
 *
 * Purely a record of API calls: it holds no funds, no keys and no payment
 * material, and nothing reads it to make a decision. It exists so the
 * dashboard can show that agent-to-agent commerce actually happened.
 *
 * Kept in memory on `globalThis` for the same reason the control-plane session
 * is — one process, one demo, no database.
 */

import crypto from "node:crypto";
import type { Decision } from "@/risk/types";
import { x402Config, type X402Mode } from "./config";

export interface X402CheckRecord {
  id: string;
  timestamp: number;
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  leverage: number;
  decision: Decision;
  /** Whether the payment behind this check was real or simulated. */
  mode: X402Mode;
  status: "verified" | "simulated";
  /**
   * Whether the transfer was actually broadcast.
   *
   * Verifying a payment proves the authorization is good and the payer holds
   * the funds. It does not move them — that is what `/settle` does. Recording
   * the two separately is what stops the dashboard reporting money it has not
   * received.
   */
  settled: boolean;
  /** Human-facing price charged for this call, e.g. "0.01". */
  priceUsdc: string;
}

/** How many recent calls the dashboard log keeps. */
const MAX_RECORDS = 25;

declare global {
  // eslint-disable-next-line no-var
  var __fentraX402Ledger: X402CheckRecord[] | undefined;
}

function ledger(): X402CheckRecord[] {
  if (!globalThis.__fentraX402Ledger) globalThis.__fentraX402Ledger = [];
  return globalThis.__fentraX402Ledger;
}

export function recordX402Check(entry: Omit<X402CheckRecord, "id" | "timestamp">): X402CheckRecord {
  const record: X402CheckRecord = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
  const log = ledger();
  log.unshift(record);
  log.length = Math.min(log.length, MAX_RECORDS);
  return record;
}

export function clearX402Ledger(): void {
  globalThis.__fentraX402Ledger = [];
}

export interface X402Summary {
  mode: X402Mode;
  priceUsdc: string;
  assetSymbol: string;
  network: string;
  payTo: string;
  checksToday: number;
  /**
   * Value of payments a facilitator verified today.
   *
   * These are real, signed, funded authorizations — but authorized is not
   * received. Null in demo mode, where nothing was verified at all.
   */
  authorizedUsdc: number | null;
  /**
   * Money actually received, i.e. payments settled on-chain.
   *
   * Fentra verifies but does not call `/settle`, so this is 0 today. It is kept
   * separate from `authorizedUsdc` deliberately: the dashboard must never print
   * an earnings figure for a transfer that was never broadcast.
   */
  revenueUsdc: number;
  recent: X402CheckRecord[];
}

export function x402Summary(): X402Summary {
  const cfg = x402Config();
  const log = ledger();

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = log.filter((r) => r.timestamp >= midnight.getTime());

  const verifiedToday = today.filter((r) => r.status === "verified");
  const settledToday = today.filter((r) => r.settled);
  const price = Number(cfg.priceUsdc);

  return {
    mode: cfg.mode,
    priceUsdc: cfg.priceUsdc,
    assetSymbol: cfg.assetSymbol,
    network: cfg.network,
    payTo: cfg.payTo,
    checksToday: today.length,
    authorizedUsdc: cfg.mode === "live" ? verifiedToday.length * price : null,
    revenueUsdc: settledToday.length * price,
    recent: log.slice(0, 8),
  };
}
