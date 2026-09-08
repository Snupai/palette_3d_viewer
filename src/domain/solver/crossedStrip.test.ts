import { describe, expect, it } from "vitest";
import { generateCandidateFamily } from "./generators";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "./validation";
import type { LayerSolverInput } from "./types";

function input(gap = 0) {
  const value: LayerSolverInput = {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 70, width: 45 },
      clearanceMm: gap,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 440, maxY: 310 },
    constraints: {
      allowedRotations: [0, 90],
      provisionalPackagesPerCycle: 2,
      suctionRemainderPolicy: "axis-ends",
      maxCandidatesPerGenerator: 500,
    },
  };
  return validateAndNormalizeSolverInput(value).normalized!;
}

describe("crossed strips", () => {
  it("shares the wider perpendicular region with a full-width band and collapses distributed pickup pairs", () => {
    const normalized = input();
    const draft = generateCandidateFamily(
      normalized,
      "crossed-strip",
    ).drafts.find((d) => {
      const p = d.provenance[0]?.parameters;
      return (
        p?.transpose === false &&
        p.rows === 2 &&
        p.columns === 6 &&
        p.leftColumns === 3 &&
        p.sideColumns === 8 &&
        p.bandAtEnd === true
      );
    })!;
    const expected = [
      ...[237.5, 282.5].flatMap((y) =>
        [41, 111, 185, 255, 329, 399].map((x) => ({
          positionMm: { x, y },
          rotation: 0,
        })),
      ),
      ...[27.5, 72.5, 117.5, 232.5, 277.5, 322.5, 367.5, 412.5].flatMap((x) =>
        [40, 110, 180].map((y) => ({ positionMm: { x, y }, rotation: 90 })),
      ),
      ...[27.5, 82.5, 137.5, 192.5].map((y) => ({
        positionMm: { x: 175, y },
        rotation: 0,
      })),
    ];
    expect(draft.placements).toHaveLength(40);
    expect(
      draft.placements.map(({ positionMm, rotation }) => ({
        positionMm,
        rotation,
      })),
    ).toEqual(expect.arrayContaining(expected));
    expect(validateCandidatePlacements(normalized, draft.placements)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("keeps a positive minimum gap and never emits non-finite coordinates for narrow remaining regions", () => {
    const normalized = input(3);
    const drafts = generateCandidateFamily(normalized, "crossed-strip").drafts;
    const valid = drafts.filter(
      (d) => validateCandidatePlacements(normalized, d.placements).valid,
    );
    expect(valid.length).toBe(drafts.length);
    // One nine-box band, four five-box columns and three three-box columns.
    expect(valid[0]?.placements.length).toBe(38);
  });

  it("honors cancellation and the family limit independently of existing families", () => {
    const normalized = input();
    expect(
      generateCandidateFamily(normalized, "crossed-strip", {
        shouldCancel: () => true,
      }).drafts,
    ).toEqual([]);
    normalized.constraints.maxCandidatesPerGenerator = 3;
    const output = generateCandidateFamily(normalized, "crossed-strip");
    expect(output.drafts).toHaveLength(3);
    expect(
      output.diagnostics.some((d) => d.code === "generation-limit-reached"),
    ).toBe(true);
    normalized.constraints.allowMixedPackageOrientations = false;
    expect(generateCandidateFamily(normalized, "crossed-strip").drafts).toEqual(
      [],
    );
  });
});
