/**
 * Executor selection.
 *
 * Credentials present -> live Binance executor. Absent -> demo executor.
 * There is no third path, so the application can never end up in a state where
 * it believes it is connected to Binance without credentials behind it.
 */

import { BinanceExecutor } from "./binance-executor";
import {
  DemoExecutor,
  resetPositions,
  seedPortfolio,
  type DemoPortfolio,
} from "./demo-executor";
import type { TradingExecutor } from "./types";

export { DemoExecutor, BinanceExecutor, seedPortfolio, resetPositions };
export type { TradingExecutor, DemoPortfolio };

export function createExecutor(demoPortfolio: DemoPortfolio): TradingExecutor {
  return BinanceExecutor.fromEnv() ?? new DemoExecutor(demoPortfolio);
}
