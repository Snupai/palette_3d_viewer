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
      ...[27.5, 82, 137, 192.5].map((y) => ({
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

  it("balances distributed triples before collapsing their pickup centers", () => {
    const value = input();
    value.package.dimensionsMm = { length: 65, width: 45 };
    value.generationBoundsMm = { minX: 0, minY: 0, maxX: 500, maxY: 310 };
    value.envelopeMm = value.generationBoundsMm;
    value.usableEnvelopeMm = value.generationBoundsMm;
    value.constraints.provisionalPackagesPerCycle = 3;
    value.constraints.minimumPackageCount = 45;
    value.constraints.maximumPackageCount = 45;
    const draft = generateCandidateFamily(value, "crossed-strip").drafts.find(
      (d) => {
        const p = d.provenance[0]?.parameters;
        return (
          p?.transpose === false &&
          p.rotation === 0 &&
          p.rows === 2 &&
          p.columns === 7 &&
          p.sideColumns === 9 &&
          p.coreColumns === 1 &&
          p.leftColumns === 3 &&
          p.bandAtEnd === true
        );
      },
    )!;
    expect(
      draft.placements
        .filter((p) => p.positionMm.y === 230)
        .map((p) => p.positionMm.x),
    ).toEqual([48.5, 113.5, 183.5, 248.5, 320, 385, 450]);
    expect(validateCandidatePlacements(value, draft.placements)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("retains centered and edge-aligned single-row fillers", () => {
    const value = input();
    value.package.dimensionsMm = { length: 60, width: 40 };
    value.constraints.minimumPackageCount = 45;
    value.constraints.maximumPackageCount = 45;
    value.generationBoundsMm = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    value.envelopeMm = value.generationBoundsMm;
    value.usableEnvelopeMm = value.generationBoundsMm;
    const drafts = generateCandidateFamily(
      value,
      "crossed-strip",
    ).drafts.filter((d) => {
      const p = d.provenance[0]?.parameters;
      return (
        p?.transpose === false &&
        p.rotation === 0 &&
        p.rows === 6 &&
        p.columns === 6 &&
        p.sideColumns === 8 &&
        p.coreColumns === 1 &&
        p.leftColumns === 3 &&
        p.bandAtEnd === true
      );
    });
    expect(
      drafts.map(
        (d) =>
          d.placements.find((p) => p.rotation === 0 && p.positionMm.y < 60)
            ?.positionMm,
      ),
    ).toEqual([
      { x: 160, y: 30 },
      { x: 160, y: 20 },
      { x: 160, y: 40 },
    ]);
    for (const draft of drafts)
      expect(validateCandidatePlacements(value, draft.placements)).toEqual({
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
