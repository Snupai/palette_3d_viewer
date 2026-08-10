import { describe, expect, it } from "vitest";
import {
  applyStackSequenceCommand,
  createCompositionSequence,
  materializeStack,
  transformForCompositionMode,
  transformStackPattern,
  type EditableStackLayer,
  type StackCompositionMode,
  type StackPattern,
} from "~/domain/stack";

const derived = {
  status: "derived" as const,
  source: "test",
  detail: "Synthetic executable test input.",
};

function pattern(ref: string): StackPattern {
  return {
    ref,
    name: ref,
    placements: [
      {
        sourcePlacementId: `${ref}-placement-1`,
        sequence: 0,
        positionMm: { x: 20, y: 30 },
        rotation: 0,
        gripId: null,
        labelSide: "top",
      },
    ],
    grips: [],
    groupOrder: [],
    orderDependencies: [],
    cycles: [],
    cycleCount: 0,
    cycleCountProvenance: derived,
    transformFrameMm: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
    transformFrameProvenance: derived,
    provenance: {
      kind: "project-pattern",
      projectSchemaVersion: 3,
      projectId: "project",
      solutionId: "solution",
      solutionOrigin: "manual",
      patternId: ref,
    },
  };
}

function materializeMode(mode: StackCompositionMode) {
  return materializeStack({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 10, width: 10, height: 20 },
      weightKg: 1,
      weightProvenance: derived,
      inletOrientation: "lengthwise",
    },
    pallet: {
      id: "pallet",
      dimensionsMm: { length: 100, width: 80, height: 10 },
      allowedOverhangMm: { length: 0, width: 0 },
      storageEnvelopeMm: { length: 100, width: 80, height: 100 },
      tareKg: 5,
      maxGrossKg: 100,
    },
    resources: {
      selectedGripperId: "gripper",
      selectedPalletStationId: "station",
      availableMaterialResourceIds: [],
    },
    patterns: [pattern("primary"), pattern("secondary")],
    layers: createCompositionSequence({
      mode,
      layerCount: 2,
      primaryPatternRef: "primary",
      secondaryPatternRef: "secondary",
    }),
    interlayers: { mode: "individual", beforeLayer: {} },
  });
}

describe("stack composition transforms", () => {
  it.each([
    ["tower", "identity", { x: 20, y: 30 }, 0, "top"],
    ["longitudinal-mirror", "mirror-y", { x: 20, y: 50 }, 0, "bottom"],
    ["transverse-mirror", "mirror-x", { x: 80, y: 30 }, 180, "top"],
    ["rotation", "rotate-180", { x: 80, y: 50 }, 180, "bottom"],
  ] as const)(
    "materializes %s with explicit transform provenance",
    (mode, transform, positionMm, rotation, labelSide) => {
      const result = materializeMode(mode);
      const secondary = result.packageLayers[1]!;

      expect(transformForCompositionMode(mode)).toBe(transform);
      expect(secondary.patternRef).toBe("secondary");
      expect(secondary.transform).toBe(transform);
      expect(secondary.placements[0]).toMatchObject({
        positionMm,
        rotation,
        labelSide,
      });
      expect(secondary.layerProvenance).toEqual({
        kind: "composition",
        mode,
        role: "secondary",
        sourcePatternRef: "secondary",
      });
    },
  );

  it("preserves a solver-selected physical label face through reflections", () => {
    const managedPattern: StackPattern = {
      ...pattern("managed"),
      labelOrientationPolicy: {
        unrotatedPackageLabelSide: "top",
        allowedRotations: [0, 180],
      },
    };

    expect(
      transformStackPattern(managedPattern, "mirror-x", {
        length: 10,
        width: 10,
      }).placements[0],
    ).toMatchObject({
      positionMm: { x: 80, y: 30 },
      rotation: 0,
      labelSide: "top",
    });
    expect(
      transformStackPattern(managedPattern, "mirror-y", {
        length: 10,
        width: 10,
      }).placements[0],
    ).toMatchObject({
      positionMm: { x: 20, y: 50 },
      rotation: 180,
      labelSide: "bottom",
    });
  });

  it("rejects a managed stack transform when no authorized yaw preserves the physical label", () => {
    const managedPattern: StackPattern = {
      ...pattern("managed"),
      labelOrientationPolicy: {
        unrotatedPackageLabelSide: "top",
        allowedRotations: [0, 180],
      },
    };

    expect(() =>
      transformStackPattern(managedPattern, "rotate-90", {
        length: 10,
        width: 10,
      }),
    ).toThrow(/cannot preserve the selected physical label face/);
  });
});

describe("immutable stack sequence commands", () => {
  const layers: readonly EditableStackLayer[] = [
    {
      id: "a",
      patternRef: "pattern-a",
      transform: "identity",
      provenance: { kind: "manual", reason: "test" },
    },
    {
      id: "b",
      patternRef: "pattern-b",
      transform: "identity",
      provenance: { kind: "manual", reason: "test" },
    },
    {
      id: "c",
      patternRef: "pattern-c",
      transform: "identity",
      provenance: { kind: "manual", reason: "test" },
    },
  ];

  it("reorders without cloning layer objects and supplies an inverse", () => {
    const changed = applyStackSequenceCommand(layers, {
      type: "reorder",
      layerId: "c",
      toIndex: 0,
    });

    expect(changed.sequence.map(({ id }) => id)).toEqual(["c", "a", "b"]);
    expect(changed.sequence[0]).toBe(layers[2]);
    expect(changed.sequence[1]).toBe(layers[0]);
    expect(changed.sequence[2]).toBe(layers[1]);
    expect(layers.map(({ id }) => id)).toEqual(["a", "b", "c"]);

    const undone = applyStackSequenceCommand(
      changed.sequence,
      changed.inverse!,
    );
    expect(undone.sequence.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(undone.sequence[0]).toBe(layers[0]);
  });

  it("inserts, deletes, and updates while preserving unaffected references", () => {
    const insertedLayer: EditableStackLayer = {
      id: "inserted",
      patternRef: "pattern-a",
      transform: "rotate-180",
      provenance: { kind: "manual", reason: "insert" },
    };
    const inserted = applyStackSequenceCommand(layers, {
      type: "insert",
      index: 1,
      layer: insertedLayer,
    });
    expect(inserted.sequence[1]).toBe(insertedLayer);
    expect(inserted.sequence[0]).toBe(layers[0]);
    expect(inserted.sequence[2]).toBe(layers[1]);

    const deleted = applyStackSequenceCommand(inserted.sequence, {
      type: "delete",
      layerId: "inserted",
    });
    expect(deleted.sequence).toEqual(layers);
    expect(deleted.sequence[1]).toBe(layers[1]);

    const updated = applyStackSequenceCommand(layers, {
      type: "update",
      layerId: "b",
      changes: { patternRef: "pattern-a", transform: "mirror-x" },
    });
    expect(updated.sequence[0]).toBe(layers[0]);
    expect(updated.sequence[2]).toBe(layers[2]);
    expect(updated.sequence[1]).not.toBe(layers[1]);
    expect(updated.sequence[1]).toMatchObject({
      id: "b",
      patternRef: "pattern-a",
      transform: "mirror-x",
    });
  });
});
