import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerSlider } from "./LayerSlider";

/** Ticks are listed top (highest layer) to bottom, 12px apart. */
function placeTicks() {
  screen.getAllByRole("button").forEach((tick, index) => {
    tick.getBoundingClientRect = () =>
      ({ top: index * 12, height: 6 }) as DOMRect;
  });
}

/** jsdom has no PointerEvent, so carry pointerType on a MouseEvent. */
function pointer(
  target: Element,
  type: string,
  pointerType: string,
  clientY: number,
) {
  const event = new MouseEvent(type, { bubbles: true, clientY });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(target, event);
}

afterEach(cleanup);

describe("LayerSlider", () => {
  it("scrubs to the tick under a dragging finger", () => {
    const onChange = vi.fn();
    render(<LayerSlider layerCount={4} value={4} onChange={onChange} />);
    placeTicks();
    const rail = screen.getByRole("button", { name: "Lage 4" }).parentElement!
      .parentElement!;

    pointer(rail, "pointerdown", "touch", 3);
    pointer(rail, "pointermove", "touch", 26);
    pointer(rail, "pointerup", "touch", 26);
    pointer(rail, "pointermove", "touch", 39);

    expect(onChange.mock.calls).toEqual([[4], [2]]);
  });

  it("leaves mouse input to the tick buttons", () => {
    const onChange = vi.fn();
    render(<LayerSlider layerCount={4} value={4} onChange={onChange} />);
    placeTicks();
    const rail = screen.getByRole("button", { name: "Lage 4" }).parentElement!
      .parentElement!;

    pointer(rail, "pointerdown", "mouse", 39);
    pointer(rail, "pointermove", "mouse", 39);

    expect(onChange).not.toHaveBeenCalled();
  });
});
