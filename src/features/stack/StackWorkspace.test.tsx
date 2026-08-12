import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject, updateProject } from "~/domain/project/projectFactory";
import { getPalletTemplate } from "~/domain/project/palletTemplates";
import { materializeRobotCycles } from "~/domain/robotics";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import {
  materializeProjectSolutionStack,
  type MaterializedStackResult,
  type StackLayerTransform,
} from "~/domain/stack";
import { StackWorkspace } from "~/features/stack/StackWorkspace";
import {
  candidatePatternRef,
  createInitialStackWorkspaceState,
  materializeStackWorkspace,
  projectWithPersistedStack,
  rebuildStackSequence,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";

vi.mock("~/components/RobViewer", () => ({
  RobViewer: () => <div data-testid="rob-viewer" />,
}));

afterEach(cleanup);

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
    id: `stack-candidate-${rank}`,
    geometryId: `stack-geometry-${rank}`,
    identityFingerprint: `identity-${rank}`,
    geometryFingerprint: `geometry-${rank}`,
    orderDependencies: [],
    placements: Array.from({ length: count }, (_, index) => ({
      sequence: index,
      positionMm: { x: 100 + index * 150, y: 100 },
      rotation: 0 as const,
      labelSide: index % 2 === 0 ? ("top" as const) : ("right" as const),
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

const candidates = [candidate(1, 1), candidate(2, 2)];
const euro = getPalletTemplate("euro");
const project = createProject(
  {
    id: "stack-project",
    package: {
      dimensionsMm: { length: 100, width: 100, height: 100 },
      weightKg: 1,
    },
    pallet: {
      ...euro,
      storageEnvelopeMm: { length: 1200, width: 800, height: 350 },
    },
  },
  { now: () => 1, createId: (kind) => `${kind}-stack` },
);

function materializedPlacementGeometry(result: MaterializedStackResult) {
  return result.packageLayers.map((layer) => ({
    id: layer.id,
    placements: layer.placements.map((placement) => ({
      sequence: placement.sequence,
      positionMm: placement.positionMm,
      rotation: placement.rotation,
      labelSide: placement.labelSide,
    })),
  }));
}

const persistedTransforms: StackLayerTransform[] = [
  "mirror-x",
  "mirror-y",
  "rotate-90",
  "rotate-180",
  "rotate-270",
];

describe("stack workspace persistence", () => {
  it.each(persistedTransforms)(
    "bakes %s geometry so save and reopen preserve exact placements",
    (transform) => {
      const initial = createInitialStackWorkspaceState(candidates);
      const state: StackWorkspaceState = {
        ...initial,
        layers: initial.layers.map((layer) => ({ ...layer, transform })),
      };
      const materialized = materializeStackWorkspace(
        project,
        candidates,
        solverInput,
        state,
      );

      const persisted = projectWithPersistedStack(
        project,
        candidates,
        solverInput,
        state,
      );
      const reopened = materializeProjectSolutionStack(persisted);
      const solution = persisted.solutions.find(
        ({ id }) => id === persisted.activeSolutionId,
      )!;

      expect(materializedPlacementGeometry(reopened)).toEqual(
        materializedPlacementGeometry(materialized),
      );
      expect(solution.patterns).toHaveLength(1);
      expect(solution.patterns[0]?.name).toContain(transform);
      expect(solution.stack.layers[0]?.patternId).toBe(
        solution.patterns[0]?.id,
      );
    },
  );

  it("persists the same physical label face through a transformed layer", () => {
    const labelInput: LayerSolverInput = {
      ...solverInput,
      constraints: {
        allowedRotations: [0, 180],
        unrotatedPackageLabelSide: "top",
      },
    };
    const labelCandidate: SolverCandidate = {
      ...candidate(1, 1),
      placements: [
        {
          sequence: 0,
          positionMm: { x: 100, y: 100 },
          rotation: 0,
          labelSide: "top",
          gripId: "generated-grip:1",
        },
      ],
    };
    const initial = createInitialStackWorkspaceState([labelCandidate]);
    const state: StackWorkspaceState = {
      ...initial,
      layers: initial.layers.map((layer) => ({
        ...layer,
        transform: "mirror-y" as const,
      })),
    };

    const materialized = materializeStackWorkspace(
      project,
      [labelCandidate],
      labelInput,
      state,
    );
    const persisted = projectWithPersistedStack(
      project,
      [labelCandidate],
      labelInput,
      state,
    );
    const reopened = materializeProjectSolutionStack(persisted);
    const persistedSolution = persisted.solutions.find(
      ({ id }) => id === persisted.activeSolutionId,
    )!;
    const persistedPattern = persistedSolution.patterns[0]!;

    expect(materialized.packageLayers[0]?.placements[0]).toMatchObject({
      positionMm: { x: 100, y: 700 },
      rotation: 180,
      labelSide: "bottom",
    });
    expect(materializedPlacementGeometry(reopened)).toEqual(
      materializedPlacementGeometry(materialized),
    );
    expect(persistedPattern.grips).toHaveLength(1);
    expect(persistedPattern.grips[0]?.rotation).toBe(180);
    expect(persistedPattern.placements[0]?.gripId).toBe(
      persistedPattern.grips[0]?.id,
    );
    expect(persistedSolution.robotCycles).toEqual([]);
    expect(reopened.packageLayers[0]?.grips[0]?.rotation).toBe(180);
  });

  it("persists generated multipick grips and Robotics consumes them without project robot cycles", () => {
    const baseCandidate = candidate(3, 3);
    const multipickCandidate: SolverCandidate = {
      ...baseCandidate,
      placements: [
        {
          sequence: 0,
          positionMm: { x: 50, y: 100 },
          rotation: 0,
          labelSide: null,
          gripId: "generated-grip:1+2",
        },
        {
          sequence: 1,
          positionMm: { x: 150, y: 100 },
          rotation: 0,
          labelSide: null,
          gripId: "generated-grip:1+2",
        },
        {
          sequence: 2,
          positionMm: { x: 250, y: 100 },
          rotation: 0,
          labelSide: null,
          gripId: "generated-grip:3",
        },
      ],
      grips: [
        {
          id: "generated-grip:1+2",
          groupNumber: 1,
          sequence: 0,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 100,
          y: 100,
          rotation: 0,
          numPackages: 2,
          dx: 0,
          dy: 0,
        },
        {
          id: "generated-grip:3",
          groupNumber: 2,
          sequence: 1,
          pickX: 0,
          pickY: 0,
          pickRotation: 0,
          x: 250,
          y: 100,
          rotation: 0,
          numPackages: 1,
          dx: 0,
          dy: 0,
        },
      ],
      orderDependencies: [
        {
          beforeGripId: "generated-grip:1+2",
          afterGripId: "generated-grip:3",
        },
      ],
      metrics: {
        ...baseCandidate.metrics,
        provisionalCycleCount: 2,
      },
      score: {
        ...baseCandidate.score,
        provisionalCycleCount: 2,
      },
    };
    const authorizedProject = updateProject(project, {
      package: {
        ...project.package,
        multiPickAllowed: true,
      },
    });
    const state = createInitialStackWorkspaceState([multipickCandidate]);

    const persisted = projectWithPersistedStack(
      authorizedProject,
      [multipickCandidate],
      solverInput,
      state,
    );
    const persistedSolution = persisted.solutions.find(
      ({ id }) => id === persisted.activeSolutionId,
    )!;
    const persistedPattern = persistedSolution.patterns[0]!;
    const reopened = materializeProjectSolutionStack(persisted);
    const reopenedLayer = reopened.packageLayers[0]!;
    const robotics = materializeRobotCycles(persisted, {
      maxPackagesPerPick: 1,
      pickReference: {
        originMm: { x: -1_000, y: 0, z: 100 },
        yawDeg: 0,
        provenance: {
          status: "verified",
          source: "stack multipick persistence fixture",
        },
      },
    });

    expect(
      multipickCandidate.grips.map(({ numPackages }) => numPackages),
    ).toEqual([2, 1]);
    expect(multipickCandidate.placements.map(({ gripId }) => gripId)).toEqual([
      "generated-grip:1+2",
      "generated-grip:1+2",
      "generated-grip:3",
    ]);
    expect(persistedSolution.robotCycles).toEqual([]);
    expect(
      persistedPattern.grips.map(({ numPackages }) => numPackages),
    ).toEqual([2, 1]);
    expect(persistedPattern.groupOrder).toEqual(
      persistedPattern.grips.map(({ id }) => id),
    );
    expect(persistedPattern.orderDependencies).toEqual([
      {
        beforeGripId: persistedPattern.grips[0]!.id,
        afterGripId: persistedPattern.grips[1]!.id,
      },
    ]);
    expect(persistedPattern.placements.map(({ gripId }) => gripId)).toEqual([
      persistedPattern.grips[0]!.id,
      persistedPattern.grips[0]!.id,
      persistedPattern.grips[1]!.id,
    ]);
    expect(reopened.robotCycles).toEqual([]);
    expect(reopenedLayer.robotCycles).toEqual([]);
    expect(reopenedLayer.grips.map(({ numPackages }) => numPackages)).toEqual([
      2, 1,
    ]);
    expect(reopenedLayer.placements.map(({ gripId }) => gripId)).toEqual([
      reopenedLayer.grips[0]!.id,
      reopenedLayer.grips[0]!.id,
      reopenedLayer.grips[1]!.id,
    ]);
    expect(robotics.cycles.map(({ packageCount }) => packageCount)).toEqual([
      2, 1,
    ]);
    expect(robotics.cycles.map(({ sequenceInLayer }) => sequenceInLayer)).toEqual([
      0, 1,
    ]);
    expect(
      robotics.diagnostics.filter(
        ({ code }) => code === "order-dependency-violation",
      ),
    ).toEqual([]);
    expect(
      robotics.cycles.map(({ provenance }) => provenance.groupingSource),
    ).toEqual(["explicit-pattern-grip", "explicit-pattern-grip"]);
    expect(
      robotics.cycles.map(({ provenance }) => provenance.cycleSource),
    ).toEqual(["calculated-suction-cycle", "calculated-suction-cycle"]);
    expect(
      robotics.cycles.every(
        ({ provenance }) => provenance.sourceCycleId === null,
      ),
    ).toBe(true);
    expect(robotics.cycles.map(({ placementIds }) => placementIds)).toEqual(
      reopenedLayer.grips.map(({ id }) =>
        reopenedLayer.placements
          .filter(({ gripId }) => gripId === id)
          .map(({ id: placementId }) => placementId),
      ),
    );
  });

  it("persists transforms around the requested generation frame", () => {
    const framedInput: LayerSolverInput = {
      ...solverInput,
      generationBoundsMm: { minX: 100, minY: 50, maxX: 300, maxY: 250 },
    };
    const initial = createInitialStackWorkspaceState(candidates);
    const state: StackWorkspaceState = {
      ...initial,
      layers: initial.layers.map((layer) => ({
        ...layer,
        transform: "rotate-90" as const,
      })),
    };
    const materialized = materializeStackWorkspace(
      project,
      candidates,
      framedInput,
      state,
    );

    const persisted = projectWithPersistedStack(
      project,
      candidates,
      framedInput,
      state,
    );
    const reopened = materializeProjectSolutionStack(persisted);

    expect(materializedPlacementGeometry(reopened)).toEqual(
      materializedPlacementGeometry(materialized),
    );
  });

  it("deduplicates composition variants and preserves a transformed special top layer", () => {
    const initial = createInitialStackWorkspaceState(candidates);
    const composed = rebuildStackSequence({
      ...initial,
      compositionMode: "longitudinal-mirror",
      requestedLayerCount: 4,
    });
    const state: StackWorkspaceState = {
      ...composed,
      specialTopEnabled: true,
      specialTopPatternRef: candidatePatternRef(candidates[0]!),
      specialTopTransform: "rotate-270",
    };
    const materialized = materializeStackWorkspace(
      project,
      candidates,
      solverInput,
      state,
    );

    const persisted = projectWithPersistedStack(
      project,
      candidates,
      solverInput,
      state,
    );
    const reopened = materializeProjectSolutionStack(persisted);
    const solution = persisted.solutions.find(
      ({ id }) => id === persisted.activeSolutionId,
    )!;
    const repeated = projectWithPersistedStack(
      project,
      candidates,
      solverInput,
      state,
    );
    const repeatedSolution = repeated.solutions.find(
      ({ id }) => id === repeated.activeSolutionId,
    )!;
    const patternIds = solution.patterns.map(({ id }) => id);
    const placementIds = solution.patterns.flatMap(({ placements }) =>
      placements.map(({ id }) => id),
    );

    expect(
      materialized.resolvedLayers.map(({ transform }) => transform),
    ).toEqual(["identity", "mirror-y", "identity", "rotate-270"]);
    expect(materialized.packageLayers.at(-1)?.layerProvenance.kind).toBe(
      "special-top",
    );
    expect(materializedPlacementGeometry(reopened)).toEqual(
      materializedPlacementGeometry(materialized),
    );
    expect(solution.stack.layers.map(({ id }) => id)).toEqual(
      materialized.resolvedLayers.map(({ id }) => id),
    );
    expect(solution.patterns.map(({ name }) => name)).toEqual([
      expect.stringContaining("Candidate 1 · identity"),
      expect.stringContaining("Candidate 2 · mirror-y"),
      expect.stringContaining("Candidate 1 · rotate-270"),
    ]);
    expect(patternIds).toHaveLength(3);
    expect(new Set(patternIds).size).toBe(patternIds.length);
    expect(new Set(placementIds).size).toBe(placementIds.length);
    expect(repeatedSolution.patterns.map(({ id }) => id)).toEqual(patternIds);
    expect(solution.stack.layers[0]?.patternId).toBe(
      solution.stack.layers[2]?.patternId,
    );
    expect(solution.stack.layers[3]?.patternId).not.toBe(
      solution.stack.layers[0]?.patternId,
    );
  });
});

describe("StackWorkspace", () => {
  it("builds, reorders, edits interlayers, and saves the materialized sequence", async () => {
    const onSave =
      vi.fn<
        (
          state: StackWorkspaceState,
          materialized: MaterializedStackResult,
        ) => void
      >();
    const onDirtyChange = vi.fn();
    render(
      <StackWorkspace
        project={project}
        candidates={candidates}
        solverInput={solverInput}
        onSave={onSave}
        onDirtyChange={onDirtyChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Composition mode"), {
      target: { value: "rotation" },
    });
    fireEvent.change(screen.getByLabelText("Requested layers"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build A/B sequence" }));

    expect(document.querySelectorAll("[data-layer-id]")).toHaveLength(3);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(
      screen.getByLabelText<HTMLSelectElement>("Layer 2 pattern").value,
    ).toBe(candidatePatternRef(candidates[1]!));

    fireEvent.click(screen.getByRole("button", { name: "Move layer 2 up" }));
    expect(
      screen.getByLabelText<HTMLSelectElement>("Layer 1 pattern").value,
    ).toBe(candidatePatternRef(candidates[1]!));

    fireEvent.change(screen.getByLabelText("Interlayer rule"), {
      target: { value: "individual" },
    });
    fireEvent.click(screen.getByLabelText("Interlayer before layer 2"));
    fireEvent.change(
      screen.getByLabelText("Interlayer thickness before layer 2"),
      { target: { value: "7" } },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Enable base sheet" }),
    );
    fireEvent.change(screen.getByLabelText("Base sheet thickness"), {
      target: { value: "5" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Enable deck sheet" }),
    );
    fireEvent.change(screen.getByLabelText("Deck sheet thickness"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Replace the physical top layer",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save stack to project" }),
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    const [state, materialized] = onSave.mock.calls[0]!;
    expect(state.interlayerMode).toBe("individual");
    expect(state.layers[0]?.patternRef).toBe(
      candidatePatternRef(candidates[1]!),
    );
    expect(Object.values(state.individualBeforeLayer)).toContainEqual({
      enabled: true,
      thicknessMm: 7,
    });
    expect(materialized.packageLayers).toHaveLength(3);
    expect(
      materialized.sheets.map(
        (sheet: { thicknessMm: number }) => sheet.thicknessMm,
      ),
    ).toEqual([5, 7, 4]);
    expect(materialized.packageLayers.at(-1)?.layerProvenance.kind).toBe(
      "special-top",
    );
  });

  it("keeps newer edits dirty when an earlier async save finishes", async () => {
    let resolveSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onSave = vi.fn<
      (
        state: StackWorkspaceState,
        materialized: MaterializedStackResult,
      ) => Promise<void>
    >(() => pendingSave);
    const onDirtyChange = vi.fn();
    render(
      <StackWorkspace
        project={project}
        candidates={candidates}
        solverInput={solverInput}
        onSave={onSave}
        onDirtyChange={onDirtyChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Layer 1 transform"), {
      target: { value: "mirror-x" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save stack to project" }),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Layer 1 transform"), {
      target: { value: "rotate-90" },
    });
    expect(
      screen.getByLabelText<HTMLSelectElement>("Layer 1 transform").value,
    ).toBe("rotate-90");

    await act(async () => {
      resolveSave();
      await pendingSave;
    });

    await waitFor(() =>
      expect(screen.getByText("Unsaved stack edits")).toBeTruthy(),
    );
    expect(onSave.mock.calls[0]?.[0].layers[0]?.transform).toBe("mirror-x");
    expect(onDirtyChange.mock.calls.at(-1)?.[0]).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(
      /newer edits remain unsaved/i,
    );
  });
});
