import { describe, expect, it } from "vitest";
import { finalizeGeneratedCandidates } from "~/domain/solver/candidates";
import { generateCandidateFamily } from "~/domain/solver/generators";
import type {
  LayerSolverInput,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";
import { validateAndNormalizeSolverInput } from "~/domain/solver/validation";
import {
  applyStackSequenceCommand,
  createCompositionSequence,
  materializeStack,
  stackPatternFromSolverCandidate,
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

function normalized(input: LayerSolverInput): NormalizedLayerSolverInput {
  const validation = validateAndNormalizeSolverInput(input);
  if (!validation.valid || !validation.normalized) {
    throw new Error("Expected valid solver input.");
  }
  return validation.normalized;
}

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
      [
        [0, 0],
        [0, 1],
        [-1, 0],
        [-1, 1],
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
      [
        [0, 0],
        [0, 1],
        [-1, 0],
        [-1, 1],
      ],
    ],
  ] as const)(
    "replans generated grips after %s by continuing the rightmost available chain",
    (transform, expectedOrder, expectedCenters, expectedDeltas) => {
      const transformed = transformStackPattern(
        generatedGridPattern(),
        transform,
        { length: 100, width: 100 },
      );

      expect(transformed.groupOrder).toEqual(expectedOrder);
      expect(
        transformed.grips.map(
          ({ sourceGripId, groupNumber, sequence, x, y, dx, dy }) => ({
            sourceGripId,
            groupNumber,
            sequence,
            x,
            y,
            dx,
            dy,
          }),
        ),
      ).toEqual(
        expectedOrder.map((sourceGripId, sequence) => ({
          sourceGripId,
          groupNumber: sequence + 1,
          sequence,
          x: expectedCenters[sequence]![0],
          y: expectedCenters[sequence]![1],
          dx: expectedDeltas[sequence]![0],
          dy: expectedDeltas[sequence]![1],
        })),
      );
      expect(transformed.orderDependencies).toEqual(
        [
          {
            beforeGripId: expectedOrder[0],
            afterGripId: expectedOrder[1],
            source: "inferred",
          },
          {
            beforeGripId: expectedOrder[0],
            afterGripId: expectedOrder[2],
            source: "inferred",
          },
          {
            beforeGripId: expectedOrder[1],
            afterGripId: expectedOrder[3],
            source: "inferred",
          },
          {
            beforeGripId: expectedOrder[2],
            afterGripId: expectedOrder[3],
            source: "inferred",
          },
        ].sort(
          (left, right) =>
            left.beforeGripId.localeCompare(right.beforeGripId) ||
            left.afterGripId.localeCompare(right.afterGripId),
        ),
      );
    },
  );

  it("continues the rightmost available chain for the 73-package pattern", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 135, width: 91 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 73,
        maximumPackageCount: 73,
        maxBands: 16,
        maxCandidatesPerGenerator: 100,
        provisionalPackagesPerCycle: 2,
        allowMixedPackageOrientations: true,
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });
    const generated = generateCandidateFamily(input, "mixed-orientation");
    const finalized = finalizeGeneratedCandidates(input, generated.drafts);
    const candidate = finalized.candidates.find(({ provenance }) =>
      provenance.some(
        ({ variant }) =>
          variant ===
          "horizontal-grouped-lengthwise-first-exact-rectangular-compact",
      ),
    );
    if (!candidate) {
      throw new Error("Expected the deterministic 73-package candidate.");
    }

    const transformed = transformStackPattern(
      stackPatternFromSolverCandidate(candidate, {
        transformFrameMm: input.envelopeMm,
      }),
      "identity",
      input.package.dimensionsMm,
      "lengthwise",
    );
    const expectedGripPrefix = [
      { sourceGripId: "generated-grip:8", numPackages: 1 },
      { sourceGripId: "generated-grip:21+34", numPackages: 2 },
      { sourceGripId: "generated-grip:47", numPackages: 1 },
      { sourceGripId: "generated-grip:60+73", numPackages: 2 },
      { sourceGripId: "generated-grip:7", numPackages: 1 },
      { sourceGripId: "generated-grip:20+33", numPackages: 2 },
      { sourceGripId: "generated-grip:46", numPackages: 1 },
      { sourceGripId: "generated-grip:59+72", numPackages: 2 },
      { sourceGripId: "generated-grip:19+32", numPackages: 2 },
      { sourceGripId: "generated-grip:45", numPackages: 1 },
      { sourceGripId: "generated-grip:58+71", numPackages: 2 },
      { sourceGripId: "generated-grip:6", numPackages: 1 },
    ];

    expect(transformed.grips).toHaveLength(47);
    expect(
      [1, 5, 12, 16].map((groupNumber) => {
        const grip = transformed.grips.find(
          (candidateGrip) => candidateGrip.groupNumber === groupNumber,
        );
        return { groupNumber, dx: grip?.dx, dy: grip?.dy };
      }),
    ).toEqual([
      { groupNumber: 1, dx: 0, dy: 0 },
      { groupNumber: 5, dx: -1, dy: 0 },
      { groupNumber: 12, dx: -1, dy: 0 },
      { groupNumber: 16, dx: -1, dy: 0 },
    ]);
    expect(
      transformed.grips
        .slice(0, expectedGripPrefix.length)
        .map(({ sourceGripId, numPackages, groupNumber, sequence }) => ({
          sourceGripId,
          numPackages,
          currentGroupNumber: groupNumber,
          sequence,
        })),
    ).toEqual(
      expectedGripPrefix.map((grip, sequence) => ({
        ...grip,
        currentGroupNumber: sequence + 1,
        sequence,
      })),
    );
  });

  it("repairs stale project grip order for an identity layer", () => {
    const projectPattern: StackPattern = {
      ...pattern("stale-project-order"),
      placements: [
        {
          sourcePlacementId: "placement-upper",
          sequence: 0,
          positionMm: { x: 50, y: 150 },
          rotation: 0,
          gripId: "upper",
          labelSide: null,
        },
        {
          sourcePlacementId: "placement-lower",
          sequence: 1,
          positionMm: { x: 50, y: 50 },
          rotation: 0,
          gripId: "lower",
          labelSide: null,
        },
      ],
      grips: [
        {
          sourceGripId: "upper",
          groupNumber: 1,
          sequence: 0,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 50,
          y: 150,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
        {
          sourceGripId: "lower",
          groupNumber: 2,
          sequence: 1,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 50,
          y: 50,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
      ],
      groupOrder: ["upper", "lower"],
      orderDependencies: [],
    };

    const transformed = transformStackPattern(projectPattern, "identity", {
      length: 100,
      width: 100,
    });

    expect(transformed.groupOrder).toEqual(["lower", "upper"]);
    expect(
      transformed.grips.map(({ sourceGripId, sequence, groupNumber }) => ({
        sourceGripId,
        sequence,
        groupNumber,
      })),
    ).toEqual([
      { sourceGripId: "lower", sequence: 0, groupNumber: 1 },
      { sourceGripId: "upper", sequence: 1, groupNumber: 2 },
    ]);
    expect(transformed.orderDependencies).toEqual([
      {
        beforeGripId: "lower",
        afterGripId: "upper",
        source: "inferred",
      },
    ]);
  });

  it("replaces stale inferred project dependencies from current geometry and deltas", () => {
    const projectPattern: StackPattern = {
      ...pattern("stale-inferred-dependency"),
      placements: [
        {
          sourcePlacementId: "placement-right",
          sequence: 0,
          positionMm: { x: 150, y: 50 },
          rotation: 0,
          gripId: "right",
          labelSide: null,
        },
        {
          sourcePlacementId: "placement-left",
          sequence: 1,
          positionMm: { x: 50, y: 50 },
          rotation: 0,
          gripId: "left",
          labelSide: null,
        },
      ],
      grips: [
        {
          sourceGripId: "right",
          groupNumber: 1,
          sequence: 0,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 150,
          y: 50,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
        {
          sourceGripId: "left",
          groupNumber: 2,
          sequence: 1,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 50,
          y: 50,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
      ],
      groupOrder: ["right", "left"],
      orderDependencies: [
        {
          beforeGripId: "left",
          afterGripId: "right",
          source: "inferred",
        },
      ],
    };

    expect(
      transformStackPattern(projectPattern, "identity", {
        length: 100,
        width: 100,
      }).orderDependencies,
    ).toEqual([]);
    expect(
      transformStackPattern(
        {
          ...projectPattern,
          orderDependencies: [
            {
              beforeGripId: "left",
              afterGripId: "right",
              source: "explicit",
            },
          ],
        },
        "identity",
        { length: 100, width: 100 },
      ).orderDependencies,
    ).toEqual([
      {
        beforeGripId: "left",
        afterGripId: "right",
        source: "explicit",
      },
    ]);
  });

  it("rebuilds delta dependencies with the configured inlet orientation", () => {
    const projectPattern: StackPattern = {
      ...pattern("crosswise-delta-dependency"),
      placements: [
        {
          sourcePlacementId: "placement-dependent",
          sequence: 0,
          positionMm: { x: 50, y: 50 },
          rotation: 0,
          gripId: "dependent",
          labelSide: null,
        },
        {
          sourcePlacementId: "placement-target",
          sequence: 1,
          positionMm: { x: 150, y: 110 },
          rotation: 0,
          gripId: "target",
          labelSide: null,
        },
      ],
      grips: [
        {
          sourceGripId: "dependent",
          groupNumber: 1,
          sequence: 0,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 50,
          y: 50,
          rotation: 0,
          numPackages: 1,
          dx: -1,
          dy: 0,
        },
        {
          sourceGripId: "target",
          groupNumber: 2,
          sequence: 1,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 150,
          y: 110,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
      ],
      groupOrder: ["dependent", "target"],
      orderDependencies: [],
    };

    const lengthwise = transformStackPattern(
      projectPattern,
      "identity",
      { length: 100, width: 40 },
      "lengthwise",
    );
    const crosswise = transformStackPattern(
      projectPattern,
      "identity",
      { length: 100, width: 40 },
      "crosswise",
    );

    expect(lengthwise.groupOrder).toEqual(["dependent", "target"]);
    expect(lengthwise.orderDependencies).toEqual([]);
    expect(crosswise.groupOrder).toEqual(["target", "dependent"]);
    expect(
      crosswise.grips.map(({ sourceGripId, sequence, groupNumber }) => ({
        sourceGripId,
        sequence,
        groupNumber,
      })),
    ).toEqual([
      { sourceGripId: "target", sequence: 0, groupNumber: 1 },
      { sourceGripId: "dependent", sequence: 1, groupNumber: 2 },
    ]);
    expect(crosswise.orderDependencies).toEqual([
      {
        beforeGripId: "target",
        afterGripId: "dependent",
        source: "inferred",
      },
    ]);
  });

  it("rebuilds generated identity deltas with the configured inlet orientation", () => {
    const generatedPattern: StackPattern = {
      ...pattern("generated-crosswise-delta"),
      placements: [
        {
          sourcePlacementId: "placement-dependent",
          sequence: 0,
          positionMm: { x: 50, y: 50 },
          rotation: 0,
          gripId: "dependent",
          labelSide: null,
        },
        {
          sourcePlacementId: "placement-target",
          sequence: 1,
          positionMm: { x: 150, y: 110 },
          rotation: 0,
          gripId: "target",
          labelSide: null,
        },
      ],
      grips: [
        {
          sourceGripId: "dependent",
          groupNumber: 1,
          sequence: 0,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 50,
          y: 50,
          rotation: 0,
          numPackages: 1,
          dx: -1,
          dy: 0,
        },
        {
          sourceGripId: "target",
          groupNumber: 2,
          sequence: 1,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 150,
          y: 110,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
      ],
      groupOrder: ["dependent", "target"],
      orderDependencies: [
        {
          beforeGripId: "target",
          afterGripId: "dependent",
          source: "inferred",
        },
      ],
      generatedGripPolicy: { maxReferenceGapMm: 60 },
      provenance: {
        kind: "solver-candidate",
        candidateId: "generated-crosswise-delta",
        geometryId: "generated-crosswise-delta-geometry",
        identityFingerprint: "generated-crosswise-delta-identity",
        geometryFingerprint: "generated-crosswise-delta-fingerprint",
        rank: 1,
        generators: [],
      },
    };

    const lengthwise = transformStackPattern(
      generatedPattern,
      "identity",
      { length: 100, width: 40 },
      "lengthwise",
    );
    const crosswise = transformStackPattern(
      generatedPattern,
      "identity",
      { length: 100, width: 40 },
      "crosswise",
    );

    expect(lengthwise.groupOrder).toEqual(["target", "dependent"]);
    expect(lengthwise.grips.map(({ dx, dy }) => ({ dx, dy }))).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
    expect(lengthwise.orderDependencies).toEqual([]);
    expect(crosswise.groupOrder).toEqual(["target", "dependent"]);
    expect(crosswise.grips.map(({ dx, dy }) => ({ dx, dy }))).toEqual([
      { dx: 0, dy: 0 },
      { dx: -1, dy: 0 },
    ]);
    expect(crosswise.orderDependencies).toEqual([
      {
        beforeGripId: "target",
        afterGripId: "dependent",
        source: "inferred",
      },
    ]);
  });

  it("keeps a cyclic project pattern visible for inspection with an error", () => {
    const cyclicPattern: StackPattern = {
      ...pattern("cyclic-project-order"),
      placements: [
        {
          sourcePlacementId: "placement-upper",
          sequence: 0,
          positionMm: { x: 50, y: 150 },
          rotation: 0,
          gripId: "upper",
          labelSide: null,
        },
        {
          sourcePlacementId: "placement-lower",
          sequence: 1,
          positionMm: { x: 50, y: 50 },
          rotation: 0,
          gripId: "lower",
          labelSide: null,
        },
      ],
      grips: [
        {
          sourceGripId: "upper",
          groupNumber: 1,
          sequence: 0,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 50,
          y: 150,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
        {
          sourceGripId: "lower",
          groupNumber: 2,
          sequence: 1,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 50,
          y: 50,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
      ],
      groupOrder: ["upper", "lower"],
      orderDependencies: [
        {
          beforeGripId: "upper",
          afterGripId: "lower",
          source: "explicit",
        },
      ],
    };

    const result = materializeStack({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 100, height: 20 },
        weightKg: 1,
        weightProvenance: derived,
        inletOrientation: "lengthwise",
      },
      pallet: {
        id: "pallet",
        dimensionsMm: { length: 200, width: 200, height: 10 },
        allowedOverhangMm: { length: 0, width: 0 },
        storageEnvelopeMm: { length: 200, width: 200, height: 100 },
        tareKg: 5,
        maxGrossKg: 100,
      },
      resources: {
        selectedGripperId: "gripper",
        selectedPalletStationId: "station",
        availableMaterialResourceIds: [],
      },
      patterns: [cyclicPattern],
      layers: [
        {
          id: "layer-1",
          patternRef: cyclicPattern.ref,
          transform: "identity",
          provenance: { kind: "manual", reason: "test" },
        },
      ],
      interlayers: { mode: "individual", beforeLayer: {} },
    });

    expect(result.packageLayers).toHaveLength(1);
    expect(result.packageLayers[0]?.placements).toHaveLength(2);
    expect(result.packageLayers[0]?.groupOrder).toEqual(["upper", "lower"]);
    const warning = result.warnings.find(
      ({ id }) => id === "invalid-stack-input:transform:layer-1",
    );
    expect(warning).toMatchObject({
      id: "invalid-stack-input:transform:layer-1",
      code: "invalid-stack-input",
      severity: "error",
    });
    expect(warning?.message).toMatch(/dependencies contain a cycle/i);
  });

  it("repairs project grip order when a transform creates a hard overlap dependency", () => {
    const projectPattern: StackPattern = {
      ...pattern("project-order"),
      placements: [
        {
          sourcePlacementId: "placement-upper-after-rotation",
          sequence: 0,
          positionMm: { x: 150, y: 100 },
          rotation: 0,
          gripId: "upper-after-rotation",
          labelSide: null,
        },
        {
          sourcePlacementId: "placement-lower-after-rotation",
          sequence: 1,
          positionMm: { x: 50, y: 100 },
          rotation: 0,
          gripId: "lower-after-rotation",
          labelSide: null,
        },
      ],
      grips: [
        {
          sourceGripId: "upper-after-rotation",
          groupNumber: 1,
          sequence: 0,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 150,
          y: 100,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
        {
          sourceGripId: "lower-after-rotation",
          groupNumber: 2,
          sequence: 1,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 50,
          y: 100,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
      ],
      groupOrder: ["upper-after-rotation", "lower-after-rotation"],
      orderDependencies: [],
      transformFrameMm: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    };

    const transformed = transformStackPattern(projectPattern, "rotate-90", {
      length: 100,
      width: 100,
    });

    expect(transformed.groupOrder).toEqual([
      "lower-after-rotation",
      "upper-after-rotation",
    ]);
    expect(
      transformed.grips.map(({ sourceGripId, sequence, groupNumber }) => ({
        sourceGripId,
        sequence,
        groupNumber,
      })),
    ).toEqual([
      {
        sourceGripId: "lower-after-rotation",
        sequence: 0,
        groupNumber: 1,
      },
      {
        sourceGripId: "upper-after-rotation",
        sequence: 1,
        groupNumber: 2,
      },
    ]);
    expect(transformed.orderDependencies).toEqual([
      {
        beforeGripId: "lower-after-rotation",
        afterGripId: "upper-after-rotation",
        source: "inferred",
      },
    ]);

    expect(() =>
      transformStackPattern(
        {
          ...projectPattern,
          orderDependencies: [
            {
              beforeGripId: "upper-after-rotation",
              afterGripId: "lower-after-rotation",
              source: "explicit",
            },
          ],
        },
        "rotate-90",
        { length: 100, width: 100 },
      ),
    ).toThrow(/dependencies contain a cycle/i);
  });

  it("preserves project-defined grip order while transforming its geometry and deltas", () => {
    const generated = generatedGridPattern();
    const projectPattern: StackPattern = {
      ...generated,
      generatedGripPolicy: null,
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
    expect(transformed.orderDependencies).toEqual(
      generated.orderDependencies
        .map((dependency) => ({
          ...dependency,
          source: "explicit" as const,
        }))
        .sort(
          (left, right) =>
            left.beforeGripId.localeCompare(right.beforeGripId) ||
            left.afterGripId.localeCompare(right.afterGripId),
        ),
    );
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
