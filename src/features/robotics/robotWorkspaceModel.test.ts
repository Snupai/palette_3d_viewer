import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type { Gripper, PalletStation } from "~/domain/project/projectSchema";
import {
  CALCULATED_CONVEYOR_OBSTACLE_ID,
  PACKAGE_GROUP_TOP_CENTER_PICK_SOURCE,
  exportProjectRob,
  materializeRobotCycles,
} from "~/domain/robotics";
import {
  createInitialRobotExportSettings,
  createInitialRobotWorkspaceSettings,
  createRobotReadiness,
  exportProjectRobDownload,
  materializationOptionsFromWorkspace,
  materializeRobotWorkspace,
  projectRobExportGate,
  robDownloadFileName,
  robotPoseToViewerPose,
  validateRobotWorkspaceSettings,
  workspacePickReferenceComplete,
  workspaceUsesDerivedPickReference,
} from "~/features/robotics/robotWorkspaceModel";
import { parseRobText } from "~/lib/robParser";

const gripper: Gripper = {
  id: "gripper-1",
  name: "Verified fixture suction",
  externalId: null,
  isDefault: true,
  maxPickupLengthMm: 500,
  tcpMm: { x: 0, y: 0, z: 0 },
  envelopeMm: {
    negativeX: 20,
    positiveX: 20,
    negativeY: 20,
    positiveY: 20,
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

const station: PalletStation = {
  id: "station-1",
  name: "Fixture station",
  externalId: null,
  isDefault: true,
  palletOrigin: { x: "left", y: "bottom" },
  obstacleEnvelopeMm: {
    negativeX: 5_000,
    positiveX: 5_000,
    negativeY: 5_000,
    positiveY: 5_000,
  },
  tcpEnvelopeMm: {
    negativeX: 5_000,
    positiveX: 5_000,
    negativeY: 5_000,
    positiveY: 5_000,
  },
  allowedDirections: ["x-positive-y-positive"],
  preferredDirection: "x-positive-y-positive",
  robotCenterMm: { x: 0, y: 0 },
  robotRadiusMm: { min: 0, max: 5_000 },
  inletAlignment: "center",
};

function projectFixture() {
  return createProject(
    {
      id: "workspace-project",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 40 },
        multiPickAllowed: true,
        palletizingDirection: "x-positive-y-positive",
      },
      grippers: [gripper],
      palletStations: [station],
      selectedGripperId: gripper.id,
      selectedPalletStationId: station.id,
      solutions: [
        {
          id: "solution-1",
          name: "Solution",
          origin: "calculated",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern",
              grips: [],
              placements: [
                {
                  id: "placement-1",
                  sequence: 0,
                  positionMm: { x: 100, y: 100 },
                  rotation: 0,
                  gripId: null,
                  labelSide: null,
                },
              ],
            },
          ],
          stack: {
            interlayerThicknessMm: 3,
            layers: [
              {
                id: "layer-1",
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
}

function multipackOriginProject() {
  return createProject(
    {
      id: "multipack-origin-project",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 50 },
        multiPickAllowed: true,
      },
      pallet: {
        id: "pallet-1",
        name: "1200 x 800 pallet",
        kind: "custom",
        dimensionsMm: { length: 1200, width: 800, height: 144 },
        storageEnvelopeMm: null,
        allowedOverhangMm: { length: 0, width: 0 },
        tareKg: null,
        maxGrossKg: null,
        subPalletPattern: "none",
      },
      solutions: [
        {
          id: "solution-1",
          name: "Solution",
          origin: "calculated",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern",
              grips: [],
              placements: [
                {
                  id: "placement-right",
                  sequence: 0,
                  positionMm: { x: 1150, y: 100 },
                  rotation: 0,
                  gripId: null,
                  labelSide: null,
                },
                {
                  id: "placement-left",
                  sequence: 1,
                  positionMm: { x: 50, y: 100 },
                  rotation: 0,
                  gripId: null,
                  labelSide: null,
                },
              ],
            },
          ],
          stack: {
            interlayerThicknessMm: 3,
            layers: [
              {
                id: "layer-1",
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
    { createId: (kind) => `${kind}-multipack`, now: () => 1 },
  );
}

describe("robotics workspace validation and export gate", () => {
  it("derives box-group top-center pickup and enables export without a surveyed conveyor origin", () => {
    const project = projectFixture();
    const workspace = createInitialRobotWorkspaceSettings(project);

    expect(workspaceUsesDerivedPickReference(workspace)).toBe(true);
    expect(workspacePickReferenceComplete(workspace)).toBe(true);
    const derivedPick = materializeRobotCycles(
      project,
      materializationOptionsFromWorkspace(workspace),
    );
    expect(derivedPick.valid).toBe(true);
    expect(derivedPick.diagnostics.map(({ code }) => code)).not.toContain(
      "missing-pick-reference",
    );
    expect(derivedPick.conveyor).toBeNull();
    expect(derivedPick.cycles[0]?.pickPose.positionMm).toEqual({
      x: 50,
      y: -25,
      z: 40,
    });
    expect(derivedPick.cycles[0]?.provenance.pickReferenceProvenance).toEqual({
      status: "derived",
      source: PACKAGE_GROUP_TOP_CENTER_PICK_SOURCE,
    });
    const derivedGate = projectRobExportGate(
      derivedPick,
      createInitialRobotExportSettings(),
    );
    expect(derivedGate.enabled).toBe(true);
    expect(derivedGate.options.separator).toBe("\t");
    expect(derivedGate.preflight.ok).toBe(true);
    expect(derivedGate.preflight.manifest).toMatchObject({
      source: "project-derived-robot-cycles",
      unknownFieldPolicy: "from-cycle-or-zero",
      signConvention: {
        provenance: { status: "project-defined" },
      },
    });

    const completeUnverifiedWorkspace = {
      ...workspace,
      pickX: "-1000",
      pickY: "100",
      pickZ: "300",
      pickYaw: "0",
    };
    expect(workspacePickReferenceComplete(completeUnverifiedWorkspace)).toBe(
      true,
    );
    const unverifiedPick = materializeRobotCycles(
      project,
      materializationOptionsFromWorkspace(completeUnverifiedWorkspace),
    );
    expect(unverifiedPick.valid).toBe(false);
    expect(unverifiedPick.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unverified-pick-reference" }),
    );
    expect(
      unverifiedPick.cycles[0]?.provenance.pickReferenceProvenance,
    ).toEqual({
      status: "unverified",
      source: workspace.pickReferenceSource,
    });
    const unverifiedGate = projectRobExportGate(unverifiedPick, {
      ...createInitialRobotExportSettings(),
      mappingAcknowledged: true,
      unknownFieldMode: "explicit-values",
    });
    expect(unverifiedGate.enabled).toBe(false);
    expect(unverifiedGate.preflight.data).toBeNull();
    expect(unverifiedGate.preflight.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unverified-pick-reference" }),
    );

    const configuredWorkspace = {
      ...completeUnverifiedWorkspace,
      pickReferenceStatus: "verified" as const,
      pickReferenceSource: "Fixture station survey",
    };
    const materialization = materializeRobotCycles(
      project,
      materializationOptionsFromWorkspace(configuredWorkspace),
    );
    expect(materialization.valid).toBe(true);
    expect(
      materialization.cycles[0]?.provenance.pickReferenceProvenance,
    ).toEqual({
      status: "verified",
      source: "Fixture station survey",
    });

    const blockedUnknownFields = projectRobExportGate(materialization, {
      ...createInitialRobotExportSettings(),
      unknownFieldMode: "block",
    });
    expect(blockedUnknownFields.enabled).toBe(false);
    expect(
      blockedUnknownFields.preflight.diagnostics.map(({ code }) => code),
    ).toContain("unknown-legacy-field-semantics");

    const enabled = projectRobExportGate(materialization, {
      ...createInitialRobotExportSettings(),
      mappingAcknowledged: true,
      unknownFieldMode: "explicit-values",
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.preflight.ok).toBe(true);
    expect(enabled.preflight.manifest).toMatchObject({
      source: "project-derived-robot-cycles",
      unknownFieldPolicy: "explicit-values",
      signConvention: {
        provenance: { status: "unverified" },
      },
    });
  });

  it("exports Multipack place fields in pallet coordinates while retaining station-frame robot poses", () => {
    const project = multipackOriginProject();
    const workspace = createInitialRobotWorkspaceSettings(project);
    const materialization = materializeRobotCycles(
      project,
      materializationOptionsFromWorkspace(workspace),
    );

    expect(project.package.palletizingDirection).toBeNull();
    expect(
      materialization.diagnostics.filter(
        ({ severity }) => severity === "error",
      ),
    ).toEqual([]);
    expect(materialization.valid).toBe(true);
    expect(materialization.direction).toBe("x-negative-y-positive");
    const rightPlacementId =
      materialization.stack?.packageLayers[0]?.placements.find(
        ({ positionMm }) => positionMm.x === 1150,
      )?.id;
    const firstCycle = materialization.cycles[0]!;
    expect(firstCycle.placementIds).toEqual([rightPlacementId]);
    expect(firstCycle.pickPose).toMatchObject({
      frame: "station",
      positionMm: { x: 50, y: -25, z: 50 },
      yawDeg: 0,
    });
    expect(firstCycle.placePose).toMatchObject({
      frame: "station",
      positionMm: { x: 50, y: 100 },
      yawDeg: 180,
    });
    expect(firstCycle.placeGripPosePallet).toMatchObject({
      frame: "pallet",
      positionMm: { x: 1150, y: 100 },
      yawDeg: 0,
    });

    const gate = projectRobExportGate(
      materialization,
      createInitialRobotExportSettings(),
    );
    expect(gate.enabled).toBe(true);
    expect(gate.options.separator).toBe("\t");
    const exported = exportProjectRob(materialization, gate.options);
    expect(exported.ok).toBe(true);
    expect(exported.text).toContain("50\t-25\t0\t1150\t100\t0\t1\t0\t0");
    expect(
      parseRobText(exported.text!).uniqueLayers[1]?.map(
        ({ x, y, rotation }) => ({ x, y, rotation }),
      ),
    ).toEqual([
      { x: 1150, y: 100, rotation: 0 },
      { x: 50, y: 100, rotation: 0 },
    ]);

    expect(
      robotPoseToViewerPose(firstCycle.placePose, project, materialization),
    ).toMatchObject({
      positionMm: { x: 1150, y: 100 },
      yawDeg: 0,
    });
  });

  it("blocks collision validation and export for reversed obstacle bounds", () => {
    const project = projectFixture();
    const workspace = {
      ...createInitialRobotWorkspaceSettings(project),
      pickX: "-1000",
      pickY: "100",
      pickZ: "300",
      obstacles: [
        {
          id: "reversed-obstacle",
          boundsMm: { minX: 100, minY: 0, maxX: 0, maxY: 100 },
          minZMm: 0,
          maxZMm: 1_000,
        },
      ],
    };
    const materialization = materializeRobotWorkspace(project, workspace);

    expect(materialization.valid).toBe(false);
    expect(materialization.diagnostics).toContainEqual(
      expect.objectContaining({
        phase: "collision",
        code: "materialization-invalid",
        resourceId: "reversed-obstacle",
      }),
    );
    const exportSettings = {
      ...createInitialRobotExportSettings(),
      mappingAcknowledged: true,
      unknownFieldMode: "explicit-values" as const,
    };
    expect(projectRobExportGate(materialization, exportSettings).enabled).toBe(
      false,
    );
  });
});

describe("robotics workspace input validation", () => {
  it.each([
    ["blank travel clearance", { transferClearanceMm: "" }, "pose"],
    ["negative travel clearance", { transferClearanceMm: "-1" }, "pose"],
    ["blank packages per pickup", { maxPackagesPerPick: "" }, "grouping"],
    [
      "fractional packages per pickup",
      { maxPackagesPerPick: "1.5" },
      "grouping",
    ],
    ["zero packages per pickup", { maxPackagesPerPick: "0" }, "grouping"],
  ])("blocks %s", (_, change, phase) => {
    const project = projectFixture();
    const settings = {
      ...createInitialRobotWorkspaceSettings(project),
      ...change,
    };

    expect(validateRobotWorkspaceSettings(settings)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        phase,
        code: "materialization-invalid",
      }),
    );
    expect(materializeRobotWorkspace(project, settings).valid).toBe(false);
  });

  it("blocks a checked pickup point without an evidence source", () => {
    const project = projectFixture();
    const settings = {
      ...createInitialRobotWorkspaceSettings(project),
      pickX: "-1000",
      pickY: "100",
      pickZ: "300",
      pickReferenceStatus: "verified" as const,
      pickReferenceSource: "",
    };

    expect(validateRobotWorkspaceSettings(settings)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        phase: "pose",
        message: "A checked pickup point needs a verification source.",
      }),
    );
    expect(materializeRobotWorkspace(project, settings).valid).toBe(false);
  });
});

describe("robotics readiness", () => {
  it("reports observed defaults and the 0 / 0 reach sentinel without claiming calibration", () => {
    const fixture = projectFixture();
    const project = createProject(
      {
        id: "profile-readiness-project",
        package: {
          ...fixture.package,
          dimensionsMm: { ...fixture.package.dimensionsMm, height: 100 },
        },
        pallet: fixture.pallet,
        solutions: fixture.solutions,
        activeSolutionId: fixture.activeSolutionId,
      },
      { createId: (kind) => `${kind}-profile`, now: () => 1 },
    );
    const settings = {
      ...createInitialRobotWorkspaceSettings(project),
      pickX: "-1000",
      pickY: "100",
      pickZ: "300",
      pickReferenceStatus: "verified" as const,
      pickReferenceSource: "Fixture station survey",
    };
    const materialization = materializeRobotWorkspace(project, settings);
    const readiness = createRobotReadiness(
      project,
      materialization,
      settings,
      false,
      1,
    );

    expect(materialization.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "reach-not-checked-zero-radius-sentinel",
      }),
    );
    const equipmentReadiness = readiness.find(({ id }) => id === "equipment");
    expect(equipmentReadiness?.status).toBe("warning");
    expect(equipmentReadiness?.evidence).toContain(
      "observed Multipack default profile",
    );
    const workspaceReadiness = readiness.find(({ id }) => id === "workspace");
    expect(workspaceReadiness?.status).toBe("warning");
    expect(workspaceReadiness?.evidence).toContain(
      "radial reach was not checked",
    );
  });

  it("separates missing equipment, pickup evidence, obstacle coverage, and export engineering", () => {
    const configuredProject = projectFixture();
    const project = {
      ...configuredProject,
      selectedGripperId: null,
      selectedPalletStationId: null,
    };
    const settings = {
      ...createInitialRobotWorkspaceSettings(project),
      pickX: "-1000",
      pickY: "100",
      pickZ: "300",
    };
    const materialization = materializeRobotWorkspace(project, settings);
    const readiness = createRobotReadiness(
      project,
      materialization,
      settings,
      false,
      3,
    );

    expect(readiness).toContainEqual(
      expect.objectContaining({ id: "equipment", status: "needs-input" }),
    );
    expect(readiness).toContainEqual(
      expect.objectContaining({ id: "pickup", status: "warning" }),
    );
    expect(readiness).toContainEqual(
      expect.objectContaining({ id: "obstacles", status: "not-checked" }),
    );
    expect(readiness).toContainEqual(
      expect.objectContaining({
        id: "export",
        status: "engineering",
        evidence: "3 export settings still require engineering review.",
      }),
    );
  });

  it("reports the calculated conveyor separately from additional station obstacles", () => {
    const project = projectFixture();
    const baseSettings = {
      ...createInitialRobotWorkspaceSettings(project),
      pickX: "-1000",
      pickY: "100",
      pickZ: "300",
      pickReferenceStatus: "verified" as const,
      pickReferenceSource: "Fixture station survey",
    };
    const conveyorOnly = materializeRobotWorkspace(project, baseSettings);
    const conveyorOnlyReadiness = createRobotReadiness(
      project,
      conveyorOnly,
      baseSettings,
      false,
      1,
    );

    expect(conveyorOnly.valid).toBe(true);
    expect(conveyorOnly.conveyor).not.toBeNull();
    expect(conveyorOnlyReadiness).toContainEqual(
      expect.objectContaining({
        id: "obstacles",
        status: "warning",
        evidence:
          "The calculated feed conveyor bed was checked. No additional station obstacles are modeled.",
      }),
    );

    const settingsWithObstacle = {
      ...baseSettings,
      obstacles: [
        {
          id: "far-guard",
          name: "Far guard",
          boundsMm: {
            minX: 3_000,
            minY: 3_000,
            maxX: 3_100,
            maxY: 3_100,
          },
          minZMm: 0,
          maxZMm: 1_000,
        },
      ],
    };
    const withObstacle = materializeRobotWorkspace(
      project,
      settingsWithObstacle,
    );
    const withObstacleReadiness = createRobotReadiness(
      project,
      withObstacle,
      settingsWithObstacle,
      false,
      1,
    );

    expect(withObstacle.valid).toBe(true);
    expect(withObstacleReadiness).toContainEqual(
      expect.objectContaining({
        id: "obstacles",
        status: "complete",
        evidence:
          "1 entered obstacle checked together with the calculated feed conveyor bed.",
      }),
    );
  });

  it("blocks readiness when the calculated route intersects the feed bed", () => {
    const project = projectFixture();
    const settings = {
      ...createInitialRobotWorkspaceSettings(project),
      pickX: "0",
      pickY: "0",
      pickZ: "100",
      pickReferenceStatus: "verified" as const,
      pickReferenceSource: "Fixture co-located pickup",
    };
    const materialization = materializeRobotWorkspace(project, settings);
    const readiness = createRobotReadiness(
      project,
      materialization,
      settings,
      false,
      1,
    );

    expect(materialization.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        phase: "collision",
        resourceId: CALCULATED_CONVEYOR_OBSTACLE_ID,
      }),
    );
    expect(readiness).toContainEqual(
      expect.objectContaining({
        id: "obstacles",
        status: "blocked",
        evidence:
          "A calculated motion intersects the modeled feed conveyor or an entered obstacle, or an obstacle is invalid.",
      }),
    );
  });
});

describe("project-derived .rob download", () => {
  it("names the file after the product number, not the line number", () => {
    const project = createProject(
      {
        id: "named-download",
        projectNumber: "AP-5006",
        productNumber: "1329-00004",
      },
      { createId: (kind) => `${kind}-unused`, now: () => 1 },
    );
    expect(robDownloadFileName(project)).toBe("1329-00004.rob");
  });

  it("rounds decimal millimetres instead of rejecting them", () => {
    const project = createProject(
      {
        id: "decimal-download",
        projectNumber: "AP-5006",
        productNumber: "1329-00004",
        package: {
          dimensionsMm: { length: 100.5, width: 50.25, height: 40.5 },
          multiPickAllowed: true,
          palletizingDirection: "x-positive-y-positive",
        },
        pallet: {
          id: "pallet-1",
          name: "Pallet",
          kind: "custom",
          dimensionsMm: { length: 1_200.4, width: 800.6, height: 144.5 },
          storageEnvelopeMm: null,
          allowedOverhangMm: { length: 0, width: 0 },
          tareKg: null,
          maxGrossKg: null,
          subPalletPattern: "none",
        },
        grippers: [gripper],
        palletStations: [station],
        selectedGripperId: gripper.id,
        selectedPalletStationId: station.id,
        solutions: [
          {
            id: "solution-1",
            name: "Solution",
            origin: "calculated",
            patterns: [
              {
                id: "pattern-1",
                name: "Pattern",
                grips: [],
                placements: [
                  {
                    id: "placement-1",
                    sequence: 0,
                    positionMm: { x: 100.5, y: 50.25 },
                    rotation: 0,
                    gripId: null,
                    labelSide: null,
                  },
                ],
              },
            ],
            stack: {
              interlayerThicknessMm: 3,
              layers: [
                {
                  id: "layer-1",
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

    expect(createInitialRobotExportSettings().quantization).toBe(
      "round-half-away-from-zero",
    );
    const downloaded = exportProjectRobDownload(project);
    expect(downloaded.ok).toBe(true);
    expect(downloaded.fileName).toBe("1329-00004.rob");
    expect(downloaded.text).not.toBeNull();
    expect(parseRobText(downloaded.text!).package).toEqual({
      width: 101,
      length: 50,
      height: 41,
    });
    expect(parseRobText(downloaded.text!).pallet).toEqual({
      width: 1200,
      length: 801,
      height: 145,
    });
  });
});
