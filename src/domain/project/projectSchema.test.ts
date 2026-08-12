import { describe, expect, it } from "vitest";
import {
  PROJECT_SCHEMA_VERSION,
  projectV2Schema,
} from "~/domain/project/projectSchema";

function validProject() {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "project-1",
    projectNumber: "AP5006",
    productNumber: "1329-00004",
    createdAt: 1,
    updatedAt: 2,
    source: { kind: "new" as const },
    package: {
      shape: "cuboid" as const,
      dimensionsMm: { length: 157, width: 106, height: 150 },
      weightKg: 0,
      clearanceMm: 0,
      multiPickAllowed: true,
      inletOrientation: "lengthwise" as const,
      palletizingDirection: "x-negative-y-positive" as const,
      labelSidesAtPickup: ["bottom" as const],
    },
    pallet: {
      id: "euro-pallet",
      name: "EURO pallet",
      kind: "euro" as const,
      dimensionsMm: { length: 1200, width: 800, height: 145 },
      storageEnvelopeMm: { length: 1200, width: 800, height: 1500 },
      allowedOverhangMm: { length: -34, width: -11 },
      tareKg: 30,
      maxGrossKg: 1000,
      subPalletPattern: "none" as const,
    },
    grippers: [
      {
        id: "gripper-1",
        name: "schmalzgripper",
        externalId: "1",
        isDefault: true,
        maxPickupLengthMm: 400,
        tcpMm: { x: 0, y: 0, z: 100 },
        envelopeMm: {
          negativeX: 200,
          positiveX: 200,
          negativeY: 100,
          positiveY: 100,
        },
        inletOrientation: "any" as const,
        allowedPlaceRotations: [0, 90, 180, 270] as const,
        packageLimits: {
          lengthMm: { min: 30, max: 1000 },
          widthMm: { min: 30, max: 800 },
          heightMm: { min: 30, max: 800 },
        },
        settings: {
          type: "suction" as const,
          multipickSinglePlace: false,
        },
      },
    ],
    palletStations: [
      {
        id: "station-1",
        name: "Pallet place definition",
        externalId: null,
        isDefault: true,
        palletOrigin: { x: "center" as const, y: "center" as const },
        obstacleEnvelopeMm: {
          negativeX: 100,
          positiveX: 100,
          negativeY: 100,
          positiveY: 100,
        },
        tcpEnvelopeMm: {
          negativeX: 1000,
          positiveX: 1000,
          negativeY: 1000,
          positiveY: 1000,
        },
        allowedDirections: ["x-negative-y-positive" as const],
        preferredDirection: "x-negative-y-positive" as const,
        robotCenterMm: { x: 1500, y: 0 },
        robotRadiusMm: { min: 200, max: 2200 },
        inletAlignment: "center" as const,
      },
    ],
    selectedGripperId: "gripper-1",
    selectedPalletStationId: "station-1",
    solutions: [
      {
        id: "solution-1",
        name: "Solution 1",
        origin: "manual" as const,
        patterns: [
          {
            id: "pattern-1",
            name: "Layer pattern 1",
            grips: [
              {
                id: "grip-1",
                pickX: 100,
                pickY: 50,
                pickRotation: 0 as const,
                x: 400,
                y: 300,
                rotation: 90 as const,
                numPackages: 1,
                dx: 0,
                dy: 1,
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
      },
    ],
    activeSolutionId: "solution-1",
  };
}

describe("project v2 schema", () => {
  it("accepts a complete planning project", () => {
    const result = projectV2Schema.parse(validProject());

    expect(result.schemaVersion).toBe(2);
    expect(result.package.dimensionsMm).toEqual({
      length: 157,
      width: 106,
      height: 150,
    });
    expect(result.solutions[0]?.patterns[0]?.grips).toHaveLength(1);
  });

  it("rejects broken selected-resource and active-solution references", () => {
    const result = projectV2Schema.safeParse({
      ...validProject(),
      selectedGripperId: "missing-gripper",
      selectedPalletStationId: "missing-station",
      activeSolutionId: "missing-solution",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map(({ path }) => path.join("."))).toEqual(
      expect.arrayContaining([
        "selectedGripperId",
        "selectedPalletStationId",
        "activeSolutionId",
      ]),
    );
  });

  it("rejects duplicate ids and missing stack patterns", () => {
    const project = validProject();
    project.solutions[0]!.patterns.push({
      ...project.solutions[0]!.patterns[0]!,
    });
    project.solutions[0]!.stack.layers[0]!.patternId = "missing-pattern";

    const result = projectV2Schema.safeParse(project);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        'duplicate id "pattern-1"',
        "references a missing layer pattern",
      ]),
    );
  });

  it("validates station direction and numeric ranges", () => {
    const original = validProject();
    const project = {
      ...original,
      palletStations: original.palletStations.map((station) => ({
        ...station,
        preferredDirection: "x-positive-y-positive" as const,
        robotRadiusMm: { min: 500, max: 100 },
      })),
    };

    const result = projectV2Schema.safeParse(project);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        "must be one of allowedDirections",
        "must be greater than or equal to min",
      ]),
    );
  });
});
