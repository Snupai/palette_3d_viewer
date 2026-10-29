// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseNumberInput } from "./Field";
import { wrapFocusIndex } from "./focusTrap";
import {
  statusToneText,
  toneForLedgerStatus,
  toneForReadiness,
} from "./statusTone";

describe("status tones", () => {
  it("maps ledger statuses onto the shared vocabulary", () => {
    expect(
      (["PASS", "FAIL", "BLOCKED", "OBSERVED", "SKIPPED"] as const).map(
        toneForLedgerStatus,
      ),
    ).toEqual(["pass", "blocked", "caution", "observed", "unknown"]);
  });

  it("maps robotics readiness onto the shared vocabulary", () => {
    expect(
      (
        [
          "complete",
          "needs-input",
          "engineering",
          "not-checked",
          "warning",
          "blocked",
        ] as const
      ).map(toneForReadiness),
    ).toEqual(["pass", "caution", "info", "unknown", "caution", "blocked"]);
  });

  it("colours tones only through theme tokens", () => {
    expect(statusToneText).toEqual({
      pass: "text-ok",
      caution: "text-caution",
      blocked: "text-danger",
      observed: "text-measure",
      info: "text-info",
      unknown: "text-muted",
    });
  });
});

describe("wrapFocusIndex", () => {
  it("wraps forward from the last and backward from the first item", () => {
    expect(wrapFocusIndex(2, 3, false)).toBe(0);
    expect(wrapFocusIndex(0, 3, true)).toBe(2);
  });

  it("leaves focus movement inside the range to the browser", () => {
    expect(wrapFocusIndex(1, 3, false)).toBeNull();
    expect(wrapFocusIndex(1, 3, true)).toBeNull();
  });

  it("pulls focus back in from outside and ignores empty containers", () => {
    expect(wrapFocusIndex(-1, 3, false)).toBe(0);
    expect(wrapFocusIndex(-1, 3, true)).toBe(2);
    expect(wrapFocusIndex(-1, 0, false)).toBeNull();
  });
});

describe("parseNumberInput", () => {
  it("returns null for empty or non-numeric text and the number otherwise", () => {
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("  ")).toBeNull();
    expect(parseNumberInput("1e999")).toBeNull();
    expect(parseNumberInput("1200")).toBe(1200);
    expect(parseNumberInput("0.5")).toBe(0.5);
  });
});
