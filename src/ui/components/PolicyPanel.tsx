"use client";

import { useEffect, useState } from "react";
import type { OrderNotionalMode, RiskPolicy } from "@/risk/types";
import { Button, Label, Panel, Status } from "./primitives";

/** Only the numeric limits are edited as fields; the mode has its own control. */
type NumericPolicyKey = Exclude<keyof RiskPolicy, "maxOrderNotionalMode">;

interface Field {
  key: NumericPolicyKey;
  label: string;
  /** Percent fields are stored as fractions and edited as whole percents. */
  kind: "pct" | "x" | "usd";
  step: number;
  min: number;
  max: number;
  note: string;
}

const FIELDS: Field[] = [
  {
    key: "maxPositionSizePct",
    label: "Max position",
    kind: "pct",
    step: 1,
    min: 1,
    max: 100,
    note: "of equity, per symbol",
  },
  {
    key: "maxLeverage",
    label: "Max leverage",
    kind: "x",
    step: 1,
    min: 1,
    max: 125,
    note: "order and account",
  },
  {
    key: "maxDailyDrawdownPct",
    label: "Max daily drawdown",
    kind: "pct",
    step: 0.5,
    min: 0.5,
    max: 50,
    note: "halts the trading day",
  },
  {
    key: "maxPriceDeviationPct",
    label: "Max price deviation",
    kind: "pct",
    step: 0.5,
    min: 0.1,
    max: 50,
    note: "limit price vs mark",
  },
];

/** The order cap is edited separately, because its unit is switchable. */
const NOTIONAL_FIELD: Record<OrderNotionalMode, Field> = {
  ABSOLUTE: {
    key: "maxOrderNotional",
    label: "Max order notional",
    kind: "usd",
    step: 100,
    min: 10,
    max: 1000000,
    note: "flat USDT ceiling",
  },
  PCT_OF_EQUITY: {
    key: "maxOrderNotional",
    label: "Max order notional",
    kind: "pct",
    step: 1,
    min: 0.1,
    max: 100,
    note: "scales with equity",
  },
};

const toDisplay = (f: Field, policy: RiskPolicy) =>
  f.kind === "pct" ? Number((policy[f.key] * 100).toFixed(2)) : policy[f.key];

const toStored = (f: Field, value: number) => (f.kind === "pct" ? value / 100 : value);

export function PolicyPanel({
  policy,
  equity,
  onSaved,
}: {
  policy: RiskPolicy;
  /** Live equity, used to preview what a percentage cap resolves to. */
  equity: number;
  onSaved: (p: RiskPolicy) => void;
}) {
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<OrderNotionalMode>(policy.maxOrderNotionalMode);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const notionalField = NOTIONAL_FIELD[mode];
  const allFields = [...FIELDS, notionalField];

  // Re-sync when the server policy changes underneath us.
  useEffect(() => {
    setMode(policy.maxOrderNotionalMode);
    const f = NOTIONAL_FIELD[policy.maxOrderNotionalMode];
    setDraft({
      ...Object.fromEntries(FIELDS.map((x) => [x.key, toDisplay(x, policy)])),
      maxOrderNotional: toDisplay(f, policy),
    });
  }, [policy]);

  const dirty =
    mode !== policy.maxOrderNotionalMode ||
    allFields.some((f) => draft[f.key] !== toDisplay(f, policy));

  /** What a percentage cap works out to at current equity. */
  const resolved = mode === "PCT_OF_EQUITY" ? (equity * (draft.maxOrderNotional ?? 0)) / 100 : null;

  function switchMode(next: OrderNotionalMode) {
    if (next === mode) return;
    // Carry the value across as its equivalent, so the number on screen keeps
    // meaning the same thing rather than jumping.
    const converted =
      next === "PCT_OF_EQUITY"
        ? equity > 0
          ? Number((((draft.maxOrderNotional ?? 0) / equity) * 100).toFixed(2))
          : 10
        : Math.round(equity * ((draft.maxOrderNotional ?? 0) / 100));
    setMode(next);
    setDraft((d) => ({ ...d, maxOrderNotional: converted }));
  }

  async function save() {
    setSaving(true);
    setFailed(false);
    const patch: Partial<RiskPolicy> = { maxOrderNotionalMode: mode };
    for (const f of allFields) {
      patch[f.key] = toStored(f, Number(draft[f.key]));
    }
    try {
      const res = await fetch("/api/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = res.ok ? await res.json().catch(() => null) : null;
      // Only the server answer is adopted. A failed save leaves the panel dirty
      // rather than displaying limits the engine is not actually enforcing.
      if (data?.policy) onSaved(data.policy);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      label="Risk Policy"
      className="flex-1"
      bodyClassName="p-0"
      meta={
        dirty ? (
          <>
            {failed ? <Status tone="crit">Not applied</Status> : null}
            <Button onClick={save} disabled={saving} variant="primary" className="py-1">
              {saving ? "Applying…" : failed ? "Retry" : "Apply"}
            </Button>
          </>
        ) : (
          <Status tone="ok">Active</Status>
        )
      }
    >
      <div className="divide-y divide-hair">
        {FIELDS.map((f) => (
          <PolicyRow
            key={f.key}
            field={f}
            value={draft[f.key] ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
          />
        ))}

        {/* Order cap: same row shape, plus a unit switch. */}
        <div className="px-5 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <Label className="text-ink/60">{notionalField.label}</Label>
              <div className="mt-1 font-mono text-[11px] text-faint">{notionalField.note}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <div className="flex border border-line">
                {(["ABSOLUTE", "PCT_OF_EQUITY"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchMode(m)}
                    title={
                      m === "ABSOLUTE"
                        ? "Fixed USDT ceiling"
                        : "Percentage of equity — scales with the account"
                    }
                    className={`px-2 py-1 font-mono text-[11.5px] transition-colors ${
                      mode === m ? "bg-ink text-white" : "text-mute hover:text-ink"
                    }`}
                  >
                    {m === "ABSOLUTE" ? "$" : "%"}
                  </button>
                ))}
              </div>
              <NumberInput
                value={draft.maxOrderNotional ?? ""}
                field={notionalField}
                onChange={(v) => setDraft((d) => ({ ...d, maxOrderNotional: v }))}
              />
              <span className="w-3 font-mono text-[12.5px] text-mute">
                {mode === "PCT_OF_EQUITY" ? "%" : ""}
              </span>
            </div>
          </div>
          {resolved !== null ? (
            <p className="mt-2 text-right font-mono text-[11px] tnum text-faint">
              = ${resolved.toLocaleString("en-US", { maximumFractionDigits: 0 })} at current equity
            </p>
          ) : null}
        </div>
      </div>

      <p className="border-t border-line px-5 py-3 text-[12.5px] leading-relaxed text-faint">
        Enforced in application code on every proposal. The agent can read this policy; it has no
        tool that can change it.
      </p>
    </Panel>
  );
}

function PolicyRow({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: number | "";
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 px-5 py-2.5">
      <span className="min-w-0">
        <Label className="text-ink/60">{field.label}</Label>
        <span className="mt-1 block font-mono text-[11px] text-faint">{field.note}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <NumberInput value={value} field={field} onChange={onChange} />
        <span className="w-3 font-mono text-[12.5px] text-mute">
          {field.kind === "pct" ? "%" : field.kind === "x" ? "x" : ""}
        </span>
      </span>
    </label>
  );
}

function NumberInput({
  value,
  field,
  onChange,
}: {
  value: number | "";
  field: Field;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      step={field.step}
      min={field.min}
      max={field.max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-[96px] border border-line bg-sunken px-2 py-1 text-right font-mono text-[14px] tnum text-ink outline-none transition-colors focus:border-ink/40"
    />
  );
}
