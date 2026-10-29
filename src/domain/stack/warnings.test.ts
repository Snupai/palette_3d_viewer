import { describe, expect, it } from "vitest";
import {
  createCompositionSequence,
  materializeStack,
  type StackMaterializationInput,
  type StackPattern,
} from "~/domain/stack";

const derived = {
  status: "derived" as const,
  source: "warning-test",
  detail: "Synthetic warning boundary input.",
};

function pattern(
  placements: Array<{ x: number; y: number }>,
  cycleStatus: "derived" | "unverified" | "unknown" = "derived",
): StackPattern {
  return {
    ref: "pattern",
    name: "Pattern",
    placements: placements.map((positionMm, index) => ({
      sourcePlacementId: `placement-${index + 1}`,
      sequence: index,
      positionMm,
      rotation: 0,
      gripId: null,
      labelSide: null,
    })),
    grips: [],
    groupOrder: [],
    orderDependencies: [],
    cycles: [],
    cycleCount: cycleStatus === "unknown" ? null : placements.length,
    cycleCountProvenance: {
      status: cycleStatus,
      source: "warning-test-cycle",
      detail: "Synthetic cycle provenance.",
    },
    transformFrameMm: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transformFrameProvenance: derived,
    provenance: {
      kind: "project-pattern",
      projectSchemaVersion: 3,
      projectId: "project",
      solutionId: "solution",
      solutionOrigin: "manual",
      patternId: "pattern",
    },
  };
}

function baseInput(
  stackPattern: StackPattern = pattern([{ x: 50, y: 50 }]),
): StackMaterializationInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 100, width: 100, height: 100 },
      weightKg: 9,
      weightProvenance: derived,
      inletOrientation: "lengthwise",
    },
    pallet: {
      id: "pallet",
      dimensionsMm: { length: 100, width: 100, height: 10 },
      allowedOverhangMm: { length: 0, width: 0 },
      storageEnvelopeMm: { length: 100, width: 100, height: 100 },
      tareKg: 1,
      maxGrossKg: 10,
    },
    resources: {
      selectedGripperId: "gripper",
      selectedPalletStationId: "station",
      availableMaterialResourceIds: [],
    },
    patterns: [stackPattern],
    layers: createCompositionSequence({
      mode: "tower",
      layerCount: 1,
      primaryPatternRef: stackPattern.ref,
    }),
    interlayers: { mode: "individual", beforeLayer: {} },
  };
}

function codes(input: StackMaterializationInput) {
  return materializeStack(input).warnings.map(({ code }) => code);
}

describe("structured stack warning boundaries", () => {
  it("treats exact footprint, height, storage, and gross limits as valid", () => {
    const warningCodes = codes(baseInput());

    expect(warningCodes).not.toContain("footprint-exceeded");
    expect(warningCodes).not.toContain("storage-envelope-exceeded");
    expect(warningCodes).not.toContain("height-exceeded");
    expect(warningCodes).not.toContain("gross-weight-exceeded");
  });

  it("warns immediately beyond footprint, height, and gross boundaries", () => {
    const footprint = baseInput(pattern([{ x: 50.000_001, y: 50 }]));
    expect(codes(footprint)).toContain("footprint-exceeded");

    const height = baseInput();
    height.pallet!.storageEnvelopeMm!.height = 99.999_999;
    expect(codes(height)).toContain("height-exceeded");

    const gross = baseInput();
    gross.pallet!.maxGrossKg = 9.999_999;
    expect(codes(gross)).toContain("gross-weight-exceeded");
  });

  it("separates storage-envelope dimensions from allowed pallet footprint", () => {
    const input = baseInput(
      pattern([
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ]),
    );
    input.pallet!.allowedOverhangMm.length = 50;
    input.pallet!.storageEnvelopeMm!.length = 199.999_999;
    input.package.weightKg = 1;
    input.pallet!.maxGrossKg = 100;

    const warningCodes = codes(input);
    expect(warningCodes).not.toContain("footprint-exceeded");
    expect(warningCodes).toContain("storage-envelope-exceeded");
  });

  it("reports missing resources and unknown or unverified metric provenance", () => {
    const unknownPattern = pattern([{ x: 50, y: 50 }], "unknown");
    const input = baseInput(unknownPattern);
    input.package.weightKg = null;
    input.package.weightProvenance = {
      status: "unknown",
      source: "missing",
      detail: "No package weight.",
    };
    input.pallet = null;
    input.resources.selectedGripperId = null;
    input.resources.selectedPalletStationId = null;
    input.interlayers = {
      mode: "individual",
      baseSheet: {
        thicknessMm: 1,
        weightKg: null,
        resourceId: "missing-sheet",
      },
      beforeLayer: {},
    };

    const result = materializeStack(input);
    expect(
      result.warnings
        .filter(({ code }) => code === "missing-resource")
        .map(({ resourceKind }) => resourceKind),
    ).toEqual(
      expect.arrayContaining([
        "pallet",
        "gripper",
        "pallet-station",
        "package-weight",
        "material",
      ]),
    );
    expect(result.warnings.map(({ code }) => code)).toContain(
      "metric-provenance-unknown",
    );

    const unverified = baseInput(pattern([{ x: 50, y: 50 }], "unverified"));
    expect(codes(unverified)).toContain("metric-provenance-unverified");
  });
});
