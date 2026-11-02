import { describe, expect, it } from "vitest";
import {
  createDefaultEquipmentProfileResources,
  DEFAULT_PROFILE_GRIPPER_ID,
} from "~/domain/project/equipmentProfiles";
import { createProject } from "~/domain/project/projectFactory";
import {
  projectSchema,
  type Gripper,
  type PackagePlacement,
  type PalletStation,
  type Project,
} from "~/domain/project/projectSchema";
import { materializeRobotCycles } from "~/domain/robotics";
import {
  createProjectEditorHistory,
  projectEditorHistoryDirty,
  projectEditorHistoryReducer,
} from "~/features/editor/editorHistory";
import {
  activePatternReference,
  applyProjectEditorCommand,
  createProjectEditorFlow,
  placementIdsInMarquee,
  previewGripFromSelection,
  projectEditorOrderModel,
  suggestProjectEditorOrder,
  selectionCenteringDelta,
  stepProjectEditorFlow,
  type ProjectEditorCommand,
  validateProjectPattern,
} from "~/features/editor/editorModel";
import {
  createDragCollisionContext,
  resolveDragDelta,
  roundDragDelta,
} from "~/features/editor/dragCollision";

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

const gripper: Gripper = {
  id: "gripper-1",
  name: "Editor suction",
  externalId: null,
  isDefault: true,
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
  packageLimits: null,
  settings: { type: "suction", multipickSinglePlace: false },
};

const station: PalletStation = {
  id: "station-1",
  name: "Editor station",
  externalId: null,
  isDefault: true,
  palletOrigin: { x: "left", y: "bottom" },
  obstacleEnvelopeMm: {
    negativeX: 10_000,
    positiveX: 10_000,
    negativeY: 10_000,
    positiveY: 10_000,
  },
  tcpEnvelopeMm: {
    negativeX: 10_000,
    positiveX: 10_000,
    negativeY: 10_000,
    positiveY: 10_000,
  },
  allowedDirections: ["x-positive-y-positive"],
  preferredDirection: "x-positive-y-positive",
  robotCenterMm: { x: 0, y: 0 },
  robotRadiusMm: { min: 0, max: 10_000 },
  inletAlignment: "center",
};

function editorProject(): Project {
  return createProject(
    {
      id: "editor-project",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 40 },
        clearanceMm: 0,
        multiPickAllowed: true,
        palletizingDirection: "x-positive-y-positive",
      },
      pallet: {
        id: "editor-pallet",
        name: "Editor pallet",
        kind: "custom",
        dimensionsMm: { length: 400, width: 300, height: 20 },
        storageEnvelopeMm: { length: 400, width: 300, height: 500 },
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
          name: "Editor solution",
          origin: "manual",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern 1",
              grips: [],
              placements: [
                placement("p1", 0, 50, 50),
                placement("p2", 1, 150, 50),
                placement("p3", 2, 50, 150),
                placement("p4", 3, 150, 150),
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
    { now: () => 1, createId: (kind) => `${kind}-unused` },
  );
}

function importedGripProject(): Project {
  const project = editorProject();
  const solution = project.solutions[0]!;
  const sourcePattern = solution.patterns[0]!;
  return projectSchema.parse({
    ...project,
    package: {
      ...project.package,
      multiPickAllowed: false,
    },
    source: {
      kind: "rob-import",
      fileName: "imported-editor.rob",
      rawRobText: "DEF imported-editor()\nEND",
    },
    solutions: [
      {
        ...solution,
        origin: "imported",
        patterns: [
          {
            ...sourcePattern,
            grips: [
              {
                id: "g1",
                groupNumber: 1,
                pickX: 50,
                pickY: 0,
                pickRotation: 0,
                x: 100,
                y: 50,
                rotation: 0,
                numPackages: 2,
                dx: 37,
                dy: 0,
              },
              {
                id: "g2",
                groupNumber: 2,
                pickX: 50,
                pickY: 100,
                pickRotation: 0,
                x: 100,
                y: 150,
                rotation: 0,
                numPackages: 2,
                dx: 0,
                dy: -14,
              },
            ],
            placements: sourcePattern.placements.map((item, index) => ({
              ...item,
              gripId: index < 2 ? "g1" : "g2",
              labelSide: "top",
            })),
            groupOrder: ["g1", "g2"],
            orderDependencies: [],
          },
        ],
      },
    ],
  });
}

function generatedGripProject(): Project {
  const project = editorProject();
  const solution = project.solutions[0]!;
  const sourcePattern = solution.patterns[0]!;
  const gripIds = ["generated-grip:1+2", "generated-grip:3+4"] as const;
  return projectSchema.parse({
    ...project,
    solutions: [
      {
        ...solution,
        origin: "calculated",
        patterns: [
          {
            ...sourcePattern,
            grips: gripIds.map((id, index) => ({
              id,
              groupNumber: index + 1,
              pickX: 0,
              pickY: 0,
              pickRotation: 0,
              x: 100,
              y: index === 0 ? 50 : 150,
              rotation: 0,
              numPackages: 2,
              dx: 0,
              dy: 0,
            })),
            placements: sourcePattern.placements.map((item, index) => ({
              ...item,
              gripId: index < 2 ? gripIds[0] : gripIds[1],
            })),
            groupOrder: [...gripIds],
            orderDependencies: [],
          },
        ],
        robotCycles: [],
      },
    ],
  });
}

function twoGripProject(): Project {
  const project = editorProject();
  const solution = project.solutions[0]!;
  const sourcePattern = solution.patterns[0]!;
  const placements = sourcePattern.placements
    .slice(0, 2)
    .map((item, index) => ({
      ...item,
      gripId: index === 0 ? "left" : "right",
    }));
  return projectSchema.parse({
    ...project,
    solutions: [
      {
        ...solution,
        patterns: [
          {
            ...sourcePattern,
            grips: placements.map((item, index) => ({
              id: item.gripId,
              groupNumber: index === 0 ? 2 : 1,
              pickX: 0,
              pickY: 0,
              pickRotation: 0,
              x: item.positionMm.x,
              y: item.positionMm.y,
              rotation: item.rotation,
              numPackages: 1,
              dx: 0,
              dy: 0,
            })),
            placements,
            groupOrder: ["right", "left"],
            orderDependencies: [],
          },
        ],
      },
    ],
  });
}

function persistedSolverGripId(index: number): string {
  return `solver-pattern-1-identity-legacy-candidate-grip-${index}`;
}

function persistedSolverOrderProject(
  gripPlanningSource?: "solver-generated" | "manual",
  legacyManualWithoutMarker = false,
): Project {
  const project = twoGripProject();
  const solution = project.solutions[0]!;
  const sourcePattern = solution.patterns[0]!;
  const patternId = "solver-pattern-1-identity-legacy-candidate";
  const leftGripId = persistedSolverGripId(1);
  const rightGripId = persistedSolverGripId(2);
  const manuallyOrdered =
    gripPlanningSource === "manual" || legacyManualWithoutMarker;
  const storedOrder = manuallyOrdered
    ? [rightGripId, leftGripId]
    : [leftGripId, rightGripId];
  const gripById = new Map(
    sourcePattern.grips.map((grip, index) => {
      const id = index === 0 ? leftGripId : rightGripId;
      return [id, { ...grip, id }] as const;
    }),
  );
  const placements = sourcePattern.placements
    .slice(0, 2)
    .map((item, index) => ({
      ...item,
      id: `${patternId}-placement-${index + 1}`,
      gripId: index === 0 ? leftGripId : rightGripId,
    }));
  const pattern = {
    ...sourcePattern,
    id: patternId,
    grips: storedOrder.map((gripId, index) => ({
      ...gripById.get(gripId)!,
      groupNumber: index + 1,
    })),
    placements,
    groupOrder: storedOrder,
    ...(gripPlanningSource === undefined ? {} : { gripPlanningSource }),
  };
  const placementIdByGripId = new Map(
    placements.map((placement) => [placement.gripId, placement.id]),
  );
  const robotCycles =
    gripPlanningSource === "manual"
      ? storedOrder.map((gripId, sequence) => {
          const grip = gripById.get(gripId)!;
          return {
            id: `legacy-cycle-${sequence + 1}`,
            patternId,
            sequence,
            gripId,
            placementIds: [placementIdByGripId.get(gripId)!],
            gripperId: project.selectedGripperId,
            pickPose: {
              x: grip.pickX,
              y: grip.pickY,
              z: null,
              rotation: grip.pickRotation,
            },
            placePose: {
              x: grip.x,
              y: grip.y,
              z: null,
              rotation: grip.rotation,
            },
            labelOffset: { x: grip.dx, y: grip.dy },
          };
        })
      : [];
  return projectSchema.parse({
    ...project,
    solutions: [
      {
        ...solution,
        origin: "calculated",
        patterns: [pattern],
        stack: {
          ...solution.stack,
          layers: solution.stack.layers.map((layer) => ({
            ...layer,
            patternId,
          })),
        },
        robotCycles,
      },
    ],
  });
}

function threeGripProject(): Project {
  const project = editorProject();
  const solution = project.solutions[0]!;
  const sourcePattern = solution.patterns[0]!;
  const placements = sourcePattern.placements
    .slice(0, 3)
    .map((item, index) => ({
      ...item,
      positionMm: { x: 50 + index * 100, y: 50 },
      gripId: ["a", "b", "c"][index]!,
    }));
  return projectSchema.parse({
    ...project,
    solutions: [
      {
        ...solution,
        patterns: [
          {
            ...sourcePattern,
            grips: placements.map((item, index) => ({
              id: item.gripId,
              groupNumber: index + 1,
              pickX: 0,
              pickY: 0,
              pickRotation: 0,
              x: item.positionMm.x,
              y: item.positionMm.y,
              rotation: item.rotation,
              numPackages: 1,
              dx: 0,
              dy: 0,
            })),
            placements,
            groupOrder: ["a", "b", "c"],
            orderDependencies: [
              {
                beforeGripId: "a",
                afterGripId: "b",
                source: "explicit",
              },
              {
                beforeGripId: "b",
                afterGripId: "c",
                source: "explicit",
              },
            ],
          },
        ],
      },
    ],
  });
}

function pattern(project: Project) {
  return project.solutions[0]!.patterns[0]!;
}

describe("Project editor pattern geometry", () => {
  it("supports marquee selection, centering, and independent fine/coarse moves", () => {
    const project = editorProject();
    expect(
      placementIdsInMarquee(
        project,
        pattern(project),
        { x: 0, y: 20 },
        { x: 200, y: 80 },
      ),
    ).toEqual(["p1", "p2"]);
    expect(
      selectionCenteringDelta(project, pattern(project), ["p1", "p2"]),
    ).toEqual({ x: 100, y: 100 });

    const fine = applyProjectEditorCommand(project, {
      type: "move-placements",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1"],
      deltaMm: { x: 0, y: 1 },
    });
    const coarse = applyProjectEditorCommand(fine, {
      type: "move-placements",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1"],
      deltaMm: { x: 0, y: 10 },
    });
    expect(pattern(coarse).placements[0]?.positionMm.y).toBe(61);
  });

  it("lets drags and moves keep existing overlaps but never add one", () => {
    // p4 already overlaps p3 (e.g. an imported plan); p1–p4 are 100 × 50 mm.
    const base = editorProject();
    const project: Project = {
      ...base,
      solutions: base.solutions.map((solution) => ({
        ...solution,
        patterns: solution.patterns.map((entry) => ({
          ...entry,
          placements: entry.placements.map((placement) =>
            placement.id === "p4"
              ? { ...placement, positionMm: { x: 130, y: 150 } }
              : placement,
          ),
        })),
      })),
    };
    const move = (id: string, deltaMm: { x: number; y: number }) =>
      applyProjectEditorCommand(project, {
        type: "move-placements",
        mode: "pattern",
        solutionId: "solution-1",
        patternId: "pattern-1",
        placementIds: [id],
        deltaMm,
      });
    const dragged = (id: string, target: { x: number; y: number }) => {
      const context = createDragCollisionContext(project, pattern(project), [
        id,
      ]);
      return roundDragDelta(
        context,
        resolveDragDelta(context, { x: 0, y: 0 }, target),
      );
    };

    // An unrelated package moves although p3/p4 still overlap.
    expect(dragged("p2", { x: 100, y: 0 })).toEqual({ x: 100, y: 0 });
    expect(
      pattern(move("p2", { x: 100, y: 0 })).placements[1]?.positionMm,
    ).toEqual({ x: 250, y: 50 });
    // Pulling p4 apart from p3 is allowed even before the overlap is gone.
    expect(dragged("p4", { x: 10, y: 0 })).toEqual({ x: 10, y: 0 });
    expect(
      pattern(move("p4", { x: 10, y: 0 })).placements[3]?.positionMm,
    ).toEqual({ x: 140, y: 150 });
    // A new overlap is still rejected — and the drag never proposes one.
    expect(() => move("p1", { x: 30, y: 0 })).toThrow(
      /Packages "p1" and "p2" overlap or violate clearance/,
    );
    expect(dragged("p1", { x: 30, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("never lets an edit worsen an existing overlap or overhang", () => {
    const base = editorProject();
    const project: Project = {
      ...base,
      solutions: base.solutions.map((solution) => ({
        ...solution,
        patterns: solution.patterns.map((entry) => ({
          ...entry,
          placements: entry.placements.map((placement) =>
            placement.id === "p4"
              ? { ...placement, positionMm: { x: 130, y: 150 } }
              : placement.id === "p1"
                ? { ...placement, positionMm: { x: 40, y: 50 } }
                : placement,
          ),
        })),
      })),
    };
    const move = (id: string, deltaMm: { x: number; y: number }) =>
      applyProjectEditorCommand(project, {
        type: "move-placements",
        mode: "pattern",
        solutionId: "solution-1",
        patternId: "pattern-1",
        placementIds: [id],
        deltaMm,
      });
    const dragged = (id: string, target: { x: number; y: number }) => {
      const context = createDragCollisionContext(project, pattern(project), [
        id,
      ]);
      return roundDragDelta(
        context,
        resolveDragDelta(context, { x: 0, y: 0 }, target),
      );
    };

    // p4 overlaps p3 by 20 mm; pushing it 20 mm deeper is refused.
    expect(() => move("p4", { x: -20, y: 0 })).toThrow(
      /Packages "p3" and "p4" overlap or violate clearance/,
    );
    expect(dragged("p4", { x: -20, y: 0 })).toEqual({ x: 0, y: 0 });
    // p1 sticks out 10 mm; further out is refused, back in is allowed.
    expect(() => move("p1", { x: -5, y: 0 })).toThrow(
      /Package "p1" exceeds the effective pallet envelope/,
    );
    expect(dragged("p1", { x: -5, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(
      pattern(move("p1", { x: 0, y: 10 })).placements[0]?.positionMm,
    ).toEqual({ x: 40, y: 60 });
    expect(dragged("p1", { x: 0, y: 10 })).toEqual({ x: 0, y: 10 });
  });

  it("keeps an already invalid grip while other packages are edited", () => {
    // Grip g1 spans p1/p2 with a 10 mm gap — not a valid multi-package grip.
    const base = editorProject();
    const project = projectSchema.parse({
      ...base,
      solutions: base.solutions.map((solution) => ({
        ...solution,
        patterns: solution.patterns.map((entry) => ({
          ...entry,
          grips: [
            {
              id: "g1",
              groupNumber: 1,
              pickX: 105,
              pickY: 0,
              pickRotation: 0,
              x: 105,
              y: 50,
              rotation: 0,
              numPackages: 2,
              dx: 0,
              dy: -1,
            },
          ],
          placements: entry.placements.map((placement) =>
            placement.id === "p1"
              ? { ...placement, gripId: "g1" }
              : placement.id === "p2"
                ? { ...placement, gripId: "g1", positionMm: { x: 160, y: 50 } }
                : placement,
          ),
        })),
      })),
    });
    expect(
      validateProjectPattern(project, pattern(project)).map(({ code }) => code),
    ).toContain("invalid-group-geometry");
    const move = (ids: string[], deltaMm: { x: number; y: number }) =>
      applyProjectEditorCommand(project, {
        type: "move-placements",
        mode: "pattern",
        solutionId: "solution-1",
        patternId: "pattern-1",
        placementIds: ids,
        deltaMm,
      });

    // Another package moves; g1 stays exactly as it was.
    const other = move(["p3"], { x: 0, y: 10 });
    expect(pattern(other).placements[2]?.positionMm).toEqual({ x: 50, y: 160 });
    expect(pattern(other).grips).toEqual(pattern(project).grips);
    // Label edits still reach the kept grip (blue line on the right).
    const relabelled = applyProjectEditorCommand(project, {
      type: "set-label-side",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2"],
      labelSide: "right",
    });
    expect(pattern(relabelled).grips[0]).toMatchObject({
      x: 105,
      y: 50,
      dx: -1,
      dy: 0,
    });
    // Moving the whole invalid grip carries it along unchanged in shape.
    const whole = move(["p1", "p2"], { x: 0, y: 20 });
    expect(pattern(whole).grips[0]).toMatchObject({
      x: 105,
      y: 70,
      pickX: 105,
      pickY: 20,
    });
  });

  it("refuses a grip recalculation whose package slide adds an overhang", () => {
    // p1 already sticks out; sliding p2 to close the gap would make it stick
    // out too, which a manual move would not be allowed to do either.
    const base = editorProject();
    const positions: Record<string, { x: number; y: number }> = {
      p1: { x: -60, y: 50 },
      p2: { x: 50, y: 50 },
      p3: { x: 350, y: 150 },
      p4: { x: 350, y: 250 },
    };
    const project: Project = {
      ...base,
      solutions: base.solutions.map((solution) => ({
        ...solution,
        patterns: solution.patterns.map((entry) => ({
          ...entry,
          placements: entry.placements.map((placement) => ({
            ...placement,
            positionMm: positions[placement.id]!,
          })),
        })),
      })),
    };
    expect(() =>
      applyProjectEditorCommand(project, {
        type: "recalculate-groups",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
      }),
    ).toThrow(/Package "p2" exceeds the effective pallet envelope/);
  });

  it("picks whole-millimetre grip splits for imported plans up front", () => {
    // 101 mm packages, default-profile gripper (up to four): an odd number of
    // packages per grip keeps the centre on a whole millimetre, an even one
    // does not.
    const importedLine = (positions: { x: number; y: number }[]): Project => {
      const base = editorProject();
      return {
        ...base,
        source: { kind: "rob-import", fileName: "odd.rob" },
        package: {
          ...base.package,
          dimensionsMm: { ...base.package.dimensionsMm, length: 101 },
        },
        pallet: {
          ...base.pallet!,
          dimensionsMm: { length: 700, width: 500, height: 20 },
          storageEnvelopeMm: { length: 700, width: 500, height: 500 },
        },
        grippers: [
          ...base.grippers,
          ...createDefaultEquipmentProfileResources().grippers,
        ],
        selectedGripperId: DEFAULT_PROFILE_GRIPPER_ID,
        solutions: base.solutions.map((solution) => ({
          ...solution,
          patterns: solution.patterns.map((entry) => ({
            ...entry,
            placements: positions.map((positionMm, index) => ({
              ...entry.placements[0]!,
              id: `q${index + 1}`,
              sequence: index,
              positionMm,
            })),
          })),
        })),
      };
    };
    const recalculate = (project: Project) =>
      pattern(
        applyProjectEditorCommand(project, {
          type: "recalculate-groups",
          mode: "order",
          solutionId: "solution-1",
          patternId: "pattern-1",
        }),
      );
    const gripSummary = (result: ReturnType<typeof recalculate>) =>
      result.grips
        .map(({ numPackages, x, y }) => `${numPackages}@${x},${y}`)
        .sort();

    // Four flush packages: a grip of three plus a single, not four singles.
    const flush = recalculate(
      importedLine([151, 252, 353, 454].map((x) => ({ x, y: 200 }))),
    );
    expect(gripSummary(flush)).toEqual(["1@454,200", "3@252,200"]);

    // Sliding q3 left next to the pair would centre a grip of three at
    // 251.5 mm; the pair slides right onto q3 instead, so all three share a
    // grip at a whole millimetre.
    const sliding = recalculate(
      importedLine([
        { x: 150.5, y: 200 },
        { x: 251.5, y: 200 },
        { x: 362, y: 200 },
        { x: 60, y: 400 },
        { x: 550, y: 400 },
      ]),
    );
    expect(gripSummary(sliding)).toEqual([
      "1@550,400",
      "1@60,400",
      "3@261,200",
    ]);
    expect(sliding.placements.map(({ positionMm }) => positionMm.x)).toEqual([
      160, 261, 362, 60, 550,
    ]);

    // All cheapest slides of three spread packages land on half millimetres;
    // a whole-millimetre slide inside the same range is found instead.
    const spread = recalculate(
      importedLine([
        { x: 150.5, y: 200 },
        { x: 260.5, y: 200 },
        { x: 370.5, y: 200 },
        { x: 60, y: 400 },
        { x: 550, y: 400 },
      ]),
    );
    expect(gripSummary(spread)).toEqual(["1@550,400", "1@60,400", "3@260,200"]);
  });

  it("keeps automatic grips of imported plans on whole millimetres", () => {
    // Two flush 101 mm packages would form a grip centred at x = 201.5,
    // which a .rob cannot store; they stay single grips instead.
    const base = editorProject();
    const project: Project = {
      ...base,
      source: { kind: "rob-import", fileName: "odd.rob" },
      package: {
        ...base.package,
        dimensionsMm: { ...base.package.dimensionsMm, length: 101 },
      },
      solutions: base.solutions.map((solution) => ({
        ...solution,
        patterns: solution.patterns.map((entry) => ({
          ...entry,
          placements: entry.placements
            .filter(({ id }) => id === "p1" || id === "p2")
            .map((placement) => ({
              ...placement,
              positionMm:
                placement.id === "p1" ? { x: 151, y: 200 } : { x: 252, y: 200 },
            })),
        })),
      })),
    };
    const recalculated = applyProjectEditorCommand(project, {
      type: "recalculate-groups",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
    });
    expect(
      pattern(recalculated).grips.map(
        ({ numPackages, x, y, pickX, pickY }) => ({
          numPackages,
          x,
          y,
          pickX,
          pickY,
        }),
      ),
    ).toEqual([
      { numPackages: 1, x: 252, y: 200, pickX: 50, pickY: -25 },
      { numPackages: 1, x: 151, y: 200, pickX: 50, pickY: -25 },
    ]);
  });

  it("edits labels and inserts both package orientations at valid free positions", () => {
    let project = editorProject();
    project = applyProjectEditorCommand(project, {
      type: "set-label-side",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1"],
      labelSide: "right",
    });
    project = applyProjectEditorCommand(project, {
      type: "insert-placement",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementId: "p-long",
      orientation: "longitudinal",
    });
    project = applyProjectEditorCommand(project, {
      type: "insert-placement",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementId: "p-cross",
      orientation: "transverse",
    });

    expect(
      pattern(project).placements.find(({ id }) => id === "p1")?.labelSide,
    ).toBe("right");
    expect(
      pattern(project).placements.find(({ id }) => id === "p-long")?.rotation,
    ).toBe(0);
    expect(
      pattern(project).placements.find(({ id }) => id === "p-cross")?.rotation,
    ).toBe(90);
  });

  it("derives corner grip deltas from the selected descent sides", () => {
    const imported = importedGripProject();
    let project = applyProjectEditorCommand(imported, {
      type: "set-label-side",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2"],
      labelSide: "bottom_left",
    });
    project = applyProjectEditorCommand(project, {
      type: "set-label-side",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p3", "p4"],
      labelSide: "top_right",
    });

    expect(
      pattern(project).grips.map(({ id, dx, dy }) => ({ id, dx, dy })),
    ).toEqual([
      { id: "g1", dx: 1, dy: 1 },
      { id: "g2", dx: -1, dy: -1 },
    ]);
  });

  it("rotates world-facing labels and refreshes grip and cycle offsets", () => {
    const imported = importedGripProject();
    const solution = imported.solutions[0]!;
    const sourcePattern = solution.patterns[0]!;
    let project = projectSchema.parse({
      ...imported,
      solutions: [
        {
          ...solution,
          patterns: [
            {
              ...sourcePattern,
              placements: sourcePattern.placements.map((item) => ({
                ...item,
                labelSide: "right" as const,
              })),
            },
          ],
          robotCycles: [
            {
              id: "cycle-g2",
              patternId: sourcePattern.id,
              sequence: 1,
              gripId: "g2",
              placementIds: ["p3", "p4"],
              gripperId: gripper.id,
              pickPose: { x: 50, y: 100, z: null, rotation: 0 },
              placePose: { x: 100, y: 150, z: null, rotation: 0 },
              labelOffset: { x: 0, y: 14 },
            },
          ],
        },
      ],
    });

    project = applyProjectEditorCommand(project, {
      type: "rotate-placements",
      mode: "pattern",
      solutionId: solution.id,
      patternId: sourcePattern.id,
      placementIds: ["p1", "p2", "p3", "p4"],
      quarterTurns: 1,
    });

    expect(
      pattern(project).placements.map(
        ({ id, positionMm, rotation, labelSide }) => ({
          id,
          positionMm,
          rotation,
          labelSide,
        }),
      ),
    ).toEqual([
      {
        id: "p1",
        positionMm: { x: 150, y: 50 },
        rotation: 90,
        labelSide: "top",
      },
      {
        id: "p2",
        positionMm: { x: 150, y: 150 },
        rotation: 90,
        labelSide: "top",
      },
      {
        id: "p3",
        positionMm: { x: 50, y: 50 },
        rotation: 90,
        labelSide: "top",
      },
      {
        id: "p4",
        positionMm: { x: 50, y: 150 },
        rotation: 90,
        labelSide: "top",
      },
    ]);
    expect(
      pattern(project).grips.map(({ id, rotation, dx, dy }) => ({
        id,
        rotation,
        dx,
        dy,
      })),
    ).toEqual([
      { id: "g1", rotation: 90, dx: 0, dy: -1 },
      { id: "g2", rotation: 90, dx: 0, dy: -1 },
    ]);
    expect(
      project.solutions[0]!.robotCycles.find(({ gripId }) => gripId === "g2"),
    ).toMatchObject({
      id: "cycle-g2",
      placementIds: ["p3", "p4"],
      placePose: { x: 50, y: 100, rotation: 90 },
      labelOffset: { x: 0, y: -1 },
    });
  });

  it("keeps generated grip assignments cycle-free after a pattern edit", () => {
    const generated = generatedGripProject();
    const sourcePattern = pattern(generated);

    const edited = applyProjectEditorCommand(generated, {
      type: "move-placements",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: sourcePattern.id,
      placementIds: ["p1", "p2"],
      deltaMm: { x: 10, y: 0 },
    });
    const editedSolution = edited.solutions[0]!;
    const editedPattern = editedSolution.patterns[0]!;
    const gripIds = new Set(editedPattern.grips.map(({ id }) => id));

    expect(editedSolution.origin).toBe("calculated");
    expect(editedSolution.robotCycles).toEqual([]);
    expect(editedPattern.groupOrder).toEqual(sourcePattern.groupOrder);
    expect(
      editedPattern.grips.map(({ id, x, y, numPackages }) => ({
        id,
        x,
        y,
        numPackages,
      })),
    ).toEqual([
      { id: "generated-grip:1+2", x: 110, y: 50, numPackages: 2 },
      { id: "generated-grip:3+4", x: 100, y: 150, numPackages: 2 },
    ]);
    expect(
      editedPattern.placements.every(
        ({ gripId }) => gripId !== null && gripIds.has(gripId),
      ),
    ).toBe(true);
    expect(
      editedPattern.grips.map(({ id, numPackages }) => [
        id,
        numPackages,
        editedPattern.placements.filter(({ gripId }) => gripId === id).length,
      ]),
    ).toEqual([
      ["generated-grip:1+2", 2, 2],
      ["generated-grip:3+4", 2, 2],
    ]);
  });

  it("preserves imported raw dx/dy and rejects a cyclic label edit", () => {
    let project = importedGripProject();
    const rawOffsets = () =>
      pattern(project).grips.map(({ id, dx, dy }) => ({ id, dx, dy }));
    const expected = [
      { id: "g1", dx: 37, dy: 0 },
      { id: "g2", dx: 0, dy: -14 },
    ];

    project = applyProjectEditorCommand(project, {
      type: "move-placements",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2"],
      deltaMm: { x: 10, y: 0 },
    });
    expect(rawOffsets()).toEqual(expected);

    project = applyProjectEditorCommand(project, {
      type: "set-pattern-name",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      name: "Renamed imported pattern",
    });
    expect(rawOffsets()).toEqual(expected);

    expect(() =>
      applyProjectEditorCommand(project, {
        type: "reorder-group",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
        gripId: "g2",
        toIndex: 0,
      }),
    ).toThrow(/cannot execute before prerequisite/i);
    expect(rawOffsets()).toEqual(expected);

    expect(() =>
      applyProjectEditorCommand(project, {
        type: "set-label-side",
        mode: "pattern",
        solutionId: "solution-1",
        patternId: "pattern-1",
        placementIds: ["p1", "p2"],
        labelSide: "top",
      }),
    ).toThrow(/dependencies contain a cycle/i);
    expect(rawOffsets()).toEqual(expected);
    expect(project.source).toEqual({
      kind: "rob-import",
      fileName: "imported-editor.rob",
      rawRobText: "DEF imported-editor()\nEND",
    });
  });
});

describe("Project editor groups and order", () => {
  function projectWithPlacements(
    placements: PackagePlacement[],
    overrides: (project: Project) => Partial<Project> = () => ({}),
  ): Project {
    const base = editorProject();
    const solution = base.solutions[0]!;
    const sourcePattern = solution.patterns[0]!;
    return projectSchema.parse({
      ...base,
      solutions: [
        {
          ...solution,
          patterns: [{ ...sourcePattern, grips: [], placements }],
        },
      ],
      ...overrides(base),
    });
  }

  function automaticGroups(project: Project): string[][] {
    return projectEditorOrderModel(project, "solution-1", "pattern-1")
      .groups.map(({ placementIds }) => [...placementIds])
      .sort((left, right) => left[0]!.localeCompare(right[0]!));
  }

  it("sizes automatic grips by the selected gripper like Robotics does", () => {
    const placements = Array.from({ length: 7 }, (_, index) =>
      placement(`p${index + 1}`, index, 66 + index * 132, 55),
    );
    const project = projectWithPlacements(placements, (base) => ({
      package: {
        ...base.package,
        dimensionsMm: { length: 132, width: 110, height: 185 },
      },
      pallet: {
        ...base.pallet!,
        dimensionsMm: { ...base.pallet!.dimensionsMm, length: 1000 },
        storageEnvelopeMm: { length: 1000, width: 300, height: 500 },
      },
      grippers: [
        ...base.grippers,
        ...createDefaultEquipmentProfileResources().grippers,
      ],
      selectedGripperId: DEFAULT_PROFILE_GRIPPER_ID,
    }));

    // 450 mm pickup length fits three 132 mm packages instead of doubles;
    // the third grip takes two packages so no single grip is needed.
    expect(automaticGroups(project)).toEqual([
      ["p1", "p2", "p3"],
      ["p4", "p5"],
      ["p6", "p7"],
    ]);
  });

  it("calculates acyclic grip dependencies for labelled packages", () => {
    const project = projectWithPlacements(
      [
        placement("p1", 0, 50, 50),
        placement("p2", 1, 150, 50),
        placement("p3", 2, 50, 150),
        placement("p4", 3, 150, 150),
      ].map((item) => ({ ...item, labelSide: "top" as const })),
    );
    const model = projectEditorOrderModel(project, "solution-1", "pattern-1");

    expect(automaticGroups(project)).toEqual([
      ["p1", "p2"],
      ["p3", "p4"],
    ]);
    expect(model.diagnostics).toEqual([]);
  });

  it("does not carry old grip data into recalculated grips", () => {
    const recalculate = (project: Project) =>
      applyProjectEditorCommand(project, {
        type: "recalculate-groups",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
      });
    const calculated = recalculate(editorProject());
    // Same placement groups (and grip ids), but a grip edited by the user.
    const edited = applyProjectEditorCommand(calculated, {
      type: "set-label-side",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2"],
      labelSide: "left",
    });
    const grips = (project: Project) =>
      project.solutions[0]!.patterns[0]!.grips;

    expect(grips(edited)).not.toEqual(grips(calculated));
    expect(grips(recalculate(edited))).toEqual(grips(calculated));
  });

  it("recalculates grips from the package geometry as one undoable step", () => {
    const initial = editorProject();
    const firstGripId = projectEditorOrderModel(
      initial,
      "solution-1",
      "pattern-1",
    ).groups.find(({ placementIds }) => placementIds.includes("p1"))!.id;
    let history = createProjectEditorHistory(initial);
    history = projectEditorHistoryReducer(history, {
      type: "execute",
      command: {
        type: "split-group",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
        gripId: firstGripId,
      },
    });
    const edited = automaticGroups(history.present);
    expect(edited).toEqual([["p1"], ["p2"], ["p3", "p4"]]);

    history = projectEditorHistoryReducer(history, {
      type: "execute",
      command: {
        type: "recalculate-groups",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
      },
    });
    expect(automaticGroups(history.present)).toEqual([
      ["p1", "p2"],
      ["p3", "p4"],
    ]);
    expect(
      projectEditorOrderModel(history.present, "solution-1", "pattern-1")
        .diagnostics,
    ).toEqual([]);

    history = projectEditorHistoryReducer(history, { type: "undo" });
    expect(automaticGroups(history.present)).toEqual(edited);
  });

  it("closes a small gap when recalculating so two packages share a grip", () => {
    // f1/f2 define the layer's x edges; packages on outer edges never slide.
    const project = projectWithPlacements([
      placement("p1", 0, 150, 25),
      placement("p2", 1, 260, 25),
      placement("f1", 2, 50, 125),
      placement("f2", 3, 350, 125),
    ]);
    // Implicit automatic grouping never moves packages.
    expect(automaticGroups(project)).toEqual([["f1"], ["f2"], ["p1"], ["p2"]]);

    const recalculated = applyProjectEditorCommand(project, {
      type: "recalculate-groups",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
    });
    const pattern = recalculated.solutions[0]!.patterns[0]!;

    expect(automaticGroups(recalculated)).toEqual([
      ["f1"],
      ["f2"],
      ["p1", "p2"],
    ]);
    expect(pattern.placements.map(({ positionMm }) => positionMm)).toEqual([
      { x: 150, y: 25 },
      { x: 250, y: 25 },
      { x: 50, y: 125 },
      { x: 350, y: 125 },
    ]);
    expect(
      pattern.grips
        .filter(({ numPackages }) => numPackages === 2)
        .map(({ x, y }) => ({ x, y })),
    ).toEqual([{ x: 200, y: 25 }]);
  });

  /**
   * Candidate-12-like layer: a 5 x 6 block of 180 x 130 mm packages and a
   * right column of four crosswise packages with 20 mm gaps.
   */
  function blockWithGappedColumnProject(): Project {
    const block = Array.from({ length: 6 }, (_, row) =>
      Array.from({ length: 5 }, (_, column) =>
        placement(
          `r${row}c${column}`,
          row * 5 + column,
          90 + column * 180,
          65 + row * 130,
        ),
      ),
    ).flat();
    const column = [0, 1, 2, 3].map((index) => ({
      ...placement(`k${index}`, 30 + index, 965, 90 + index * 200),
      rotation: 90 as const,
    }));
    return projectWithPlacements([...block, ...column], (base) => ({
      package: {
        ...base.package,
        dimensionsMm: { length: 180, width: 130, height: 100 },
      },
      pallet: {
        ...base.pallet!,
        dimensionsMm: { length: 1200, width: 800, height: 144 },
        storageEnvelopeMm: { length: 1200, width: 800, height: 1800 },
      },
      grippers: base.grippers.map((item) => ({
        ...item,
        maxPickupLengthMm: 400,
      })),
    }));
  }

  function recalculatedOrder(project: Project): string[][] {
    const recalculated = applyProjectEditorCommand(project, {
      type: "recalculate-groups",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
    });
    return projectEditorOrderModel(
      recalculated,
      "solution-1",
      "pattern-1",
    ).groups.map(({ placementIds }) => [...placementIds]);
  }

  it("orders recalculated grips lower half first, row by row, right to left", () => {
    const project = blockWithGappedColumnProject();
    // Row by row from the bottom, right to left; each column pair leads the
    // row band that holds its bottom edge.
    const lowerHalf = [
      ["k0", "k1"],
      ["r0c3", "r0c4"],
      ["r0c2"],
      ["r0c0", "r0c1"],
      ["r1c4"],
      ["r1c2", "r1c3"],
      ["r1c0", "r1c1"],
      ["r2c3", "r2c4"],
      ["r2c2"],
      ["r2c0", "r2c1"],
    ];
    const upperHalf = [
      ["k2", "k3"],
      ["r3c4"],
      ["r3c2", "r3c3"],
      ["r3c0", "r3c1"],
      ["r4c3", "r4c4"],
      ["r4c2"],
      ["r4c0", "r4c1"],
      ["r5c4"],
      ["r5c2", "r5c3"],
      ["r5c0", "r5c1"],
    ];

    // The split is the row boundary at y = 390 mm between rows 3 and 4.
    expect(recalculatedOrder(project)).toEqual([...lowerHalf, ...upperHalf]);
  });

  it("suggests the lower half first for an existing column-first order", () => {
    const recalculated = applyProjectEditorCommand(
      blockWithGappedColumnProject(),
      {
        type: "recalculate-groups",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
      },
    );
    const model = projectEditorOrderModel(
      recalculated,
      "solution-1",
      "pattern-1",
    );
    const expected = model.order;
    const gripIdOf = (placementId: string) =>
      model.groups.find(({ placementIds }) =>
        placementIds.includes(placementId),
      )!.id;
    // Old rule: the whole right column first, then the upper k2+k3 pair.
    const columnFirst = [
      gripIdOf("k0"),
      gripIdOf("k2"),
      ...expected.filter(
        (id) => id !== gripIdOf("k0") && id !== gripIdOf("k2"),
      ),
    ];
    const reordered = applyProjectEditorCommand(recalculated, {
      type: "apply-suggested-order",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      gripIds: columnFirst,
    });

    expect(
      suggestProjectEditorOrder(reordered, "solution-1", "pattern-1").order,
    ).toEqual(expected);
  });

  it("reproduces Snupai's manual order for Candidate 12 automatically", () => {
    // Golden case from project c8d73825 (Candidate 12): 189 x 132 mm
    // packages, six rows split 2 + 1 + 2 and a right column of two crosswise
    // pairs. Grip centres match the editor's "Grips in order" list.
    const rowGrips = Array.from({ length: 6 }, (_, row) => {
      const y = 70 + row * 132;
      return [
        { id: `r${row}-left`, xs: [156, 345] },
        { id: `r${row}-mid`, xs: [534] },
        { id: `r${row}-right`, xs: [723, 912] },
      ].map(({ id, xs }) => ({
        id,
        rotation: 0 as const,
        placements: xs.map((x, index) => ({
          ...placement(`${id}-${index}`, 0, x, y),
        })),
      }));
    }).flat();
    const columnGrips = [
      { id: "column-low", ys: [98.5, 287.5] },
      { id: "column-high", ys: [512.5, 701.5] },
    ].map(({ id, ys }) => ({
      id,
      rotation: 90 as const,
      placements: ys.map((y, index) => ({
        ...placement(`${id}-${index}`, 0, 1072.5, y),
        rotation: 90 as const,
      })),
    }));
    // Stored in an arbitrary (alphabetical) order.
    const grips = [...rowGrips, ...columnGrips].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const base = blockWithGappedColumnProject();
    const solution = base.solutions[0]!;
    const project = projectSchema.parse({
      ...base,
      package: {
        ...base.package,
        dimensionsMm: { length: 189, width: 132, height: 100 },
      },
      solutions: [
        {
          ...solution,
          patterns: [
            {
              ...solution.patterns[0]!,
              grips: grips.map((grip, index) => {
                const xs = grip.placements.map(
                  ({ positionMm }) => positionMm.x,
                );
                const ys = grip.placements.map(
                  ({ positionMm }) => positionMm.y,
                );
                return {
                  id: grip.id,
                  groupNumber: index + 1,
                  pickX: 0,
                  pickY: 0,
                  pickRotation: 0,
                  x: xs.reduce((sum, x) => sum + x, 0) / xs.length,
                  y: ys.reduce((sum, y) => sum + y, 0) / ys.length,
                  rotation: grip.rotation,
                  numPackages: grip.placements.length,
                  dx: 0,
                  dy: 0,
                };
              }),
              placements: grips
                .flatMap((grip) =>
                  grip.placements.map((item) => ({ ...item, gripId: grip.id })),
                )
                .map((item, sequence) => ({ ...item, sequence })),
              groupOrder: grips.map(({ id }) => id),
              orderDependencies: [],
            },
          ],
        },
      ],
    });
    const row = (index: number) => [
      `r${index}-right`,
      `r${index}-mid`,
      `r${index}-left`,
    ];

    expect(
      projectEditorOrderModel(project, "solution-1", "pattern-1").diagnostics,
    ).toEqual([]);
    expect(
      suggestProjectEditorOrder(project, "solution-1", "pattern-1").order,
    ).toEqual([
      "column-low",
      ...row(0),
      ...row(1),
      ...row(2),
      "column-high",
      ...row(3),
      ...row(4),
      ...row(5),
    ]);
  });

  it("closes gaps without floating-point overlaps the validation rejects", () => {
    // (156.4 + 100) - 50 < 156.4 + 50 in floating point: the ideal contact
    // position would overlap p1 by about 1e-14 mm. f1/f2 keep both packages
    // off the layer's outer edges so they may slide.
    const project = projectWithPlacements([
      placement("p1", 0, 156.4, 50),
      placement("p2", 1, 266.4, 50),
      placement("f1", 2, 50, 150),
      placement("f2", 3, 350, 150),
    ]);
    const recalculated = applyProjectEditorCommand(project, {
      type: "recalculate-groups",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
    });
    const model = projectEditorOrderModel(
      recalculated,
      "solution-1",
      "pattern-1",
    );
    const [first, second] = recalculated.solutions[0]!.patterns[0]!.placements;

    expect(automaticGroups(recalculated)).toEqual([
      ["f1"],
      ["f2"],
      ["p1", "p2"],
    ]);
    expect(model.diagnostics).toEqual([]);
    expect(first!.positionMm.x).toBe(156.4);
    expect(second!.positionMm.x - 50 >= first!.positionMm.x + 50).toBe(true);
    expect(second!.positionMm.x).toBeCloseTo(256.4, 9);

    // Recalculating again keeps the exact positions instead of recomputing
    // the ideal (overlapping) contact.
    const again = applyProjectEditorCommand(recalculated, {
      type: "recalculate-groups",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
    });
    expect(
      again.solutions[0]!.patterns[0]!.placements.map(
        ({ positionMm }) => positionMm.x,
      ),
    ).toEqual([first!.positionMm.x, second!.positionMm.x, 50, 350]);
    expect(
      projectEditorOrderModel(again, "solution-1", "pattern-1").diagnostics,
    ).toEqual([]);
  });

  it("centers an automatic singleton in a vertical five-package run", () => {
    const base = editorProject();
    const pallet = base.pallet;
    if (!pallet) throw new Error("Expected the editor pallet fixture.");
    const solution = base.solutions[0]!;
    const sourcePattern = solution.patterns[0]!;
    const placements = Array.from({ length: 5 }, (_, index) => ({
      ...placement(`p${index + 1}`, index, 50, 50 + index * 100),
      rotation: 90 as const,
    }));
    const project = projectSchema.parse({
      ...base,
      pallet: {
        ...pallet,
        dimensionsMm: { ...pallet.dimensionsMm, width: 600 },
        storageEnvelopeMm: { length: 400, width: 600, height: 500 },
      },
      solutions: [
        {
          ...solution,
          patterns: [{ ...sourcePattern, grips: [], placements }],
        },
      ],
    });

    expect(
      projectEditorOrderModel(project, "solution-1", "pattern-1").groups.map(
        ({ groupNumber, placementIds }) => ({ groupNumber, placementIds }),
      ),
    ).toEqual([
      { groupNumber: 1, placementIds: ["p1", "p2"] },
      { groupNumber: 2, placementIds: ["p3"] },
      { groupNumber: 3, placementIds: ["p4", "p5"] },
    ]);
  });

  it("repairs a persisted solver order when the editor opens", () => {
    const leftGripId = persistedSolverGripId(1);
    const rightGripId = persistedSolverGripId(2);
    const history = createProjectEditorHistory(persistedSolverOrderProject());
    const model = projectEditorOrderModel(
      history.present,
      "solution-1",
      "solver-pattern-1-identity-legacy-candidate",
    );

    expect(
      model.groups.map(({ id, groupNumber }) => ({ id, groupNumber })),
    ).toEqual([
      { id: rightGripId, groupNumber: 1 },
      { id: leftGripId, groupNumber: 2 },
    ]);
    expect(pattern(history.present).groupOrder).toEqual([
      rightGripId,
      leftGripId,
    ]);
    expect(projectEditorHistoryDirty(history)).toBe(false);
  });

  it.each([
    {
      name: "explicitly marked manual",
      project: () => persistedSolverOrderProject("manual"),
    },
    {
      name: "unmarked legacy manual",
      project: () => persistedSolverOrderProject(undefined, true),
    },
  ])("preserves an $name order when the editor opens", ({ project }) => {
    const leftGripId = persistedSolverGripId(1);
    const rightGripId = persistedSolverGripId(2);
    const history = createProjectEditorHistory(project());
    const model = projectEditorOrderModel(
      history.present,
      "solution-1",
      "solver-pattern-1-identity-legacy-candidate",
    );

    expect(
      model.groups.map(({ id, groupNumber }) => ({ id, groupNumber })),
    ).toEqual([
      { id: rightGripId, groupNumber: 1 },
      { id: leftGripId, groupNumber: 2 },
    ]);
    expect(pattern(history.present).groupOrder).toEqual([
      rightGripId,
      leftGripId,
    ]);
    expect(projectEditorHistoryDirty(history)).toBe(false);
  });

  it("renumbers G1 through Gx after reordering independent grips", () => {
    const reordered = applyProjectEditorCommand(twoGripProject(), {
      type: "reorder-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      gripId: "left",
      toIndex: 0,
    });

    expect(pattern(reordered).groupOrder).toEqual(["left", "right"]);
    expect(pattern(reordered).gripPlanningSource).toBe("manual");
    expect(
      projectEditorOrderModel(reordered, "solution-1", "pattern-1").groups.map(
        ({ id, groupNumber }) => ({ id, groupNumber }),
      ),
    ).toEqual([
      { id: "left", groupNumber: 1 },
      { id: "right", groupNumber: 2 },
    ]);
  });

  it("rejects an explicit dependency that would oppose hard geometry", () => {
    const project = generatedGripProject();

    expect(() =>
      applyProjectEditorCommand(project, {
        type: "add-order-dependency",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
        beforeGripId: "generated-grip:3+4",
        afterGripId: "generated-grip:1+2",
      }),
    ).toThrow(/would create a cycle/i);
  });

  it("rejects a transitive explicit dependency cycle", () => {
    expect(() =>
      applyProjectEditorCommand(threeGripProject(), {
        type: "add-order-dependency",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
        beforeGripId: "c",
        afterGripId: "a",
      }),
    ).toThrow(/would create a cycle/i);
  });

  it("keeps a legacy explicit edge over identical inference and reveals inference after removal", () => {
    const base = generatedGripProject();
    const solution = base.solutions[0]!;
    const sourcePattern = solution.patterns[0]!;
    let project = projectSchema.parse({
      ...base,
      solutions: [
        {
          ...solution,
          patterns: [
            {
              ...sourcePattern,
              orderDependencies: [
                {
                  beforeGripId: "generated-grip:1+2",
                  afterGripId: "generated-grip:3+4",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(
      projectEditorOrderModel(project, "solution-1", "pattern-1").dependencies,
    ).toContainEqual({
      beforeGripId: "generated-grip:1+2",
      afterGripId: "generated-grip:3+4",
      source: "explicit",
    });

    project = applyProjectEditorCommand(project, {
      type: "set-pattern-name",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      name: "Explicit dependency retained",
    });
    expect(pattern(project).orderDependencies).toContainEqual({
      beforeGripId: "generated-grip:1+2",
      afterGripId: "generated-grip:3+4",
      source: "explicit",
    });

    project = applyProjectEditorCommand(project, {
      type: "remove-order-dependency",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      beforeGripId: "generated-grip:1+2",
      afterGripId: "generated-grip:3+4",
    });
    expect(
      projectEditorOrderModel(project, "solution-1", "pattern-1").dependencies,
    ).toContainEqual({
      beforeGripId: "generated-grip:1+2",
      afterGripId: "generated-grip:3+4",
      source: "inferred",
    });
  });

  it("blocks a manual reorder against hard overlap geometry", () => {
    expect(() =>
      applyProjectEditorCommand(generatedGripProject(), {
        type: "reorder-group",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
        gripId: "generated-grip:3+4",
        toIndex: 0,
      }),
    ).toThrow(/cannot execute before prerequisite/i);
  });

  it("repairs stale persisted order and numbering after a geometry edit", () => {
    const base = generatedGripProject();
    const solution = base.solutions[0]!;
    const sourcePattern = solution.patterns[0]!;
    const stale = projectSchema.parse({
      ...base,
      solutions: [
        {
          ...solution,
          patterns: [
            {
              ...sourcePattern,
              grips: sourcePattern.grips.map((grip) => ({
                ...grip,
                groupNumber: grip.id === "generated-grip:3+4" ? 1 : 2,
              })),
              groupOrder: ["generated-grip:3+4", "generated-grip:1+2"],
              orderDependencies: [],
            },
          ],
        },
      ],
    });

    const repaired = applyProjectEditorCommand(stale, {
      type: "move-placements",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2"],
      deltaMm: { x: 10, y: 0 },
    });

    expect(pattern(repaired).groupOrder).toEqual([
      "generated-grip:1+2",
      "generated-grip:3+4",
    ]);
    expect(
      pattern(repaired).grips.map(({ id, groupNumber }) => ({
        id,
        groupNumber,
      })),
    ).toEqual([
      { id: "generated-grip:1+2", groupNumber: 1 },
      { id: "generated-grip:3+4", groupNumber: 2 },
    ]);
  });

  it("marks inferred dx/dy dependencies immutable", () => {
    const project = importedGripProject();
    const model = projectEditorOrderModel(project, "solution-1", "pattern-1");
    expect(model.dependencies).toContainEqual({
      beforeGripId: "g1",
      afterGripId: "g2",
      source: "inferred",
    });

    expect(() =>
      applyProjectEditorCommand(project, {
        type: "remove-order-dependency",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
        beforeGripId: "g1",
        afterGripId: "g2",
      }),
    ).toThrow(/automatically inferred grip dependencies cannot be removed/i);
  });

  it("preserves imported groups without authorizing new multipick groups", () => {
    const project = importedGripProject();

    expect(project.package.multiPickAllowed).toBe(false);
    expect(() =>
      applyProjectEditorCommand(project, {
        type: "merge-groups",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
        gripIds: ["g1", "g2"],
      }),
    ).toThrow(/does not allow multiple packages in one grip group/i);
  });

  it("adds, removes, splits, and merges groups without deleting packages", () => {
    let project = applyProjectEditorCommand(editorProject(), {
      type: "create-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2"],
    });
    let model = projectEditorOrderModel(project, "solution-1", "pattern-1");
    const first = model.groups[0]!;
    project = applyProjectEditorCommand(project, {
      type: "split-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      gripId: first.id,
    });
    model = projectEditorOrderModel(project, "solution-1", "pattern-1");
    expect(model.groups).toHaveLength(3);

    const singles = model.groups.filter(({ placementIds }) =>
      placementIds.some((id) => id === "p1" || id === "p2"),
    );
    project = applyProjectEditorCommand(project, {
      type: "merge-groups",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      gripIds: singles.map(({ id }) => id),
    });
    model = projectEditorOrderModel(project, "solution-1", "pattern-1");
    expect(model.groups).toHaveLength(2);

    project = applyProjectEditorCommand(project, {
      type: "remove-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      gripId: model.groups[0]!.id,
    });
    expect(pattern(project).placements).toHaveLength(4);
    expect(
      projectEditorOrderModel(project, "solution-1", "pattern-1")
        .unassignedPlacementIds.length,
    ).toBeGreaterThan(0);
  });
});

describe("grip selection preview", () => {
  it("accepts a valid selection and explains a rejected one", () => {
    const project = editorProject();
    expect(
      previewGripFromSelection(project, "solution-1", "pattern-1", []),
    ).toBeNull();
    expect(
      previewGripFromSelection(project, "solution-1", "pattern-1", [
        "p1",
        "p2",
      ]),
    ).toBeNull();
    const problem = previewGripFromSelection(
      project,
      "solution-1",
      "pattern-1",
      ["p1", "p3"],
    );
    expect(problem?.code).toBe("invalid-group-geometry");
    expect(problem?.message).toBe(
      "Grouped packages must be aligned on one cross axis.",
    );
    expect(problem?.placementIds).toEqual(["p1", "p3"]);
  });

  it("flags the remainder when a package is taken out of a grip's middle", () => {
    let project = applyProjectEditorCommand(editorProject(), {
      type: "move-placements",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p3"],
      deltaMm: { x: 200, y: -100 },
    });
    project = applyProjectEditorCommand(project, {
      type: "create-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2", "p3"],
    });
    const row = pattern(project).placements.find(({ id }) => id === "p1")!;

    const problem = previewGripFromSelection(
      project,
      "solution-1",
      "pattern-1",
      ["p2"],
    );
    expect(problem?.message).toBe(
      "Grouped packages must be face-adjacent along their local length axis.",
    );
    expect(problem?.gripIds).toEqual([row.gripId]);
    expect(problem?.placementIds).toEqual(["p1", "p3"]);
    // Taking the end package out leaves an adjacent pair.
    expect(
      previewGripFromSelection(project, "solution-1", "pattern-1", ["p3"]),
    ).toBeNull();
  });
});

describe("Project editor canonical flow and history", () => {
  it("steps pick, transfer, and place over references from the shared cycle array", () => {
    const project = applyProjectEditorCommand(editorProject(), {
      type: "create-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2"],
    });
    const materialization = materializeRobotCycles(project, {
      pickReference: {
        originMm: { x: 0, y: 0, z: 100 },
        yawDeg: 0,
        provenance: { status: "verified", source: "editor test" },
      },
    });
    const flow = createProjectEditorFlow(
      materialization,
      activePatternReference(project, "solution-1", "pattern-1"),
    );

    expect(flow.sourceCycles).toBe(materialization.cycles);
    expect(flow.phases).toHaveLength(flow.cycles.length * 3);
    expect(flow.phases[0]?.cycle).toBe(materialization.cycles[0]);
    expect(flow.phases.slice(0, 3).map(({ phase }) => phase)).toEqual([
      "pick",
      "transfer",
      "place",
    ]);
    expect(stepProjectEditorFlow(0, flow.phases.length, "end")).toBe(
      flow.phases.length - 1,
    );
    expect(
      stepProjectEditorFlow(flow.phases.length - 1, flow.phases.length, "next"),
    ).toBe(flow.phases.length - 1);
  });

  it("uses one history across pattern, order, and interlayer commands and supports save/discard", () => {
    const original = editorProject();
    let history = createProjectEditorHistory(original);
    history = projectEditorHistoryReducer(history, {
      type: "execute",
      command: {
        type: "set-label-side",
        mode: "pattern",
        solutionId: "solution-1",
        patternId: "pattern-1",
        placementIds: ["p1"],
        labelSide: "top",
      },
    });
    history = projectEditorHistoryReducer(history, {
      type: "execute",
      command: {
        type: "create-group",
        mode: "order",
        solutionId: "solution-1",
        patternId: "pattern-1",
        placementIds: ["p1", "p2"],
      },
    });
    history = projectEditorHistoryReducer(history, {
      type: "execute",
      command: {
        type: "set-interlayer-before",
        mode: "pattern",
        solutionId: "solution-1",
        layerId: "layer-1",
        quantity: 2,
      },
    });
    expect(history.past.map(({ mode }) => mode)).toEqual([
      "pattern",
      "order",
      "pattern",
    ]);
    expect(projectEditorHistoryDirty(history)).toBe(true);

    history = projectEditorHistoryReducer(history, { type: "undo" });
    expect(
      history.present.solutions[0]?.stack.layers[0]?.interlayerBefore,
    ).toBe(0);
    history = projectEditorHistoryReducer(history, { type: "redo" });
    expect(
      history.present.solutions[0]?.stack.layers[0]?.interlayerBefore,
    ).toBe(2);
    history = projectEditorHistoryReducer(history, { type: "mark-saved" });
    expect(projectEditorHistoryDirty(history)).toBe(false);

    history = projectEditorHistoryReducer(history, {
      type: "execute",
      command: {
        type: "move-placements",
        mode: "pattern",
        solutionId: "solution-1",
        patternId: "pattern-1",
        placementIds: ["p3", "p4"],
        deltaMm: { x: 10, y: 0 },
      },
    });
    expect(projectEditorHistoryDirty(history)).toBe(true);
    history = projectEditorHistoryReducer(history, { type: "discard" });
    expect(projectEditorHistoryDirty(history)).toBe(false);
    expect(
      pattern(history.present).placements.find(({ id }) => id === "p3")
        ?.positionMm.x,
    ).toBe(50);
  });
});

describe("deck interlayer command provenance", () => {
  const commands = [
    { type: "set-interlayer-thickness", thicknessMm: 5 },
    { type: "set-trailing-interlayer", quantity: 2 },
    { type: "set-trailing-interlayer-thickness", thicknessMm: 5 },
  ] as const;

  it.each(commands)("rejects a missing solution for $type", (command) => {
    expect(() =>
      applyProjectEditorCommand(importedGripProject(), {
        ...command,
        mode: "pattern",
        solutionId: "missing",
      }),
    ).toThrow('Project solution "missing" does not exist.');
  });

  it.each(commands)(
    "marks imported solutions edited for $type without rewriting source",
    (command) => {
      const project = importedGripProject();
      const edited = applyProjectEditorCommand(project, {
        ...command,
        mode: "pattern",
        solutionId: project.solutions[0]!.id,
      } satisfies ProjectEditorCommand);
      expect(edited.solutions[0]!.origin).toBe("manual");
      expect(edited.source).toEqual(project.source);
      expect(edited.solutions[0]!.stack).toMatchObject(
        command.type === "set-trailing-interlayer"
          ? { trailingInterlayer: 2 }
          : command.type === "set-trailing-interlayer-thickness"
            ? { trailingInterlayerThicknessMm: 5 }
            : { interlayerThicknessMm: 5 },
      );
    },
  );
});
