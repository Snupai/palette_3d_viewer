import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type {
  Gripper,
  PackagePlacement,
  PalletSpec,
  PalletStation,
  PlanningSolution,
  Project,
} from "~/domain/project/projectSchema";
import {
  CALCULATED_CONVEYOR_OBSTACLE_ID,
  boundsContained,
  checkObstacleAlongSegment,
  checkObstacleAtPose,
  checkReachBoundary,
  createRobotCycleMotionRoute,
  createRobotCycleReport,
  createRobotCycleTransitionRoute,
  createRobotEditorFlow,
  createRobotTimeline,
  exportProjectRob,
  getRetainedRawRobDownload,
  horizontalEnvelopeBounds,
  materializeRobotCycles,
  nextRobotTimelineBoundary,
  palletPointToStation,
  pointWithinHorizontalEnvelope,
  previousRobotTimelineBoundary,
  seekRobotTimeline,
  stationPointToPallet,
  suggestRobotOrder,
  transformYawForDirection,
  validateCycleMotionBoundaries,
  type RobExportOptions,
  type RobotCycle,
  type RobotGripGroup,
  type RobotPose,
} from "~/domain/robotics";
import { parseRobText } from "~/lib/robParser";

function suctionGripper(id = "suction-1"): Gripper {
  return {
    id,
    name: `Suction ${id}`,
    externalId: null,
    isDefault: id === "suction-1",
    maxPickupLengthMm: 250,
    tcpMm: { x: 0, y: 0, z: 0 },
    envelopeMm: {
      negativeX: 10,
      positiveX: 10,
      negativeY: 10,
      positiveY: 10,
    },
    inletOrientation: "any",
    allowedPlaceRotations: [0, 90, 180, 270],
    packageLimits: {
      lengthMm: { min: 1, max: 1_000 },
      widthMm: { min: 1, max: 1_000 },
      heightMm: { min: 1, max: 1_000 },
    },
    settings: { type: "suction", multipickSinglePlace: false },
  };
}

function station(overrides: Partial<PalletStation> = {}): PalletStation {
  return {
    id: "station-1",
    name: "Station 1",
    externalId: null,
    isDefault: true,
    palletOrigin: { x: "left", y: "bottom" },
    obstacleEnvelopeMm: {
      negativeX: 20_000,
      positiveX: 20_000,
      negativeY: 20_000,
      positiveY: 20_000,
    },
    tcpEnvelopeMm: {
      negativeX: 20_000,
      positiveX: 20_000,
      negativeY: 20_000,
      positiveY: 20_000,
    },
    allowedDirections: [
      "x-positive-y-positive",
      "x-positive-y-negative",
      "x-negative-y-positive",
      "x-negative-y-negative",
    ],
    preferredDirection: "x-positive-y-positive",
    robotCenterMm: { x: 0, y: 0 },
    robotRadiusMm: { min: 0, max: 20_000 },
    inletAlignment: "center",
    ...overrides,
  };
}

function pallet(
  dimensionsMm: PalletSpec["dimensionsMm"] = {
    length: 1_200,
    width: 800,
    height: 144,
  },
): PalletSpec {
  return {
    id: "pallet-1",
    name: "Test pallet",
    kind: "custom",
    dimensionsMm,
    storageEnvelopeMm: null,
    allowedOverhangMm: { length: 0, width: 0 },
    tareKg: null,
    maxGrossKg: null,
    subPalletPattern: "none",
  };
}

function calculatedProject(input: {
  placements: PackagePlacement[];
  dimensionsMm?: { length: number; width: number; height: number };
  palletDimensionsMm?: { length: number; width: number; height: number };
  origin?: PlanningSolution["origin"];
  robotCycles?: PlanningSolution["robotCycles"];
  grippers?: Gripper[];
  selectedGripperId?: string;
  source?: Project["source"];
}) {
  const patternId = "pattern-1";
  const solutionId = "solution-1";
  const grippers = input.grippers ?? [suctionGripper()];
  return createProject(
    {
      id: "robot-project",
      ...(input.source ? { source: input.source } : {}),
      package: {
        dimensionsMm: input.dimensionsMm ?? {
          length: 100,
          width: 50,
          height: 40,
        },
        multiPickAllowed: true,
        inletOrientation: "lengthwise",
        palletizingDirection: "x-positive-y-positive",
      },
      pallet: pallet(
        input.palletDimensionsMm ?? {
          length: 1_200,
          width: 800,
          height: 144,
        },
      ),
      grippers,
      palletStations: [station()],
      selectedGripperId: input.selectedGripperId ?? grippers[0]!.id,
      selectedPalletStationId: "station-1",
      solutions: [
        {
          id: solutionId,
          name: "Robot solution",
          origin: input.origin ?? "calculated",
          patterns: [
            {
              id: patternId,
              name: "Pattern 1",
              grips: [],
              placements: input.placements,
            },
          ],
          stack: {
            interlayerThicknessMm: 3,
            layers: [
              { id: "physical-layer-1", patternId, interlayerBefore: 0 },
            ],
            trailingInterlayer: 0,
          },
          robotCycles: input.robotCycles ?? [],
        },
      ],
      activeSolutionId: solutionId,
    },
    { createId: (kind) => `${kind}-unused`, now: () => 1 },
  );
}

function projectWithRobotPatterns(input: {
  patterns: PlanningSolution["patterns"];
  layers: PlanningSolution["stack"]["layers"];
  robotCycles?: PlanningSolution["robotCycles"];
  origin?: PlanningSolution["origin"];
}) {
  const gripper = suctionGripper();
  return createProject(
    {
      id: "multi-pattern-robot-project",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 40 },
        multiPickAllowed: true,
        inletOrientation: "lengthwise",
        palletizingDirection: "x-positive-y-positive",
      },
      pallet: pallet(),
      grippers: [gripper],
      palletStations: [station()],
      selectedGripperId: gripper.id,
      selectedPalletStationId: "station-1",
      solutions: [
        {
          id: "solution-1",
          name: "Robot solution",
          origin: input.origin ?? "manual",
          patterns: input.patterns,
          stack: {
            interlayerThicknessMm: 3,
            layers: input.layers,
            trailingInterlayer: 0,
          },
          robotCycles: input.robotCycles ?? [],
        },
      ],
      activeSolutionId: "solution-1",
    },
    { createId: (kind) => `${kind}-unused`, now: () => 1 },
  );
}

function placement(
  id: string,
  sequence: number,
  x: number,
  y: number,
): PackagePlacement {
  return {
    id,
    sequence,
    positionMm: { x, y },
    rotation: 0,
    gripId: null,
    labelSide: null,
  };
}

const pickReference = {
  originMm: { x: -1_000, y: 0, z: 100 },
  yawDeg: 0,
  provenance: { status: "verified" as const, source: "test-conveyor" },
};

const identityExportOptions = (
  cycleIds: readonly string[],
): RobExportOptions => ({
  quantization: { mode: "reject-decimals" },
  signConvention: {
    id: "identity-station-v1",
    xSign: 1,
    ySign: 1,
    yawSign: 1,
    yawOffsetDeg: 0,
    provenance: {
      status: "repository-behavior",
      source: "synthetic golden fixture",
    },
  },
  unknownFields: {
    mode: "explicit-values",
    semantics:
      "synthetic zero fields; external semantics intentionally unstated",
    provenance: "test fixture",
    valuesByCycleId: Object.fromEntries(
      cycleIds.map((cycleId) => [cycleId, { field8: 0, field9: 0 }]),
    ),
  },
});

function pose(x: number, y: number, z: number, yawDeg: number): RobotPose {
  return { frame: "station", positionMm: { x, y, z }, yawDeg };
}

function cycle(
  id: string,
  sequence: number,
  pickPose: RobotPose,
  transferPose: RobotPose,
  placePose: RobotPose,
): RobotCycle {
  return {
    id,
    sequence,
    sequenceInLayer: sequence,
    physicalLayerId: "layer-1",
    physicalLayerIndex: 0,
    patternRef: "pattern-1",
    groupId: `group-${sequence + 1}`,
    groupNumber: sequence + 1,
    placementIds: [`placement-${sequence + 1}`],
    packageCount: 1,
    gripperId: "suction-1",
    stationId: "station-1",
    pickPose,
    transferPose,
    placePose,
    legacyUnknownFields: null,
    provenance: {
      cycleSource: "calculated-suction-cycle",
      groupingSource: "suction-adjacency-v1",
      orderSource: "suggested-topological",
      poseSource: "calculated-project-resources",
      sourceSolutionOrigin: "calculated",
      sourceCycleId: null,
      sourceGripId: null,
      pickReferenceProvenance: {
        status: "verified",
        source: "test fixture",
      },
      coordinateConvention: "test",
      tcpOffsetConvention: "tcp-to-grasp-vector-subtracted",
      signConventionStatus: "project-defined",
    },
  };
}

describe("robotics materialization and ordering", () => {
  it("materializes the synthetic 55-placement plan as 36 cycles: 19 doubles and 17 singles", () => {
    const placements: PackagePlacement[] = [];
    let sequence = 0;
    for (let pairIndex = 0; pairIndex < 19; pairIndex += 1) {
      const y = 100 + pairIndex * 100;
      placements.push(
        placement(`pair-${pairIndex + 1}-a`, sequence++, 100, y),
        placement(`pair-${pairIndex + 1}-b`, sequence++, 200, y),
      );
    }
    for (let singleIndex = 0; singleIndex < 17; singleIndex += 1) {
      placements.push(
        placement(
          `single-${singleIndex + 1}`,
          sequence++,
          500,
          2_500 + singleIndex * 100,
        ),
      );
    }
    const project = calculatedProject({
      placements,
      palletDimensionsMm: { length: 1_200, width: 5_000, height: 144 },
    });

    const materialized = materializeRobotCycles(project, {
      pickReference: {
        ...pickReference,
        originMm: { x: 1_000, y: 1_000, z: 1_000 },
      },
      maxPackagesPerPick: 2,
      transferClearanceMm: 200,
    });
    const report = createRobotCycleReport(materialized);
    const flow = createRobotEditorFlow(materialized);
    const timeline = createRobotTimeline(materialized.cycles);

    expect(materialized.valid).toBe(true);
    expect(materialized.cycles).toHaveLength(36);
    expect(report).toMatchObject({
      cycleCount: 36,
      doubleCount: 19,
      singleCount: 17,
      packageCount: 55,
    });
    expect(flow.map(({ cycleId }) => cycleId)).toEqual(
      materialized.cycles.map(({ id }) => id),
    );
    expect(timeline.cycles).toBe(materialized.cycles);
  });

  it("applies the default Multipack profile's crosswise package limits during materialization", () => {
    const project = createProject(
      {
        id: "multipack-crosswise-limit-project",
        package: {
          dimensionsMm: { length: 400, width: 350, height: 200 },
          multiPickAllowed: false,
          inletOrientation: "crosswise",
          palletizingDirection: "x-negative-y-positive",
        },
        pallet: pallet(),
        solutions: [
          {
            id: "solution-1",
            name: "Multipack crosswise limit",
            origin: "calculated",
            patterns: [
              {
                id: "pattern-1",
                name: "Pattern 1",
                grips: [],
                placements: [placement("package-1", 0, 200, 175)],
              },
            ],
            stack: {
              interlayerThicknessMm: 3,
              layers: [
                {
                  id: "physical-layer-1",
                  patternId: "pattern-1",
                  interlayerBefore: 0,
                },
              ],
              trailingInterlayer: 0,
            },
            robotCycles: [],
          },
        ],
        activeSolutionId: "solution-1",
      },
      { createId: (kind) => `${kind}-unused`, now: () => 1 },
    );

    const materialized = materializeRobotCycles(project, { pickReference });

    expect(materialized.diagnostics).toContainEqual(
      expect.objectContaining({
        phase: "compatibility",
        code: "package-width-out-of-range",
        details: { value: 350, minimum: 50, maximum: 300 },
      }),
    );
  });

  it("accepts derived pick-reference provenance and retains it on generated cycles", () => {
    const project = calculatedProject({
      placements: [placement("package-1", 0, 100, 50)],
    });
    const derivedPickReference = {
      ...pickReference,
      provenance: {
        status: "derived" as const,
        source: "derived from a verified station survey",
      },
    };

    const materialized = materializeRobotCycles(project, {
      pickReference: derivedPickReference,
    });
    const exported = exportProjectRob(
      materialized,
      identityExportOptions(materialized.cycles.map(({ id }) => id)),
    );

    expect(materialized.valid).toBe(true);
    expect(materialized.conveyor).toMatchObject({
      id: "calculated-feed-conveyor",
      centerMm: { x: -950, y: -25, z: -10 },
      dimensionsMm: { length: 1_200, width: 500, height: 140 },
      travelAxis: "x",
    });
    expect(materialized.cycles[0]).toMatchObject({
      pickPose: { frame: "station" },
      provenance: {
        pickReferenceProvenance: derivedPickReference.provenance,
      },
    });
    expect(exported.ok).toBe(true);
  });

  it("derives pickup as the top-center of each box group without a surveyed conveyor origin", () => {
    const project = calculatedProject({
      placements: [
        placement("package-a", 0, 100, 50),
        placement("package-b", 1, 200, 50),
      ],
    });
    const materialized = materializeRobotCycles(project, {
      maxPackagesPerPick: 2,
    });
    const exported = exportProjectRob(
      materialized,
      identityExportOptions(materialized.cycles.map(({ id }) => id)),
    );

    expect(materialized.valid).toBe(true);
    expect(materialized.conveyor).toBeNull();
    expect(materialized.diagnostics.map(({ code }) => code)).not.toContain(
      "missing-pick-reference",
    );
    expect(materialized.cycles).toHaveLength(1);
    expect(materialized.cycles[0]).toMatchObject({
      packageCount: 2,
      pickPose: {
        frame: "station",
        positionMm: { x: 100, y: -25, z: 40 },
        yawDeg: 0,
      },
      provenance: {
        pickReferenceProvenance: {
          status: "derived",
          source: "package-group-top-center-v1",
        },
      },
    });
    expect(exported.ok).toBe(true);
    expect(exported.text).not.toBeNull();
    expect(parseRobText(exported.text!).uniqueLayers[1]).toEqual([
      expect.objectContaining({
        pickX: 100,
        pickY: -25,
        pickRotation: 0,
        x: 150,
        y: 50,
        rotation: 0,
        numPackages: 2,
        dx: 0,
        dy: 0,
      }),
    ]);
  });

  it("checks the generated conveyor bed in materialization collision diagnostics", () => {
    const project = calculatedProject({
      placements: [placement("package-1", 0, 100, 50)],
    });
    const materialized = materializeRobotCycles(project, {
      pickReference: {
        ...pickReference,
        originMm: { x: 0, y: 0, z: 100 },
      },
    });

    expect(materialized.conveyor).not.toBeNull();
    expect(materialized.valid).toBe(false);
    expect(materialized.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        phase: "collision",
        code: "obstacle-collision",
        resourceId: CALCULATED_CONVEYOR_OBSTACLE_ID,
      }),
    );
  });

  it("repairs edited orders against hard dependencies", () => {
    const groups: RobotGripGroup[] = [
      {
        id: "a",
        groupNumber: 1,
        physicalLayerId: "layer",
        physicalLayerIndex: 0,
        placementIds: ["a"],
        packageCount: 1,
        centerPalletMm: { x: 100, y: 0, z: 40 },
        placeRotationDeg: 0,
        sourceGripId: null,
        sourceCycleId: null,
        sourceSequence: null,
        groupingSource: "suction-adjacency-v1",
      },
      {
        id: "b",
        groupNumber: 2,
        physicalLayerId: "layer",
        physicalLayerIndex: 0,
        placementIds: ["b"],
        packageCount: 1,
        centerPalletMm: { x: 200, y: 0, z: 40 },
        placeRotationDeg: 0,
        sourceGripId: null,
        sourceCycleId: null,
        sourceSequence: null,
        groupingSource: "suction-adjacency-v1",
      },
      {
        id: "c",
        groupNumber: 3,
        physicalLayerId: "layer",
        physicalLayerIndex: 0,
        placementIds: ["c"],
        packageCount: 1,
        centerPalletMm: { x: 300, y: 0, z: 40 },
        placeRotationDeg: 0,
        sourceGripId: null,
        sourceCycleId: null,
        sourceSequence: null,
        groupingSource: "suction-adjacency-v1",
      },
    ];
    const dependencies = [
      { beforeGroupId: "c", afterGroupId: "a", source: "explicit" as const },
    ];

    const suggested = suggestRobotOrder(
      groups,
      dependencies,
      "x-positive-y-positive",
    );
    const edited = suggestRobotOrder(
      groups,
      dependencies,
      "x-positive-y-positive",
      ["a", "b", "c"],
    );

    expect(suggested.order).toEqual(["c", "b", "a"]);
    expect(edited.order).toEqual(["b", "c", "a"]);
    expect(edited.diagnostics.map(({ code }) => code)).not.toContain(
      "order-dependency-violation",
    );
  });

  it("repairs a persisted pattern order before materializing numbered cycles", () => {
    const lowerGripId = "lower-grip";
    const upperGripId = "upper-grip";
    const project = projectWithRobotPatterns({
      patterns: [
        {
          id: "pattern-1",
          name: "Invalid persisted order",
          grips: [
            {
              id: upperGripId,
              groupNumber: 1,
              pickX: 0,
              pickY: 0,
              pickRotation: 0,
              x: 100,
              y: 100,
              rotation: 0,
              numPackages: 1,
              dx: 0,
              dy: 0,
            },
            {
              id: lowerGripId,
              groupNumber: 2,
              pickX: 0,
              pickY: 0,
              pickRotation: 0,
              x: 100,
              y: 50,
              rotation: 0,
              numPackages: 1,
              dx: 0,
              dy: 0,
            },
          ],
          placements: [
            { ...placement("upper-package", 0, 100, 100), gripId: upperGripId },
            { ...placement("lower-package", 1, 100, 50), gripId: lowerGripId },
          ],
          groupOrder: [upperGripId, lowerGripId],
          orderDependencies: [],
        },
      ],
      layers: [
        { id: "physical-layer-1", patternId: "pattern-1", interlayerBefore: 0 },
      ],
    });

    const materialized = materializeRobotCycles(project, { pickReference });

    expect(
      materialized.cycles.map(({ provenance }) => provenance.sourceGripId),
    ).toEqual([lowerGripId, upperGripId]);
    expect(
      materialized.cycles.map(({ groupNumber, sequenceInLayer }) => ({
        groupNumber,
        sequenceInLayer,
      })),
    ).toEqual([
      { groupNumber: 1, sequenceInLayer: 0 },
      { groupNumber: 2, sequenceInLayer: 1 },
    ]);
    expect(materialized.diagnostics.map(({ code }) => code)).not.toContain(
      "order-dependency-violation",
    );
  });

  it("preserves explicit imported cycles while reporting selected-gripper mismatch", () => {
    const placements = [placement("package-1", 0, 100, 50)];
    const project = calculatedProject({
      placements,
      origin: "imported",
      source: { kind: "rob-import", fileName: "fixture.rob" },
      grippers: [suctionGripper("suction-1"), suctionGripper("suction-2")],
      selectedGripperId: "suction-1",
      robotCycles: [
        {
          id: "imported-cycle",
          patternId: "pattern-1",
          sequence: 0,
          gripId: null,
          placementIds: ["package-1"],
          gripperId: "suction-2",
          pickPose: { x: 11, y: -22, z: 333, rotation: 90 },
          placePose: { x: 101, y: 51, z: 40, rotation: 180 },
          labelOffset: { x: 7, y: -9 },
        },
      ],
    });

    const materialized = materializeRobotCycles(project, { pickReference });

    expect(materialized.valid).toBe(false);
    expect(materialized.conveyor).toBeNull();
    expect(materialized.diagnostics.map(({ code }) => code)).toContain(
      "cycle-gripper-mismatch",
    );
    expect(materialized.cycles[0]).toMatchObject({
      gripperId: "suction-2",
      pickPose: {
        frame: "legacy-rob",
        positionMm: { x: 11, y: -22, z: 333 },
        yawDeg: 90,
      },
      legacyUnknownFields: {
        field8: 7,
        field9: -9,
        semantics: "repository-dx-dy-unverified",
      },
      provenance: {
        cycleSource: "imported-project-cycle",
        poseSource: "imported-legacy-rob-pose",
      },
    });
  });

  it("blocks generated clamp/fork mechanics while keeping suction resources supported", () => {
    const clamp: Gripper = {
      ...suctionGripper("clamp-1"),
      name: "Clamp 1",
      settings: {
        type: "clamp",
        allowedPickPositions: ["0-center"],
        packageOverhangMm: 0,
        maxOverhangMm: 0,
        flapLengthMm: 0,
      },
    };
    const project = calculatedProject({
      placements: [placement("package-1", 0, 100, 50)],
      grippers: [clamp],
      selectedGripperId: clamp.id,
    });

    const materialized = materializeRobotCycles(project, { pickReference });

    expect(materialized.valid).toBe(false);
    expect(materialized.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unsupported-gripper-type",
        resourceId: clamp.id,
      }),
    );
  });
});

describe("coordinate frames and safety boundaries", () => {
  it("roundtrips pallet/station points and mirrors yaw with explicit origin/signs", () => {
    const testPallet = pallet({ length: 1_200, width: 800, height: 144 });
    const testStation = station({
      palletOrigin: { x: "center", y: "center" },
    });
    const source = { x: 0, y: 0, z: 500 };

    const transformed = palletPointToStation(
      source,
      testPallet,
      testStation,
      "x-negative-y-positive",
    );

    expect(transformed).toEqual({ x: 600, y: -400, z: 500 });
    expect(
      stationPointToPallet(
        transformed,
        testPallet,
        testStation,
        "x-negative-y-positive",
      ),
    ).toEqual(source);
    expect(transformYawForDirection(0, "x-negative-y-positive")).toBe(180);
    expect(transformYawForDirection(90, "x-negative-y-positive")).toBe(90);
  });

  it("treats exact reach/envelope boundaries as valid and detects crossings", () => {
    const boundedStation = station({
      robotCenterMm: { x: 0, y: 0 },
      robotRadiusMm: { min: 100, max: 200 },
      tcpEnvelopeMm: {
        negativeX: 100,
        positiveX: 100,
        negativeY: 50,
        positiveY: 50,
      },
    });
    expect(
      checkReachBoundary(pose(100, 0, 0, 0), boundedStation),
    ).toMatchObject({ status: "checked", valid: true });
    expect(
      checkReachBoundary(pose(200, 0, 0, 0), boundedStation),
    ).toMatchObject({ status: "checked", valid: true });
    expect(
      checkReachBoundary(pose(99.999, 0, 0, 0), boundedStation),
    ).toMatchObject({ status: "checked", valid: false });
    expect(
      pointWithinHorizontalEnvelope(
        pose(100, 50, 0, 0),
        boundedStation.tcpEnvelopeMm,
      ),
    ).toBe(true);
    expect(
      pointWithinHorizontalEnvelope(
        pose(100.001, 50, 0, 0),
        boundedStation.tcpEnvelopeMm,
      ),
    ).toBe(false);

    const toolBounds = horizontalEnvelopeBounds(pose(90, 0, 0, 0), {
      negativeX: 10,
      positiveX: 10,
      negativeY: 5,
      positiveY: 5,
    });
    expect(
      boundsContained(
        { minX: -100, minY: -50, maxX: 100, maxY: 50 },
        toolBounds,
      ),
    ).toBe(true);
  });

  it("treats a 0 / 0 station radius as reach not calibrated", () => {
    const uncalibratedStation = station({
      robotCenterMm: { x: 0, y: 0 },
      robotRadiusMm: { min: 0, max: 0 },
    });
    const reach = checkReachBoundary(
      pose(1_000, 500, 300, 0),
      uncalibratedStation,
    );
    const diagnostics = validateCycleMotionBoundaries(
      [
        cycle(
          "uncalibrated-cycle",
          0,
          pose(1_000, 500, 300, 0),
          pose(1_000, 500, 500, 0),
          pose(500, 400, 300, 0),
        ),
      ],
      uncalibratedStation,
      { negativeX: 0, positiveX: 0, negativeY: 0, positiveY: 0 },
    );

    expect(reach).toMatchObject({
      status: "not-checked",
      reason: "zero-radius-sentinel",
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        phase: "reach",
        code: "reach-not-checked-zero-radius-sentinel",
      }),
    );
    expect(
      diagnostics.some(
        ({ code }) =>
          code === "reach-below-minimum" || code === "reach-above-maximum",
      ),
    ).toBe(false);
  });

  it("performs conservative pose and swept-envelope obstacle checks", () => {
    const envelope = {
      negativeX: 10,
      positiveX: 10,
      negativeY: 10,
      positiveY: 10,
    };
    const obstacle = {
      id: "guard",
      boundsMm: { minX: 10, minY: -5, maxX: 20, maxY: 5 },
      minZMm: 0,
      maxZMm: 100,
    };

    expect(checkObstacleAtPose(pose(0, 0, 50, 0), envelope, obstacle)).toBe(
      true,
    );
    expect(
      checkObstacleAtPose(pose(-0.001, 0, 50, 0), envelope, obstacle),
    ).toBe(false);
    expect(
      checkObstacleAlongSegment(
        pose(-50, 0, 50, 0),
        pose(50, 0, 50, 0),
        envelope,
        obstacle,
      ),
    ).toBe(true);
  });

  it("builds carried and between-cycle motion with vertical approaches and elevated traversal", () => {
    const carried = createRobotCycleMotionRoute(
      cycle(
        "carried",
        0,
        pose(0, 10, 100, 0),
        pose(200, 30, 450, 90),
        pose(400, 500, 150, 180),
      ),
    );

    expect(carried.segments.map(({ kind }) => kind)).toEqual([
      "pick-lift",
      "pick-traverse",
      "transfer-traverse",
      "place-approach",
    ]);
    expect(carried.segments[0]).toMatchObject({
      from: { pose: { positionMm: { x: 0, y: 10, z: 100 } } },
      to: { pose: { positionMm: { x: 0, y: 10, z: 450 } } },
    });
    for (const segment of carried.segments.slice(1, 3)) {
      expect(segment.from.pose.positionMm.z).toBe(450);
      expect(segment.to.pose.positionMm.z).toBe(450);
    }
    expect(carried.segments[3]).toMatchObject({
      from: { pose: { positionMm: { x: 400, y: 500, z: 450 } } },
      to: { pose: { positionMm: { x: 400, y: 500, z: 150 } } },
    });

    const transition = createRobotCycleTransitionRoute(
      cycle(
        "previous",
        0,
        pose(-100, 0, 80, 0),
        pose(100, 200, 400, 90),
        pose(300, 400, 120, 180),
      ),
      cycle(
        "next",
        1,
        pose(-200, -300, 60, 0),
        pose(50, 75, 500, 90),
        pose(600, 700, 160, 180),
      ),
    );

    expect(transition.segments.map(({ kind }) => kind)).toEqual([
      "cycle-retract",
      "cycle-traverse",
      "pick-approach",
    ]);
    expect(transition.segments[0]).toMatchObject({
      from: { pose: { positionMm: { x: 300, y: 400, z: 120 } } },
      to: { pose: { positionMm: { x: 300, y: 400, z: 500 } } },
    });
    expect(transition.segments[1]!.from.pose.positionMm.z).toBe(500);
    expect(transition.segments[1]!.to.pose.positionMm.z).toBe(500);
    expect(transition.segments[2]).toMatchObject({
      from: { pose: { positionMm: { x: -200, y: -300, z: 500 } } },
      to: { pose: { positionMm: { x: -200, y: -300, z: 60 } } },
    });
  });

  it("checks the same safe route used by timeline playback", () => {
    const testCycle = cycle(
      "safe-route",
      0,
      pose(0, 0, 0, 0),
      pose(100, 0, 300, 0),
      pose(100, 100, 0, 0),
    );
    const envelope = {
      negativeX: 5,
      positiveX: 5,
      negativeY: 5,
      positiveY: 5,
    };
    const verticalLiftObstacle = {
      id: "lift-guard",
      boundsMm: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      minZMm: 100,
      maxZMm: 200,
    };
    const belowSafeTraverse = {
      id: "low-conveyor",
      boundsMm: { minX: 40, minY: -10, maxX: 60, maxY: 10 },
      minZMm: 0,
      maxZMm: 100,
    };

    const diagnostics = validateCycleMotionBoundaries(
      [testCycle],
      station(),
      envelope,
      [verticalLiftObstacle, belowSafeTraverse],
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "obstacle-collision",
        resourceId: "lift-guard",
        details: {
          phase: "pick-lift",
          check: "conservative-swept-aabb",
        },
      }),
    );
    expect(
      diagnostics.some(({ resourceId }) => resourceId === "low-conveyor"),
    ).toBe(false);
  });
});

describe("deterministic robot timeline", () => {
  it("uses exact forward/reverse boundaries and reversible pose interpolation", () => {
    const cycles = [
      cycle(
        "cycle-1",
        0,
        pose(0, 0, 0, 0),
        pose(100, 0, 0, 90),
        pose(100, 100, 0, 90),
      ),
      cycle(
        "cycle-2",
        1,
        pose(100, 100, 0, 90),
        pose(200, 100, 0, 180),
        pose(200, 200, 0, 180),
      ),
    ];
    const timeline = createRobotTimeline(cycles, {
      linearSpeedMmPerSec: 100,
      angularSpeedDegPerSec: 90,
      pickDwellMs: 100,
      placeDwellMs: 100,
      betweenCycleDwellMs: 0,
    });

    expect(timeline.valid).toBe(true);
    const boundary = timeline.segments[0]!.endMs;
    const forward = seekRobotTimeline(timeline, boundary, "forward")!;
    const reverse = seekRobotTimeline(timeline, boundary, "reverse")!;
    expect(forward.segment.kind).toBe("pick-traverse");
    expect(forward.segmentProgress).toBe(0);
    expect(reverse.segment.kind).toBe("pick-dwell");
    expect(reverse.segmentProgress).toBe(1);
    expect(forward.pose).toEqual(reverse.pose);

    const middle = seekRobotTimeline(timeline, boundary + 500)!;
    expect(middle.pose.positionMm.x).toBeCloseTo(50);
    expect(middle.pose.yawDeg).toBeCloseTo(45);

    for (const exactBoundary of timeline.boundariesMs) {
      expect(
        seekRobotTimeline(timeline, exactBoundary, "forward")?.pose,
      ).toEqual(seekRobotTimeline(timeline, exactBoundary, "reverse")?.pose);
    }
    expect(nextRobotTimelineBoundary(timeline, boundary)).toBe(
      timeline.segments[1]!.endMs,
    );
    expect(previousRobotTimelineBoundary(timeline, boundary)).toBe(0);
  });
});

describe("project-derived .rob export", () => {
  it("uses explicit source cycle ids before shared grip ids and avoids export aliases", () => {
    const sharedGripId = "shared-grip";
    const project = projectWithRobotPatterns({
      origin: "imported",
      patterns: [
        {
          id: "pattern-1",
          name: "Shared grip pattern",
          grips: [
            {
              id: sharedGripId,
              groupNumber: 1,
              pickX: 0,
              pickY: 0,
              pickRotation: 0,
              x: 0,
              y: 0,
              rotation: 0,
              numPackages: 2,
              dx: 0,
              dy: 0,
            },
          ],
          placements: [
            { ...placement("package-a", 0, 10, 10), gripId: sharedGripId },
            { ...placement("package-b", 1, 20, 10), gripId: sharedGripId },
          ],
        },
      ],
      layers: [
        { id: "physical-layer-1", patternId: "pattern-1", interlayerBefore: 0 },
      ],
      robotCycles: [
        {
          id: "explicit-cycle-a",
          patternId: "pattern-1",
          sequence: 0,
          gripId: sharedGripId,
          placementIds: ["package-a"],
          gripperId: "suction-1",
          pickPose: { x: 0, y: 0, z: 100, rotation: 0 },
          placePose: { x: 10, y: 10, z: 40, rotation: 0 },
          labelOffset: { x: 0, y: 0 },
        },
        {
          id: "explicit-cycle-b",
          patternId: "pattern-1",
          sequence: 1,
          gripId: sharedGripId,
          placementIds: ["package-b"],
          gripperId: "suction-1",
          pickPose: { x: 0, y: 0, z: 100, rotation: 0 },
          placePose: { x: 20, y: 10, z: 40, rotation: 0 },
          labelOffset: { x: 0, y: 0 },
        },
      ],
    });

    const materialized = materializeRobotCycles(project);
    const cycleIds = materialized.cycles.map(({ id }) => id);
    const exported = exportProjectRob(
      materialized,
      identityExportOptions(cycleIds),
    );

    expect(materialized.valid).toBe(true);
    expect(cycleIds).toEqual([
      "physical-layer-1:robot-cycle:explicit-cycle-a",
      "physical-layer-1:robot-cycle:explicit-cycle-b",
    ]);
    expect(new Set(cycleIds).size).toBe(cycleIds.length);
    expect(materialized.layers[0]?.cycleIds).toEqual(cycleIds);
    expect(materialized.diagnostics.map(({ code }) => code)).not.toContain(
      "duplicate-cycle-id",
    );
    expect(exported.ok).toBe(true);
    expect(
      parseRobText(exported.text!).uniqueLayers[1]?.map(({ x }) => x),
    ).toEqual([10, 20]);

    const duplicateIdMaterialization = {
      ...materialized,
      cycles: [
        materialized.cycles[0]!,
        { ...materialized.cycles[1]!, id: materialized.cycles[0]!.id },
      ],
      layers: [
        {
          ...materialized.layers[0]!,
          cycleIds: [materialized.cycles[0]!.id, materialized.cycles[0]!.id],
        },
      ],
      diagnostics: [],
      valid: true,
    };
    const duplicateExport = exportProjectRob(
      duplicateIdMaterialization,
      identityExportOptions(
        duplicateIdMaterialization.cycles.map(({ id }) => id),
      ),
    );
    expect(duplicateExport.ok).toBe(false);
    expect(duplicateExport.data).toBeNull();
    expect(duplicateExport.diagnostics).toContainEqual(
      expect.objectContaining({ code: "duplicate-cycle-id" }),
    );
  });

  it("exports calculated pattern-grip deltas as the final two ROB fields", () => {
    const gripId = "pattern-grip";
    const project = projectWithRobotPatterns({
      patterns: [
        {
          id: "pattern-1",
          name: "Calculated delta pattern",
          grips: [
            {
              id: gripId,
              groupNumber: 1,
              pickX: 0,
              pickY: 0,
              pickRotation: 0,
              x: 100,
              y: 50,
              rotation: 0,
              numPackages: 1,
              dx: 1,
              dy: -1,
            },
          ],
          placements: [{ ...placement("package-1", 0, 100, 50), gripId }],
          groupOrder: [gripId],
          orderDependencies: [],
        },
      ],
      layers: [
        { id: "physical-layer-1", patternId: "pattern-1", interlayerBefore: 0 },
      ],
    });
    const materialized = materializeRobotCycles(project, { pickReference });
    const options = identityExportOptions(
      materialized.cycles.map(({ id }) => id),
    );
    options.unknownFields = { mode: "preserve-imported" };

    const exported = exportProjectRob(materialized, options);
    const reparsed = parseRobText(exported.text!);

    expect(materialized.valid).toBe(true);
    expect(materialized.cycles[0]).toMatchObject({
      legacyUnknownFields: {
        field8: 1,
        field9: -1,
        semantics: "repository-dx-dy-unverified",
        source: "calculated-pattern-grip",
      },
      provenance: { sourceGripId: gripId },
    });
    expect(exported.ok).toBe(true);
    expect(exported.parserRoundtripVerified).toBe(true);
    expect(exported.manifest?.unknownFieldPolicy).toBe("preserve-imported");
    expect(reparsed.uniqueLayers[1]?.map(({ dx, dy }) => ({ dx, dy }))).toEqual(
      [{ dx: 1, dy: -1 }],
    );

    const adjacencyGrouped = materializeRobotCycles(
      calculatedProject({
        placements: [placement("ungrouped-package", 0, 100, 50)],
      }),
      { pickReference },
    );
    expect(adjacencyGrouped.cycles[0]?.legacyUnknownFields).toBeNull();
  });

  it("blocks one sign mapping across legacy and station coordinate frames", () => {
    const project = projectWithRobotPatterns({
      patterns: [
        {
          id: "legacy-pattern",
          name: "Legacy pattern",
          grips: [],
          placements: [placement("legacy-package", 0, 10, 10)],
        },
        {
          id: "generated-pattern",
          name: "Generated pattern",
          grips: [],
          placements: [placement("generated-package", 0, 100, 50)],
        },
      ],
      layers: [
        {
          id: "legacy-layer",
          patternId: "legacy-pattern",
          interlayerBefore: 0,
        },
        {
          id: "generated-layer",
          patternId: "generated-pattern",
          interlayerBefore: 0,
        },
      ],
      robotCycles: [
        {
          id: "legacy-cycle",
          patternId: "legacy-pattern",
          sequence: 0,
          gripId: null,
          placementIds: ["legacy-package"],
          gripperId: "suction-1",
          pickPose: { x: 0, y: 0, z: 100, rotation: 0 },
          placePose: { x: 10, y: 10, z: 40, rotation: 0 },
          labelOffset: { x: 0, y: 0 },
        },
      ],
    });
    const materialized = materializeRobotCycles(project, { pickReference });
    const exported = exportProjectRob(
      materialized,
      identityExportOptions(materialized.cycles.map(({ id }) => id)),
    );

    expect(materialized.valid).toBe(true);
    expect(materialized.cycles.map(({ pickPose }) => pickPose.frame)).toEqual([
      "legacy-rob",
      "station",
    ]);
    expect(exported.ok).toBe(false);
    expect(exported.text).toBeNull();
    expect(exported.data).toBeNull();
    expect(exported.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        phase: "export",
        code: "mixed-coordinate-frames",
      }),
    );
    expect(exported.manifest).toMatchObject({
      coordinateFrames: ["legacy-rob", "station"],
      signConvention: { id: "identity-station-v1" },
      parserRoundtrip: "pending",
    });
  });

  it("matches the golden text and verifies parser roundtrip", () => {
    const project = calculatedProject({
      placements: [
        placement("package-a", 0, 100, 50),
        placement("package-b", 1, 200, 50),
      ],
    });
    const materialized = materializeRobotCycles(project, {
      pickReference,
      maxPackagesPerPick: 2,
    });
    const exported = exportProjectRob(
      materialized,
      identityExportOptions(materialized.cycles.map(({ id }) => id)),
    );
    const golden = readFileSync(
      resolve(
        process.cwd(),
        "src",
        "domain",
        "robotics",
        "__fixtures__",
        "project-derived.golden.rob",
      ),
      "utf8",
    );

    expect(materialized.valid).toBe(true);
    expect(exported.ok).toBe(true);
    expect(exported.parserRoundtripVerified).toBe(true);
    expect(exported.text).toBe(golden);
    expect(exported.manifest).toMatchObject({
      source: "project-derived-robot-cycles",
      parserRoundtrip: "verified",
      unknownFieldPolicy: "explicit-values",
    });
    expect(parseRobText(exported.text!).total_boxes).toBe(2);
  });

  it("requires explicit decimal quantization and blocks empty plans", () => {
    const decimalProject = calculatedProject({
      dimensionsMm: { length: 100.5, width: 50.25, height: 40.5 },
      palletDimensionsMm: { length: 1_200.5, width: 800.25, height: 144.5 },
      placements: [
        placement("decimal-a", 0, 100.5, 50.25),
        placement("decimal-b", 1, 201, 50.25),
      ],
    });
    const materialized = materializeRobotCycles(decimalProject, {
      pickReference,
      maxPackagesPerPick: 2,
    });
    const reject = exportProjectRob(
      materialized,
      identityExportOptions(materialized.cycles.map(({ id }) => id)),
    );
    const roundedOptions = identityExportOptions(
      materialized.cycles.map(({ id }) => id),
    );
    roundedOptions.quantization = { mode: "round-half-away-from-zero" };
    const rounded = exportProjectRob(materialized, roundedOptions);

    expect(reject.ok).toBe(false);
    expect(reject.diagnostics.map(({ code }) => code)).toContain(
      "non-integer-value",
    );
    expect(rounded.ok).toBe(true);
    expect(parseRobText(rounded.text!).package).toEqual({
      width: 101,
      length: 50,
      height: 41,
    });

    const emptyProject = createProject(
      {
        id: "empty-robot-project",
        grippers: [suctionGripper()],
        palletStations: [station()],
        selectedGripperId: "suction-1",
        selectedPalletStationId: "station-1",
      },
      { createId: (kind) => `${kind}-empty`, now: () => 1 },
    );
    const emptyMaterialization = materializeRobotCycles(emptyProject, {
      pickReference,
    });
    const emptyExport = exportProjectRob(
      emptyMaterialization,
      identityExportOptions([]),
    );
    expect(emptyExport.ok).toBe(false);
    expect(emptyExport.diagnostics.map(({ code }) => code)).toContain(
      "empty-robot-plan",
    );
  });

  it("keeps retained raw imports separate from project-derived exports", () => {
    const project = createProject(
      {
        id: "raw-import",
        source: {
          kind: "rob-import",
          fileName: "source.rob",
          originalRawText: "ORIGINAL RAW ROB",
          rawRobText: "EDITED RAW ROB",
        },
      },
      { createId: (kind) => `${kind}-raw`, now: () => 1 },
    );

    expect(getRetainedRawRobDownload(project, "original")).toEqual({
      kind: "retained-raw-rob-import",
      variant: "original",
      fileName: "source.rob",
      text: "ORIGINAL RAW ROB",
      sourceField: "originalRawText",
      verification: "verbatim-retained-import",
    });
    expect(getRetainedRawRobDownload(project, "edited")?.text).toBe(
      "EDITED RAW ROB",
    );
  });
});
