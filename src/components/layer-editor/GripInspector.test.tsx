import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GripInspector } from "~/components/layer-editor/GripInspector";
import type { Grip } from "~/domain/palletTypes";
import type { LayerEditorDraft } from "~/hooks/useLayerEditor";

const selectedGrip: Grip = {
  id: "grip-1",
  pickX: 100,
  pickY: -150,
  pickRotation: 0,
  x: 600,
  y: 400,
  rotation: 0,
  numPackages: 1,
  dx: 0,
  dy: 0,
};

const draft: LayerEditorDraft = {
  pickX: "100",
  pickY: "-150",
  pickRotation: "0",
  x: "600",
  y: "400",
  rotation: "0",
  dx: "0",
  dy: "0",
};

afterEach(cleanup);

describe("GripInspector", () => {
  it("routes draft edits, Enter/Escape, and rotation through its boundary", () => {
    const onDraftChange = vi.fn();
    const onDraftCommit = vi.fn();
    const onDraftReset = vi.fn();
    const onRotate = vi.fn();
    const onNudge = vi.fn();

    render(
      <GripInspector
        selectedGripIndex={0}
        gripCount={2}
        selectedGrip={selectedGrip}
        draft={draft}
        message="Editor message"
        onDraftChange={onDraftChange}
        onDraftCommit={onDraftCommit}
        onDraftReset={onDraftReset}
        onRotate={onRotate}
        onNudge={onNudge}
      />,
    );

    const placeX = screen.getByLabelText("Place X");
    fireEvent.change(placeX, { target: { value: "625" } });
    expect(onDraftChange).toHaveBeenCalledWith("x", "625");

    placeX.focus();
    fireEvent.keyDown(placeX, { key: "Enter" });
    expect(onDraftCommit).toHaveBeenCalledWith("x");

    fireEvent.keyDown(placeX, { key: "Escape" });
    expect(onDraftReset).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Rotate 90°" }));
    expect(onRotate).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Move right 10 millimeters" }),
    );
    expect(onNudge).toHaveBeenCalledWith(10, 0);
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Editor message");
  });

  it("disables fields and actions when no grip is selected", () => {
    render(
      <GripInspector
        selectedGripIndex={null}
        gripCount={0}
        selectedGrip={null}
        draft={{
          pickX: "",
          pickY: "",
          pickRotation: "",
          x: "",
          y: "",
          rotation: "",
          dx: "",
          dy: "",
        }}
        message={null}
        onDraftChange={vi.fn()}
        onDraftCommit={vi.fn()}
        onDraftReset={vi.fn()}
        onRotate={vi.fn()}
        onNudge={vi.fn()}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>("Place X").disabled).toBe(
      true,
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Rotate 90°" })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Move right 10 millimeters",
      }).disabled,
    ).toBe(true);
    expect(screen.getByText("none")).toBeTruthy();
  });
});
