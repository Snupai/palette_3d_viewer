import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { getPalletTemplate } from "~/domain/project/palletTemplates";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import { translateDe } from "~/i18n";
import type { StackWarning } from "~/domain/stack";
import {
  clampLayerCount,
  createGuidedInitialState,
  describeStackWarning,
  isLimitWarning,
  rebuildGuidedSequence,
  setIndividualSheet,
} from "~/features/stack/guidedStackModel";
import { materializeStackWorkspace } from "~/features/stack/stackWorkspaceModel";

const solverInput: LayerSolverInput = {
  package: {
    shape: "cuboid",
    dimensionsMm: { length: 100, width: 100 },
    clearanceMm: 0,
  },
  envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
};

function candidate(rank: number, count: number): SolverCandidate {
  return {
    rank,
    id: `guided-candidate-${rank}`,
    geometryId: `guided-geometry-${rank}`,
    identityFingerprint: `identity-${rank}`,
    geometryFingerprint: `geometry-${rank}`,
    orderDependencies: [],
    placements: Array.from({ length: count }, (_, index) => ({
      sequence: index,
      positionMm: { x: 100 + index * 150, y: 100 },
      rotation: 0 as const,
      labelSide: "top" as const,
      gripId: `generated-grip:${index + 1}`,
    })),
    grips: Array.from({ length: count }, (_, index) => ({
      id: `generated-grip:${index + 1}`,
      groupNumber: index + 1,
      sequence: index,
      pickX: 0,
      pickY: 0,
      pickRotation: 0 as const,
      x: 100 + index * 150,
      y: 100,
      rotation: 0 as const,
      numPackages: 1,
      dx: 0,
      dy: 0,
    })),
    provenance: [],
    validation: { valid: true, issues: [] },
    metrics: {
      packageCount: count,
      occupiedAreaMm2: count * 10_000,
      utilization: count / 96,
      utilizationPercent: (count / 96) * 100,
      boundingBlockLengthMm: count * 150,
      boundingBlockWidthMm: 100,
      boundingBlockAreaMm2: count * 15_000,
      provisionalCycleCount: count,
      provisionalCycleBasis: "generated-grip-groups",
      multiPackBlocks: null,
      multiPackBlocksVerification: "unverified",
    },
    score: {
      value: count,
      packageCount: count,
      utilizationMillionths: Math.round((count / 96) * 1_000_000),
      provisionalCycleCount: count,
      boundingBlockAreaMm2: count * 15_000,
      boundingBlockPerimeterMm: count * 300,
      multiPackBlocks: null,
    },
  };
}

const candidates = [candidate(1, 2), candidate(2, 3)];
const euro = getPalletTemplate("euro");

function projectWithStorage(height: number | null) {
  return createProject(
    {
      id: "guided-stack-project",
      package: {
        dimensionsMm: { length: 100, width: 100, height: 100 },
        weightKg: 1,
      },
      pallet: {
        ...euro,
        storageEnvelopeMm:
          height === null ? null : { length: 1200, width: 800, height },
      },
    },
    { now: () => 1, createId: (kind) => `${kind}-guided` },
  );
}

describe("guided stack model", () => {
  it("starts with the storage-height capacity, or one layer without a storage height", () => {
    const filled = createGuidedInitialState(
      projectWithStorage(350),
      candidates,
    );
    expect(filled.requestedLayerCount).toBe(3);
    expect(filled.layers.map(({ id }) => id)).toEqual([
      "composed-layer-1",
      "composed-layer-2",
      "composed-layer-3",
    ]);

    const open = createGuidedInitialState(projectWithStorage(null), candidates);
    expect(open.requestedLayerCount).toBe(1);
    expect(open.layers).toHaveLength(1);
  });

  it("rebuilds through the production composer and keeps sheets on surviving layers", () => {
    const project = projectWithStorage(350);
    const initial = {
      ...createGuidedInitialState(project, candidates),
      interlayerMode: "individual" as const,
    };
    const withSheets = setIndividualSheet(
      setIndividualSheet(initial, "composed-layer-2", true),
      "composed-layer-3",
      true,
    );

    const shorter = rebuildGuidedSequence(withSheets, {
      requestedLayerCount: 2,
      compositionMode: "longitudinal-mirror",
    });
    expect(shorter.layers.map(({ transform }) => transform)).toEqual([
      "identity",
      "mirror-y",
    ]);
    expect(shorter.individualBeforeLayer).toEqual({
      "composed-layer-2": { enabled: true, thicknessMm: 3 },
    });

    const result = materializeStackWorkspace(
      project,
      candidates,
      solverInput,
      shorter,
    );
    // Layer 1: 0–100, sheet: 100–103, layer 2: 103–203.
    expect(result.packageLayers.map(({ zTopMm }) => zTopMm)).toEqual([
      100, 203,
    ]);
    expect(result.metrics.height.loadStackHeightMm).toBe(203);
    expect(clampLayerCount(Number.NaN)).toBe(0);
    expect(clampLayerCount(4.7)).toBe(4);
    expect(clampLayerCount(-2)).toBe(0);
  });

  it("describes limit violations in German from structured warning fields", () => {
    const height: StackWarning = {
      id: "height-exceeded:load-stack",
      code: "height-exceeded",
      severity: "warning",
      scope: "stack",
      actual: { value: 1667, unit: "mm" },
      limit: { value: 1600, unit: "mm" },
      message: "Load stack height 1667 mm exceeds storage height 1600 mm.",
    };
    const envelope: StackWarning = {
      id: "storage-envelope-exceeded:length",
      code: "storage-envelope-exceeded",
      severity: "warning",
      scope: "stack",
      axis: "length",
      actual: { value: 1240, unit: "mm" },
      limit: { value: 1200, unit: "mm" },
      message: "Block length 1240 mm exceeds storage envelope length 1200 mm.",
    };
    const gripper: StackWarning = {
      id: "missing-resource:gripper",
      code: "missing-resource",
      severity: "warning",
      scope: "resource",
      resourceKind: "gripper",
      message: "No gripper is selected for the materialized robot cycles.",
    };
    expect(describeStackWarning(height, translateDe, "de-DE")).toBe(
      "Ladehöhe 1.667 mm liegt über der Lagerhöhe 1.600 mm.",
    );
    expect(describeStackWarning(envelope, translateDe, "de-DE")).toBe(
      "Blocklänge 1.240 mm ist größer als die Lagerlänge 1.200 mm.",
    );
    expect(describeStackWarning(gripper, translateDe, "de-DE")).toBe(
      "Kein Greifer ausgewählt; die Takte sind noch keinem Greifer zugeordnet.",
    );
    expect([height, envelope, gripper].map(isLimitWarning)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
