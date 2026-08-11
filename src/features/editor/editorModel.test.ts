import { describe, expect, it } from "vitest";
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
  projectEditorOrderModel,
  selectionCenteringDelta,
  stepProjectEditorFlow,
  suggestProjectEditorOrder,
} from "~/features/editor/editorModel";

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
                dy: 14,
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

  it("preserves imported raw dx/dy through unrelated editor commands", () => {
    let project = importedGripProject();
    const rawOffsets = () =>
      pattern(project).grips.map(({ id, dx, dy }) => ({ id, dx, dy }));
    const expected = [
      { id: "g1", dx: 37, dy: 0 },
      { id: "g2", dx: 0, dy: 14 },
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

    project = applyProjectEditorCommand(project, {
      type: "reorder-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      gripId: "g2",
      toIndex: 0,
    });
    expect(rawOffsets()).toEqual(expected);

    project = applyProjectEditorCommand(project, {
      type: "set-label-side",
      mode: "pattern",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2"],
      labelSide: "bottom",
    });
    expect(rawOffsets()).toEqual([
      { id: "g1", dx: 0, dy: 1 },
      { id: "g2", dx: 0, dy: 14 },
    ]);
  });
});

describe("Project editor groups and order", () => {
  it("keeps stable group numbers separate from editable dependency-aware order", () => {
    let project = editorProject();
    project = applyProjectEditorCommand(project, {
      type: "create-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      placementIds: ["p1", "p2"],
    });
    let model = projectEditorOrderModel(project, "solution-1", "pattern-1");
    expect(model.groups).toHaveLength(2);
    const first = model.groups[0]!;
    const second = model.groups[1]!;
    const stableNumber = second.groupNumber;

    project = applyProjectEditorCommand(project, {
      type: "add-order-dependency",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      beforeGripId: second.id,
      afterGripId: first.id,
    });
    model = projectEditorOrderModel(project, "solution-1", "pattern-1");
    expect(model.diagnostics.map(({ code }) => code)).toContain(
      "invalid-order",
    );

    const suggestion = suggestProjectEditorOrder(
      project,
      "solution-1",
      "pattern-1",
    );
    expect(suggestion.order.indexOf(second.id)).toBeLessThan(
      suggestion.order.indexOf(first.id),
    );
    project = applyProjectEditorCommand(project, {
      type: "apply-suggested-order",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      gripIds: suggestion.order,
    });
    project = applyProjectEditorCommand(project, {
      type: "renumber-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      gripId: second.id,
      groupNumber: 9,
    });
    project = applyProjectEditorCommand(project, {
      type: "reorder-group",
      mode: "order",
      solutionId: "solution-1",
      patternId: "pattern-1",
      gripId: second.id,
      toIndex: 0,
    });
    model = projectEditorOrderModel(project, "solution-1", "pattern-1");
    expect(model.groups[0]?.id).toBe(second.id);
    expect(model.groups[0]?.groupNumber).toBe(9);
    expect(model.groups[0]?.groupNumber).not.toBe(stableNumber);
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
    ).toThrow(/inferred from legacy dx\/dy offsets cannot be removed/i);
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
