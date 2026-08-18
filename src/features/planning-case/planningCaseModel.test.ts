import { describe, expect, it } from "vitest";
import { transformPlacements, type PlacementGeometry } from "~/domain/geometry";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import {
  clampPlanningStage,
  comparePatternPreviews,
  workflowStages,
  ROB_REFERENCE_TOLERANCE_MM,
} from "~/features/planning-case/planningCaseModel";

const palletBoundsMm = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
const packageSize = { length: 100, width: 50 };

function preview(
  id: string,
  placements: readonly PlacementGeometry[],
): LayerPatternPreview {
  return {
    id,
    label: id,
    palletBoundsMm,
    items: placements.map((placement, index) => ({
      id: `${id}-${index}`,
      centerMm: { ...placement.positionMm },
      sizeMm:
        placement.rotation === 90 || placement.rotation === 270
          ? { x: packageSize.width, y: packageSize.length }
          : { x: packageSize.length, y: packageSize.width },
      rotation: placement.rotation,
      labelSide: null,
      groupLabel: null,
    })),
    metadata: {
      source: "solver-candidate",
      sourceId: id,
      rank: 1,
      geometryId: id,
      packageCount: placements.length,
      cycleCount: placements.length,
      utilizationPercent: 10,
    },
  };
}

const referencePlacements: PlacementGeometry[] = [
  { positionMm: { x: 75, y: 50 }, rotation: 0 },
  { positionMm: { x: 220, y: 170 }, rotation: 90 },
];

describe("comparePatternPreviews", () => {
  it("reports an exact identity match", () => {
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", referencePlacements),
      packageSize,
    );

    expect(result).toMatchObject({
      status: "exact",
      acceptedSymmetry: "identity",
      referenceCount: 2,
      currentCount: 2,
      missingCount: 0,
      extraCount: 0,
      maximumAxisDisplacementMm: 0,
    });
  });

  it("accepts an exact pallet-envelope-preserving symmetry", () => {
    const mirrored = transformPlacements(
      referencePlacements,
      palletBoundsMm,
      "mirror-x",
    );
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", mirrored),
      packageSize,
    );

    expect(result.status).toBe("exact");
    expect(result.acceptedSymmetry).toBe("mirror-x");
  });

  it("reports legacy integer-compatible geometry only after exact matching fails", () => {
    const shifted = referencePlacements.map((placement) => ({
      ...placement,
      positionMm: {
        x: placement.positionMm.x + 0.5,
        y: placement.positionMm.y - 0.5,
      },
    }));
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", shifted),
      packageSize,
    );

    expect(result.status).toBe("integer-compatible");
    expect(result.toleranceMm).toBe(ROB_REFERENCE_TOLERANCE_MM);
    expect(result.maximumAxisDisplacementMm).toBeCloseTo(0.5);
  });

  it("reports package-count differences without attempting geometry matching", () => {
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", referencePlacements.slice(0, 1)),
      packageSize,
    );

    expect(result).toMatchObject({
      status: "count-mismatch",
      referenceCount: 2,
      currentCount: 1,
      missingCount: 1,
      extraCount: 0,
      acceptedSymmetry: null,
    });
  });

  it("reports no match when equal counts differ beyond every accepted symmetry", () => {
    const shifted = referencePlacements.map((placement) => ({
      ...placement,
      positionMm: {
        x: placement.positionMm.x + 3,
        y: placement.positionMm.y + 4,
      },
    }));
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", shifted),
      packageSize,
    );

    expect(result.status).toBe("no-match");
    expect(result.acceptedSymmetry).toBeNull();
  });

  it("blocks comparison when either proof surface is unavailable", () => {
    const result = comparePatternPreviews(
      null,
      preview("current", referencePlacements),
      packageSize,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      referenceCount: 0,
      currentCount: 2,
    });
  });
});

describe("planning workflow stages", () => {
  it("uses a four-step generation path and a two-step imported path", () => {
    expect(workflowStages(false).map(([id]) => id)).toEqual([
      "inputs",
      "generate",
      "stack",
      "validate",
    ]);
    expect(workflowStages(true).map(([id, label]) => [id, label])).toEqual([
      ["inputs", "Plan"],
      ["validate", "Tools"],
    ]);
  });

  it("clamps generate/stack away when the project already has a .rob", () => {
    expect(clampPlanningStage("generate", true)).toBe("inputs");
    expect(clampPlanningStage("stack", true)).toBe("inputs");
    expect(clampPlanningStage("validate", true)).toBe("validate");
    expect(clampPlanningStage("generate", false)).toBe("generate");
  });
});
