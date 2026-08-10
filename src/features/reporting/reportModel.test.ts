import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type { Gripper, PalletStation } from "~/domain/project/projectSchema";
import { materializeRobotCycles } from "~/domain/robotics";
import { createPlanningReportModel } from "~/features/reporting/reportModel";
import { materializedStackToPalletData } from "~/lib/projectAdapters";

const gripper: Gripper = {
  id: "report-gripper",
  name: "Report suction",
  externalId: null,
  isDefault: true,
  maxPickupLengthMm: 500,
  tcpMm: { x: 0, y: 0, z: 0 },
  envelopeMm: {
    negativeX: 10,
    positiveX: 10,
    negativeY: 10,
    positiveY: 10,
  },
  inletOrientation: "any",
  allowedPlaceRotations: [0, 90, 180, 270],
  packageLimits: null,
  settings: { type: "suction", multipickSinglePlace: false },
};

const station: PalletStation = {
  id: "report-station",
  name: "Report station",
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

function fixture() {
  const project = createProject(
    {
      id: "report-project",
      projectNumber: "P-REPORT",
      productNumber: "SKU-REPORT",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 40 },
        weightKg: null,
        multiPickAllowed: false,
        palletizingDirection: "x-positive-y-positive",
      },
      grippers: [gripper],
      palletStations: [station],
      selectedGripperId: gripper.id,
      selectedPalletStationId: station.id,
      solutions: [
        {
          id: "solution-report",
          name: "Report solution",
          origin: "calculated",
          patterns: [
            {
              id: "pattern-report",
              name: "Report pattern",
              grips: [],
              placements: [
                {
                  id: "package-report",
                  sequence: 0,
                  positionMm: { x: 100, y: 100 },
                  rotation: 0,
                  gripId: null,
                  labelSide: "top",
                },
              ],
            },
          ],
          stack: {
            interlayerThicknessMm: 3,
            layers: [
              {
                id: "layer-report",
                patternId: "pattern-report",
                interlayerBefore: 0,
              },
            ],
            trailingInterlayer: 0,
          },
          robotCycles: [],
        },
      ],
      activeSolutionId: "solution-report",
    },
    { createId: (kind) => `${kind}-unused`, now: () => 123 },
  );
  const materialization = materializeRobotCycles(project, {
    pickReference: {
      originMm: { x: -500, y: 100, z: 300 },
      yawDeg: 0,
      provenance: { status: "verified", source: "report fixture" },
    },
  });
  const previewData = materializedStackToPalletData(materialization.stack!, {
    projectId: project.id,
    solutionId: materialization.solutionId,
  });
  return { project, materialization, previewData };
}

describe("planning report model", () => {
  it("combines project data, deterministic 2D layers, provenance, warnings, sequence, and canonical cycles", () => {
    const { project, materialization, previewData } = fixture();
    const report = createPlanningReportModel({
      project,
      materialization,
      previewData,
    });

    expect(report.project).toMatchObject({
      id: "report-project",
      projectNumber: "P-REPORT",
      productNumber: "SKU-REPORT",
    });
    expect(report.twoDimensional).toMatchObject({
      deterministic: true,
      renderer: "layer-pattern-svg",
    });
    expect(report.twoDimensional.layers).toHaveLength(1);
    expect(report.twoDimensional.layers[0]?.items).toHaveLength(1);
    expect(
      report.metrics.find(({ id }) => id === "area-utilization"),
    ).toMatchObject({
      provenance: { status: "derived" },
      numeratorName: "package-footprint-area-across-physical-package-layers",
      denominatorName:
        "available-pallet-load-footprint-area-across-package-layers",
    });
    expect(report.warnings.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["missing-resource", "metric-provenance-unknown"]),
    );
    expect(report.layerSequence).toHaveLength(1);
    expect(report.layerSequence[0]).toMatchObject({
      layerNumber: 1,
      packageCount: 1,
    });
    expect(report.layerSequence[0]?.patternRef).toContain("pattern-report");
    expect(report.robotCycles.rows.map(({ cycleId }) => cycleId)).toEqual(
      materialization.cycles.map(({ id }) => id),
    );
    expect(report.fixedView3d).toMatchObject({
      status: "fallback",
      reason: "capture-not-attempted",
    });
  });

  it("retains an available fixed right-top capture with explicit provenance", () => {
    const { project, materialization, previewData } = fixture();
    const report = createPlanningReportModel({
      project,
      materialization,
      previewData,
      capture: {
        status: "captured",
        dataUrl: "data:image/png;base64,report",
        width: 1_200,
        height: 800,
        cameraPreset: "right-top",
        provenance: "fixture capture",
      },
    });

    expect(report.fixedView3d).toEqual({
      status: "captured",
      dataUrl: "data:image/png;base64,report",
      width: 1_200,
      height: 800,
      cameraPreset: "right-top",
      provenance: "fixture capture",
    });
  });
});
