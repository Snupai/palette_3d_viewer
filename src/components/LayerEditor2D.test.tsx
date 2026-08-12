import { useState, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LayerEditor2D,
  type LayerEditor2DProps,
} from "~/components/LayerEditor2D";
import type { Grip } from "~/domain/palletTypes";

type HarnessProps = {
  initialGrips: Grip[];
  initialSelectedGripIndex?: number | null;
  onCommit: (grips: Grip[]) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onResetToOriginal?: () => void;
  interlayerEditor?: ReactNode;
};

function grip(id: string, overrides?: Partial<Grip>): Grip {
  return {
    id,
    pickX: 100,
    pickY: -150,
    pickRotation: 0,
    x: 600,
    y: 400,
    rotation: 0,
    numPackages: 1,
    dx: 0,
    dy: 0,
    ...overrides,
  };
}

function EditorHarness({
  initialGrips,
  initialSelectedGripIndex = 0,
  onCommit,
  onUndo = vi.fn(),
  onRedo = vi.fn(),
  onResetToOriginal = vi.fn(),
  interlayerEditor,
}: HarnessProps) {
  const [grips, setGrips] = useState(initialGrips);
  const [selectedGripIndex, setSelectedGripIndex] = useState<number | null>(
    initialSelectedGripIndex,
  );
  const handleCommit: LayerEditor2DProps["onCommitGrips"] = (nextGrips) => {
    onCommit(nextGrips);
    setGrips(nextGrips);
  };

  return (
    <LayerEditor2D
      uniqueLayerId={1}
      grips={grips}
      packageWidth={200}
      packageLength={300}
      inputDirection={0}
      pallet={{ width: 1200, length: 800 }}
      selectedGripIndex={selectedGripIndex}
      onSelectGrip={setSelectedGripIndex}
      onCommitGrips={handleCommit}
      hasUnsavedChanges
      isSaving={false}
      onSave={vi.fn()}
      onDiscard={vi.fn()}
      canUndo
      canRedo
      historyPosition={2}
      historyLength={4}
      canResetToOriginal
      onUndo={onUndo}
      onRedo={onRedo}
      onResetToOriginal={onResetToOriginal}
      interlayerEditor={interlayerEditor}
    />
  );
}

function latestCommitted(onCommit: ReturnType<typeof vi.fn>): Grip[] {
  const call = onCommit.mock.calls.at(-1);
  if (!call) throw new Error("Expected an editor commit");
  return call[0] as Grip[];
}

function firePointerEvent(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: MouseEventInit & { pointerId?: number } = {},
) {
  const { pointerId = 0, ...mouseInit } = init;
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...mouseInit,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(target, event);
}

function mockSvgPointerGeometry(svg: SVGSVGElement, rect: SVGRectElement) {
  Object.defineProperty(svg, "getScreenCTM", {
    configurable: true,
    value: () => ({ inverse: () => ({}) }),
  });
  Object.defineProperty(svg, "createSVGPoint", {
    configurable: true,
    value: () => {
      const point = {
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: point.x, y: point.y }),
      };
      return point;
    },
  });

  let capturedPointer: number | null = null;
  Object.defineProperty(rect, "setPointerCapture", {
    configurable: true,
    value: (pointerId: number) => {
      capturedPointer = pointerId;
    },
  });
  Object.defineProperty(rect, "hasPointerCapture", {
    configurable: true,
    value: (pointerId: number) => capturedPointer === pointerId,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LayerEditor2D critical flows", () => {
  it("splits, merges, deletes, and adds through the unchanged commit interface", () => {
    const onCommit = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <EditorHarness
        initialGrips={[grip("group", { numPackages: 2 })]}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Split group" }));
    const split = latestCommitted(onCommit);
    expect(split).toHaveLength(2);
    expect(split.every((item) => item.numPackages === 1)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Merge group (2)" }));
    const merged = latestCommitted(onCommit);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.numPackages).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    expect(latestCommitted(onCommit)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Add package" }));
    const added = latestCommitted(onCommit);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      x: 600,
      y: 400,
      rotation: 0,
      numPackages: 1,
    });
  });

  it("lets touch users build a merge group without modifier keys", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <EditorHarness
        initialGrips={[grip("first", { x: 500 }), grip("second", { x: 700 })]}
        initialSelectedGripIndex={null}
        onCommit={onCommit}
      />,
    );
    const groupingMode = screen.getByRole("button", {
      name: "Grouping mode",
    });

    fireEvent.click(groupingMode);
    expect(groupingMode.getAttribute("aria-pressed")).toBe("true");

    const first = container.querySelector<SVGRectElement>(
      "[data-grip-index='0'][data-box-index='0']",
    )!;
    const second = container.querySelector<SVGRectElement>(
      "[data-grip-index='1'][data-box-index='0']",
    )!;
    firePointerEvent(first, "pointerdown", { pointerId: 11 });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Merge group (1)" })
        .disabled,
    ).toBe(true);

    firePointerEvent(second, "pointerdown", { pointerId: 12 });
    fireEvent.click(screen.getByRole("button", { name: "Merge group (2)" }));

    const merged = latestCommitted(onCommit);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      x: 600,
      y: 400,
      numPackages: 2,
    });
  });

  it("commits drag previews while preserving the pick/place offset", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <EditorHarness
        initialGrips={[
          grip("drag", { x: 400, y: 300, pickX: 100, pickY: -150 }),
        ]}
        onCommit={onCommit}
      />,
    );
    const svg = screen.getByRole("application") as unknown as SVGSVGElement;
    const rect = container.querySelector<SVGRectElement>("rect.cursor-grab")!;
    mockSvgPointerGeometry(svg, rect);

    firePointerEvent(rect, "pointerdown", {
      pointerId: 9,
      clientX: 400,
      clientY: 500,
    });
    firePointerEvent(rect, "pointermove", {
      pointerId: 9,
      clientX: 450,
      clientY: 450,
    });
    firePointerEvent(rect, "pointerup", {
      pointerId: 9,
      clientX: 450,
      clientY: 450,
    });

    expect(latestCommitted(onCommit)[0]).toMatchObject({
      x: 450,
      y: 350,
      pickX: 150,
      pickY: -100,
    });
  });

  it("keeps rotation edits, history actions, and interlayer content wired", () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onResetToOriginal = vi.fn();
    const onInterlayerChange = vi.fn();
    render(
      <EditorHarness
        initialGrips={[grip("rotate")]}
        onCommit={onCommit}
        onUndo={onUndo}
        onRedo={onRedo}
        onResetToOriginal={onResetToOriginal}
        interlayerEditor={
          <button type="button" onClick={onInterlayerChange}>
            Toggle interlayer
          </button>
        }
      />,
    );

    const rotation = screen.getByLabelText("Place rotation");
    fireEvent.change(rotation, { target: { value: "90" } });
    fireEvent.blur(rotation);
    expect(latestCommitted(onCommit)[0]).toMatchObject({
      rotation: 90,
      pickRotation: 90,
    });

    fireEvent.click(screen.getByRole("button", { name: "Rotate 90°" }));
    expect(latestCommitted(onCommit)[0]).toMatchObject({
      rotation: 180,
      pickRotation: 180,
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to original" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle interlayer" }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onResetToOriginal).toHaveBeenCalledTimes(1);
    expect(onInterlayerChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText("History 2/4")).toBeTruthy();
  });

  it("selects, cycles, moves, and edits the same grip without a pointer", () => {
    const onCommit = vi.fn();
    render(
      <EditorHarness
        initialGrips={[
          grip("first", { x: 300, pickX: 100 }),
          grip("second", { x: 800, pickX: 200 }),
        ]}
        initialSelectedGripIndex={null}
        onCommit={onCommit}
      />,
    );
    const canvas = screen.getByRole("application");

    act(() => canvas.focus());
    expect(document.activeElement).toBe(canvas);
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Place X").value).toBe(
      "300",
    );

    fireEvent.keyDown(canvas, { key: "End" });
    expect(screen.getByText("2/2")).toBeTruthy();
    fireEvent.keyDown(canvas, { key: "PageDown" });
    expect(screen.getByText("1/2")).toBeTruthy();
    fireEvent.keyDown(canvas, { key: "End" });

    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(latestCommitted(onCommit)[1]).toMatchObject({
      id: "second",
      x: 801,
      pickX: 201,
    });
    expect(screen.getByLabelText<HTMLInputElement>("Place X").value).toBe(
      "801",
    );
    expect(
      screen.getByText("Grip 2 of 2 selected. Place X 801, Place Y 400."),
    ).toBeTruthy();

    const placeX = screen.getByLabelText("Place X");
    fireEvent.change(placeX, { target: { value: "805" } });
    fireEvent.blur(placeX);
    expect(latestCommitted(onCommit)[1]).toMatchObject({
      id: "second",
      x: 805,
      pickX: 205,
    });
    expect(latestCommitted(onCommit)[0]?.id).toBe("first");
  });

  it("nudges the selected grip with touch-sized inspector controls", () => {
    const onCommit = vi.fn();
    render(
      <EditorHarness
        initialGrips={[grip("nudge", { x: 300, pickX: 100 })]}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Move right 10 millimeters" }),
    );

    expect(latestCommitted(onCommit)[0]).toMatchObject({
      id: "nudge",
      x: 310,
      pickX: 110,
    });
  });

  it("stops keyboard movement at collisions", () => {
    const onCommit = vi.fn();
    render(
      <EditorHarness
        initialGrips={[grip("moving", { x: 300 }), grip("blocker", { x: 500 })]}
        onCommit={onCommit}
      />,
    );
    const canvas = screen.getByRole("application");
    act(() => canvas.focus());

    fireEvent.keyDown(canvas, { key: "ArrowRight" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Boxes cannot overlap. Stopped at the last valid position.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Place X").value).toBe(
      "300",
    );
  });

  it("stops keyboard movement at the pallet support limit", () => {
    const onCommit = vi.fn();
    render(
      <EditorHarness
        initialGrips={[grip("edge", { x: 30 })]}
        onCommit={onCommit}
      />,
    );
    const canvas = screen.getByRole("application");
    act(() => canvas.focus());

    fireEvent.keyDown(canvas, { key: "ArrowLeft" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "At least 65% of every package must rest on the pallet. Stopped at the last valid position.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Place X").value).toBe("30");
  });

  it("selects the nearest surviving grip after deletion", () => {
    const onCommit = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <EditorHarness
        initialGrips={[
          grip("first", { x: 250 }),
          grip("second", { x: 600 }),
          grip("deleted", { x: 950 }),
        ]}
        initialSelectedGripIndex={2}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));

    expect(latestCommitted(onCommit).map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
    expect(screen.getByText("2/2")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Place X").value).toBe(
      "600",
    );
  });

  it("does not intercept editor shortcuts in inspector fields", () => {
    const onCommit = vi.fn();
    render(
      <EditorHarness
        initialGrips={[grip("first", { x: 300 }), grip("second", { x: 800 })]}
        onCommit={onCommit}
      />,
    );
    const placeX = screen.getByLabelText("Place X");
    placeX.focus();

    expect(fireEvent.keyDown(placeX, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(placeX, { key: "PageDown" })).toBe(true);
    expect(fireEvent.keyDown(placeX, { key: "]" })).toBe(true);

    expect(document.activeElement).toBe(placeX);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Place X").value).toBe(
      "300",
    );
  });
});
