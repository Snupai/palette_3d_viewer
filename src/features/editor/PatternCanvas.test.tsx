import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type {
  Gripper,
  PalletStation,
  Project,
} from "~/domain/project/projectSchema";
import { PatternCanvas } from "~/features/editor/PatternCanvas";
import type { ProjectEditorGroup } from "~/features/editor/editorModel";

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

function projectFixture(): Project {
  return createProject(
    {
      id: "pattern-canvas-project",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 40 },
        clearanceMm: 0,
        multiPickAllowed: true,
        palletizingDirection: "x-positive-y-positive",
      },
      pallet: {
        id: "pallet-1",
        name: "Test pallet",
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
          name: "Solution 1",
          origin: "manual",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern 1",
              grips: [
                {
                  id: "g1",
                  groupNumber: 7,
                  pickX: 50,
                  pickY: 0,
                  pickRotation: 0,
                  x: 100,
                  y: 50,
                  rotation: 0,
                  numPackages: 2,
                  dx: 0,
                  dy: -1,
                },
              ],
              placements: [
                {
                  id: "p1",
                  sequence: 0,
                  positionMm: { x: 50, y: 50 },
                  rotation: 0,
                  gripId: "g1",
                  labelSide: "bottom",
                },
                {
                  id: "p2",
                  sequence: 1,
                  positionMm: { x: 150, y: 50 },
                  rotation: 0,
                  gripId: "g1",
                  labelSide: "bottom",
                },
              ],
              groupOrder: ["g1"],
              orderDependencies: [],
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

const groups: readonly ProjectEditorGroup[] = [
  {
    id: "g1",
    groupNumber: 7,
    placementIds: ["p1", "p2"],
    centerMm: { x: 100, y: 50 },
    rotation: 0,
    persisted: true,
    orderIndex: 0,
  },
];

afterEach(cleanup);

function firePointerEvent(
  target: Element,
  type: "pointerdown" | "pointerup",
  init: MouseEventInit & { pointerId: number },
) {
  const { pointerId, ...mouseInit } = init;
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...mouseInit,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(target, event);
}

describe("PatternCanvas", () => {
  it("renders and edits a multipackage grip as one unit", () => {
    const project = projectFixture();
    const pattern = project.solutions[0]!.patterns[0]!;
    const onSelectionChange =
      vi.fn<(placementIds: ReadonlySet<string>) => void>();
    const onMoveSelection = vi.fn();
    const { container } = render(
      <PatternCanvas
        project={project}
        pattern={pattern}
        groups={groups}
        selectedPlacementIds={new Set(["p1"])}
        fineStepMm={1}
        coarseStepMm={10}
        onSelectionChange={onSelectionChange}
        onMoveSelection={onMoveSelection}
        onNudgeSelection={vi.fn()}
        onDeleteSelection={vi.fn()}
        onRotateSelection={vi.fn()}
      />,
    );

    const packageRects = screen.getAllByRole("button");
    expect(packageRects).toHaveLength(2);
    expect(screen.getAllByText("G1")).toHaveLength(1);

    const cyanPaths = [
      ...container.querySelectorAll<SVGPathElement>(
        'path[stroke="var(--measure)"]',
      ),
    ];
    expect(cyanPaths.map((path) => path.getAttribute("d"))).toEqual([
      "M 0 225 L 100 225",
      "M 100 225 L 200 225",
    ]);

    const delta = screen.getByTestId("grip-delta-g1");
    const deltaLine = delta.querySelector("line")!;
    expect({
      x1: deltaLine.getAttribute("x1"),
      y1: deltaLine.getAttribute("y1"),
      x2: deltaLine.getAttribute("x2"),
      y2: deltaLine.getAttribute("y2"),
    }).toEqual({ x1: "100", y1: "250", x2: "100", y2: "230" });
    expect(screen.getByText("Δx 0 / Δy -1")).toBeTruthy();

    const svg = screen.getByRole("application") as unknown as SVGSVGElement;
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 300,
        right: 400,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(packageRects[0], "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    firePointerEvent(packageRects[0]!, "pointerdown", {
      pointerId: 4,
      clientX: 50,
      clientY: 50,
    });
    expect([...onSelectionChange.mock.calls.at(-1)![0]]).toEqual(["p1", "p2"]);

    firePointerEvent(packageRects[0]!, "pointerup", {
      pointerId: 4,
      clientX: 70,
      clientY: 40,
    });
    expect(onMoveSelection).toHaveBeenCalledWith({ x: 20, y: 10 }, [
      "p1",
      "p2",
    ]);
  });

  it("selects the complete grip from the keyboard", () => {
    const project = projectFixture();
    const pattern = project.solutions[0]!.patterns[0]!;
    const onSelectionChange =
      vi.fn<(placementIds: ReadonlySet<string>) => void>();
    render(
      <PatternCanvas
        project={project}
        pattern={pattern}
        groups={groups}
        selectedPlacementIds={new Set()}
        fineStepMm={1}
        coarseStepMm={10}
        onSelectionChange={onSelectionChange}
        onMoveSelection={vi.fn()}
        onNudgeSelection={vi.fn()}
        onDeleteSelection={vi.fn()}
        onRotateSelection={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getAllByRole("button")[1]!, { key: "Enter" });
    expect([...onSelectionChange.mock.calls.at(-1)![0]]).toEqual(["p1", "p2"]);
  });
});
