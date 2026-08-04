import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LayerCanvas,
  type LayerCanvasProps,
} from "~/components/layer-editor/LayerCanvas";
import type { Grip } from "~/domain/palletTypes";

const grip: Grip = {
  id: "grip-1",
  pickX: 100,
  pickY: -150,
  pickRotation: 0,
  x: 400,
  y: 300,
  rotation: 0,
  numPackages: 1,
  dx: 20,
  dy: 0,
};

function props(overrides?: Partial<LayerCanvasProps>): LayerCanvasProps {
  return {
    uniqueLayerId: 7,
    grips: [grip],
    packageWidth: 200,
    packageLength: 300,
    inputDirection: 0,
    palletWidth: 1200,
    palletLength: 800,
    selectedGripIndex: 0,
    mergeSelection: new Set([0]),
    onClearSelection: vi.fn(),
    onGripKeyboardSelect: vi.fn(),
    onSelectedGripMove: vi.fn(),
    onGripPointerStart: vi.fn(() => true),
    onGripPointerMove: vi.fn(),
    onGripPointerEnd: vi.fn(),
    onGripPointerCancel: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

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

describe("LayerCanvas", () => {
  it("converts pointer coordinates and owns pointer capture interactions", () => {
    const onGripPointerStart = vi.fn(() => true);
    const onGripPointerMove = vi.fn();
    const onGripPointerEnd = vi.fn();
    const canvasProps = props({
      onGripPointerStart,
      onGripPointerMove,
      onGripPointerEnd,
    });
    const { container } = render(<LayerCanvas {...canvasProps} />);
    const svg = screen.getByRole("application") as unknown as SVGSVGElement;
    const rect = container.querySelector<SVGRectElement>("rect.cursor-grab")!;
    mockSvgPointerGeometry(svg, rect);

    firePointerEvent(rect, "pointerdown", {
      pointerId: 4,
      clientX: 400,
      clientY: 500,
    });
    expect(onGripPointerStart).toHaveBeenCalledWith(
      0,
      { x: 400, y: 300 },
      false,
    );

    firePointerEvent(rect, "pointermove", {
      pointerId: 4,
      clientX: 450,
      clientY: 450,
    });
    expect(onGripPointerMove).toHaveBeenCalledWith({ x: 450, y: 350 });

    firePointerEvent(rect, "pointerup", {
      pointerId: 4,
      clientX: 450,
      clientY: 450,
    });
    expect(onGripPointerEnd).toHaveBeenCalledWith({ x: 450, y: 350 });
  });

  it("keeps shift-selection and pallet-background clearing separate from drag", () => {
    const onClearSelection = vi.fn();
    const onGripPointerStart = vi.fn(() => false);
    const canvasProps = props({ onClearSelection, onGripPointerStart });
    const { container } = render(<LayerCanvas {...canvasProps} />);
    const svg = screen.getByRole("application") as unknown as SVGSVGElement;
    const rect = container.querySelector<SVGRectElement>("rect.cursor-grab")!;

    firePointerEvent(rect, "pointerdown", {
      pointerId: 2,
      shiftKey: true,
    });
    expect(onGripPointerStart).toHaveBeenCalledWith(0, null, true);

    firePointerEvent(svg, "pointerdown");
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("exposes strong focus state, instructions, cycling, and one-unit movement", () => {
    const onGripKeyboardSelect = vi.fn();
    const onSelectedGripMove = vi.fn();
    render(
      <LayerCanvas
        {...props({
          grips: [
            { ...grip, id: "grip-1" },
            { ...grip, id: "grip-2", x: 700 },
            { ...grip, id: "grip-3", x: 1000 },
          ],
          selectedGripIndex: 1,
          onGripKeyboardSelect,
          onSelectedGripMove,
        })}
      />,
    );
    const svg = screen.getByRole("application") as unknown as SVGSVGElement;

    svg.focus();
    expect(document.activeElement).toBe(svg);
    expect(svg.tabIndex).toBe(0);
    expect(svg.getAttribute("class")).toContain("focus-visible:outline-2");
    expect(svg.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
    expect(
      screen.getByText(/Keyboard controls: Tab to focus the canvas/)
        .textContent,
    ).toContain("Arrow keys move the selected grip one millimeter");
    expect(
      screen.getByText("Grip 2 of 3 selected. Place X 700, Place Y 300."),
    ).toBeTruthy();

    fireEvent.keyDown(svg, { key: "Home" });
    fireEvent.keyDown(svg, { key: "End" });
    fireEvent.keyDown(svg, { key: "PageUp" });
    fireEvent.keyDown(svg, { key: "PageDown" });
    fireEvent.keyDown(svg, { key: "[" });
    fireEvent.keyDown(svg, { key: "]" });
    expect(onGripKeyboardSelect.mock.calls).toEqual([
      [0],
      [2],
      [0],
      [2],
      [0],
      [2],
    ]);

    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "ArrowUp" });
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(onSelectedGripMove.mock.calls).toEqual([
      [-1, 0],
      [1, 0],
      [0, 1],
      [0, -1],
    ]);
  });

  it("keeps canvas focus and selects a deterministic grip on layer changes", () => {
    const onGripKeyboardSelect = vi.fn();
    const { rerender } = render(
      <LayerCanvas
        {...props({
          uniqueLayerId: 1,
          selectedGripIndex: 0,
          onGripKeyboardSelect,
        })}
      />,
    );
    const svg = screen.getByRole("application") as unknown as SVGSVGElement;
    svg.focus();
    onGripKeyboardSelect.mockClear();

    rerender(
      <LayerCanvas
        {...props({
          uniqueLayerId: 2,
          grips: [{ ...grip, id: "layer-2-grip", x: 500 }],
          selectedGripIndex: null,
          onGripKeyboardSelect,
        })}
      />,
    );

    expect(document.activeElement).toBe(svg);
    expect(onGripKeyboardSelect).toHaveBeenCalledWith(0);
    expect(svg.getAttribute("aria-label")).toContain("unique layer 2");
  });
});
