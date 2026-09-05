/**
 * Policy validation.
 *
 * The policy is the only user-writable input to the risk layer, so a malformed
 * or hostile patch must never be able to widen a limit or disable a check.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, applyPolicyPatch } from "@/policy/policy-store";

describe("policy patching", () => {
  it("applies a valid edit", () => {
    const next = applyPolicyPatch(DEFAULT_POLICY, { maxLeverage: 3 });
    expect(next.maxLeverage).toBe(3);
  });

  it("ignores non-numeric values rather than corrupting the limit", () => {
    const next = applyPolicyPatch(DEFAULT_POLICY, {
      maxLeverage: "100" as unknown as number,
      maxPositionSizePct: NaN,
    });
    expect(next.maxLeverage).toBe(DEFAULT_POLICY.maxLeverage);
    expect(next.maxPositionSizePct).toBe(DEFAULT_POLICY.maxPositionSizePct);
  });

  it("clamps values that would disable a check", () => {
    const next = applyPolicyPatch(DEFAULT_POLICY, {
      maxPositionSizePct: -5,
      maxLeverage: 9999,
      maxDailyDrawdownPct: 100,
    });
    expect(next.maxPositionSizePct).toBe(0.01);
    expect(next.maxLeverage).toBe(125);
    expect(next.maxDailyDrawdownPct).toBe(0.5);
  });

  describe("order cap mode", () => {
    it("defaults to an absolute cap", () => {
      expect(DEFAULT_POLICY.maxOrderNotionalMode).toBe("ABSOLUTE");
    });

    it("switches to percent mode with a supplied value", () => {
      const next = applyPolicyPatch(DEFAULT_POLICY, {
        maxOrderNotionalMode: "PCT_OF_EQUITY",
        maxOrderNotional: 0.1,
      });
      expect(next.maxOrderNotionalMode).toBe("PCT_OF_EQUITY");
      expect(next.maxOrderNotional).toBe(0.1);
    });

    it("does not reinterpret the old amount when the mode changes alone", () => {
      // Carrying 5000 across would mean "500,000% of equity".
      const next = applyPolicyPatch(DEFAULT_POLICY, { maxOrderNotionalMode: "PCT_OF_EQUITY" });
      expect(next.maxOrderNotional).toBe(0.1);
      expect(next.maxOrderNotional).toBeLessThanOrEqual(1);
    });

    it("clamps a percent cap to at most 100% of equity", () => {
      const next = applyPolicyPatch(DEFAULT_POLICY, {
        maxOrderNotionalMode: "PCT_OF_EQUITY",
        maxOrderNotional: 50,
      });
      expect(next.maxOrderNotional).toBe(1);
    });

    it("clamps an absolute cap to its own range", () => {
      expect(applyPolicyPatch(DEFAULT_POLICY, { maxOrderNotional: 0 }).maxOrderNotional).toBe(10);
      expect(
        applyPolicyPatch(DEFAULT_POLICY, { maxOrderNotional: 99_000_000 }).maxOrderNotional,
      ).toBe(1_000_000);
    });

    it("rejects an unknown mode and keeps the current one", () => {
      const next = applyPolicyPatch(DEFAULT_POLICY, {
        maxOrderNotionalMode: "UNLIMITED" as never,
      });
      expect(next.maxOrderNotionalMode).toBe("ABSOLUTE");
    });

    it("round-trips back to absolute mode", () => {
      const pct = applyPolicyPatch(DEFAULT_POLICY, {
        maxOrderNotionalMode: "PCT_OF_EQUITY",
        maxOrderNotional: 0.2,
      });
      const back = applyPolicyPatch(pct, {
        maxOrderNotionalMode: "ABSOLUTE",
        maxOrderNotional: 2500,
      });
      expect(back.maxOrderNotionalMode).toBe("ABSOLUTE");
      expect(back.maxOrderNotional).toBe(2500);
    });
  });
});
