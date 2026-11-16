import { describe, expect, it } from "vitest";
import {
  boundingRectangleForPlacements,
  canonicalPlacementGeometryKey,
  placementsOverlap,
} from "~/domain/geometry";
import { packageOrientationClass } from "~/domain/solver/orientationPolicy";
import { solveLayer } from "~/domain/solver/solve";
import { type LayerSolverInput } from "~/domain/solver/types";
import { yieldBetweenSolverTests } from "~/domain/solver/solverTestSupport";

yieldBetweenSolverTests();

describe("solver input and candidate validation", () => {
  it("generates an exact asymmetric pinwheel with independently sized opposite regions", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 112, width: 76 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1168, maxY: 756 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 103,
        maximumPackageCount: 103,
        allowMixedPackageOrientations: true,
        maxCandidatesPerGenerator: 1_000,
      },
    };
    const expectedPlacements = [
      ...[38, 114, 190, 266, 342, 418, 494, 570].flatMap((x) =>
        [56, 168].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[664, 776, 888, 1_000, 1_112].flatMap((x) =>
        [38, 115, 193, 270].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[56, 168, 280, 392, 504].flatMap((x) =>
        [262, 338, 414, 490, 566, 642, 718].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[598, 674, 750, 826, 902, 978, 1_054, 1_130].flatMap((x) =>
        [364, 476, 588, 700].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
    ];
    const geometry = (
      placements: readonly {
        positionMm: { x: number; y: number };
        rotation: number;
      }[],
    ) =>
      placements
        .map(
          ({ positionMm, rotation }) =>
            `${positionMm.x},${positionMm.y},${rotation}`,
        )
        .sort();

    const first = solveLayer(input, {
      generatorOrder: [
        "pinwheel",
        "row",
        "block",
        "justified-grid",
        "nested-side",
        "edge-ring",
        "mixed-orientation",
      ],
      includeSymmetryVariants: false,
    });
    const second = solveLayer(input, {
      generatorOrder: [
        "mixed-orientation",
        "edge-ring",
        "nested-side",
        "justified-grid",
        "block",
        "row",
        "pinwheel",
      ],
      includeSymmetryVariants: false,
    });
    const expectedGeometry = geometry(expectedPlacements);
    const candidate = first.candidates.find(
      ({ placements }) =>
        JSON.stringify(geometry(placements)) ===
        JSON.stringify(expectedGeometry),
    );

    expect(second).toEqual(first);
    expect(expectedPlacements).toHaveLength(103);
    expect(candidate).toBeDefined();
    expect(candidate?.metrics.packageCount).toBe(103);
    expect(candidate?.validation.valid).toBe(true);
    expect(
      boundingRectangleForPlacements(
        candidate?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 0, minY: 0, maxX: 1168, maxY: 756 });
    expect(
      candidate?.placements.filter(
        ({ rotation }) => packageOrientationClass(rotation) === "lengthwise",
      ),
    ).toHaveLength(55);
    expect(
      candidate?.placements.filter(
        ({ rotation }) => packageOrientationClass(rotation) === "crosswise",
      ),
    ).toHaveLength(48);

    let overlapCount = 0;
    const placements = candidate?.placements ?? [];
    for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < placements.length;
        rightIndex += 1
      ) {
        if (
          placementsOverlap(
            placements[leftIndex]!,
            placements[rightIndex]!,
            input.package.dimensionsMm,
            input.package.clearanceMm,
          )
        ) {
          overlapCount += 1;
        }
      }
    }
    expect(overlapCount).toBe(0);
  }, 30_000);

  it("splits asymmetric pinwheel residual height across opposite regions", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 112, width: 76 },
        clearanceMm: 2,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 652, maxY: 574 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 41,
        maximumPackageCount: 41,
        allowMixedPackageOrientations: true,
        maxCandidatesPerGenerator: 10_000,
      },
    };
    const expectedPlacements = [
      ...[38, 116, 194, 272].flatMap((x) =>
        [56, 180].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[368, 482, 596].flatMap((x) =>
        [38, 116, 194].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[56, 170, 284].flatMap((x) =>
        [276, 362.666666667, 449.333333333, 536].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[380, 458, 536, 614].flatMap((x) =>
        [290, 404, 518].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
    ];
    const expectedGeometry = canonicalPlacementGeometryKey(expectedPlacements);

    const result = solveLayer(input, {
      includeSymmetryVariants: false,
    });
    const candidate = result.candidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) === expectedGeometry,
    );

    expect(expectedPlacements).toHaveLength(41);
    expect(candidate).toBeDefined();
    expect(candidate?.metrics.packageCount).toBe(41);
    expect(candidate?.validation.valid).toBe(true);
    expect(
      boundingRectangleForPlacements(
        candidate?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual(input.envelopeMm);
    // CI runners take about 2.3x the local time (23 s of 30 s before grip
    // access planning); the budget only guards against hangs.
  }, 60_000);
});
