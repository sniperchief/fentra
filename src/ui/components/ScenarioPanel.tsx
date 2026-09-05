"use client";

import type { ScenarioSummary } from "@/ui/types";
import { DECISION_THEME } from "@/ui/types";
import { Button, Panel } from "./primitives";

/**
 * Seeded proofs. Each one submits a real proposal through the same control
 * plane the agent uses, so the verdict on screen is produced, not scripted.
 */
export function ScenarioPanel({
  scenarios,
  onRun,
  busy,
  onReset,
}: {
  scenarios: ScenarioSummary[];
  onRun: (id: string) => void;
  busy: string | null;
  onReset: () => void;
}) {
  return (
    <Panel
      label="Proof Scenarios"
      className="flex-1"
      bodyClassName="p-0"
      meta={
        <Button onClick={onReset} variant="quiet" className="py-1">
          Reset session
        </Button>
      }
    >
      <div className="divide-y divide-hair">
        {scenarios.map((s, i) => {
          const theme = DECISION_THEME[s.expected];
          const running = busy === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onRun(s.id)}
              disabled={Boolean(busy)}
              className="group flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-sunken disabled:opacity-50"
            >
              <span className="mt-[2px] font-mono text-[11.5px] tnum text-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium leading-snug text-ink">
                  {s.title}
                </span>
                <span className="mt-1 block text-[13px] leading-relaxed text-faint">
                  {s.summary}
                </span>
              </span>
              <span
                className={`shrink-0 border px-1.5 py-[3px] font-mono text-[10.5px] uppercase tracking-label ${theme.border} ${theme.text}`}
              >
                {running ? "Running" : s.expected}
              </span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-line px-5 py-3 text-[12.5px] leading-relaxed text-faint">
        Expected verdicts are labels on the scenario, not on the outcome. The engine decides.
      </p>
    </Panel>
  );
}
