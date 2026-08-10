import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import goldenCase from "~/lib/__fixtures__/anonymized-plan.golden.json";
import {
  evaluateRobGoldenCase,
  parityGoldenCaseSchema,
} from "~/lib/parityGoldenCase";

function fixture(name: "anonymized-plan-lf.rob" | "anonymized-plan-crlf.rob") {
  return readFileSync(
    resolve(process.cwd(), "src", "lib", "__fixtures__", name),
    "utf8",
  );
}

describe(".rob parity golden cases", () => {
  it("validates the versioned golden-case contract", () => {
    expect(parityGoldenCaseSchema.parse(goldenCase)).toEqual(goldenCase);
  });

  it.each(["anonymized-plan-lf.rob", "anonymized-plan-crlf.rob"] as const)(
    "matches the import baseline for %s",
    (filename) => {
      const result = evaluateRobGoldenCase(fixture(filename), goldenCase);

      expect(result.mismatches).toEqual([]);
      expect(result.semanticRoundTripMatches).toBe(true);
    },
  );

  it("reports the exact expectation path when behavior drifts", () => {
    const changedExpectation = {
      ...goldenCase,
      expected: { ...goldenCase.expected, totalPackages: 99 },
    };

    const result = evaluateRobGoldenCase(
      fixture("anonymized-plan-lf.rob"),
      changedExpectation,
    );

    expect(result.mismatches).toContainEqual({
      path: "totalPackages",
      expected: 99,
      actual: 5,
    });
  });
});
