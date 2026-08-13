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

function generatedGridPattern(): StackPattern {
  const grips = [
    ["right-bottom", 150, 50, 1, 0, 0],
    ["right-top", 150, 150, 2, 0, -1],
    ["left-bottom", 50, 50, 3, 1, 0],
    ["left-top", 50, 150, 4, 1, -1],
  ] as const;
  return {
    ref: "generated-grid",
    name: "generated-grid",
    placements: grips.map(([sourceGripId, x, y], sequence) => ({
      sourcePlacementId: `${sourceGripId}-placement`,
      sequence,
      positionMm: { x, y },
      rotation: 0,
      gripId: sourceGripId,
      labelSide: null,
    })),
    grips: grips.map(([sourceGripId, x, y, groupNumber, dx, dy], sequence) => ({
      sourceGripId,
      groupNumber,
      sequence,
      pickX: 0,
      pickY: 0,
      pickRotation: 0,
      x,
      y,
      rotation: 0,
      numPackages: 1,
      dx,
      dy,
    })),
    groupOrder: grips.map(([sourceGripId]) => sourceGripId),
    orderDependencies: [
      { beforeGripId: "right-bottom", afterGripId: "right-top" },
      { beforeGripId: "right-bottom", afterGripId: "left-bottom" },
      { beforeGripId: "right-top", afterGripId: "left-top" },
      { beforeGripId: "left-bottom", afterGripId: "left-top" },
    ],
    cycles: [],
    cycleCount: 4,
    cycleCountProvenance: derived,
    transformFrameMm: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    transformFrameProvenance: derived,
    generatedGripPolicy: { maxReferenceGapMm: 0 },
    provenance: {
      kind: "solver-candidate",
      candidateId: "candidate",
      geometryId: "geometry",
      identityFingerprint: "identity",
      geometryFingerprint: "geometry-fingerprint",
      rank: 1,
      generators: [],
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

  it.each([
    [
      "mirror-x",
      ["left-bottom", "left-top", "right-bottom", "right-top"],
      [
        [150, 50],
        [150, 150],
        [50, 50],
        [50, 150],
      ],
    ],
    [
      "rotate-90",
      ["left-bottom", "right-bottom", "left-top", "right-top"],
      [
        [150, 50],
        [150, 150],
        [50, 50],
        [50, 150],
      ],
    ],
  ] as const)(
    "replans generated grips after %s from physical right-bottom to left-top",
    (transform, expectedOrder, expectedCenters) => {
      const transformed = transformStackPattern(
        generatedGridPattern(),
        transform,
        { length: 100, width: 100 },
      );

      expect(transformed.groupOrder).toEqual(expectedOrder);
      expect(
        transformed.grips.map(({ sourceGripId, sequence, x, y, dx, dy }) => ({
          sourceGripId,
          sequence,
          x,
          y,
          dx,
          dy,
        })),
      ).toEqual(
        expectedOrder.map((sourceGripId, sequence) => ({
          sourceGripId,
          sequence,
          x: expectedCenters[sequence]![0],
          y: expectedCenters[sequence]![1],
          dx: sequence < 2 ? 0 : 1,
          dy: sequence % 2 === 0 ? 0 : -1,
        })),
      );
      expect(transformed.orderDependencies).toEqual(
        [
          {
            beforeGripId: expectedOrder[0],
            afterGripId: expectedOrder[1],
          },
          {
            beforeGripId: expectedOrder[0],
            afterGripId: expectedOrder[2],
          },
          {
            beforeGripId: expectedOrder[1],
            afterGripId: expectedOrder[3],
          },
          {
            beforeGripId: expectedOrder[2],
            afterGripId: expectedOrder[3],
          },
        ].sort(
          (left, right) =>
            left.beforeGripId.localeCompare(right.beforeGripId) ||
            left.afterGripId.localeCompare(right.afterGripId),
        ),
      );
    },
  );

  it("preserves project-defined grip order while transforming its geometry and deltas", () => {
    const generated = generatedGridPattern();
    const projectPattern: StackPattern = {
      ...generated,
      provenance: {
        kind: "project-pattern",
        projectSchemaVersion: 3,
        projectId: "project",
        solutionId: "solution",
        solutionOrigin: "imported",
        patternId: "imported-pattern",
      },
    };
    const transformed = transformStackPattern(projectPattern, "mirror-x", {
      length: 100,
      width: 100,
    });

    expect(transformed.groupOrder).toEqual(generated.groupOrder);
    expect(transformed.grips.map(({ sourceGripId }) => sourceGripId)).toEqual(
      generated.grips.map(({ sourceGripId }) => sourceGripId),
    );
    expect(transformed.grips.map(({ dx, dy }) => ({ dx, dy }))).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: -1, dy: 0 },
      { dx: -1, dy: -1 },
    ]);
    expect(transformed.orderDependencies).toEqual(generated.orderDependencies);
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
