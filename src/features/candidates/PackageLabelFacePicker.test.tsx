import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Side } from "~/domain/palletTypes";
import {
  PackageLabelFacePicker,
  type PackageInletOrientation,
} from "~/features/candidates/PackageLabelFacePicker";

afterEach(cleanup);

function ControlledPicker({
  initialOrientation = "lengthwise",
  initialSide = "top",
  packageLengthMm = 400,
  packageWidthMm = 300,
}: {
  initialOrientation?: PackageInletOrientation;
  initialSide?: Side | null;
  packageLengthMm?: number;
  packageWidthMm?: number;
}) {
  const [orientation, setOrientation] =
    useState<PackageInletOrientation>(initialOrientation);
  const [side, setSide] = useState<Side | null>(initialSide);

  return (
    <PackageLabelFacePicker
      packageLengthMm={packageLengthMm}
      packageWidthMm={packageWidthMm}
      inletOrientation={orientation}
      selectedPackageSide={side}
      onInletOrientationChange={setOrientation}
      onPackageSideChange={setSide}
    />
  );
}

describe("PackageLabelFacePicker", () => {
  it("keeps the left-to-right infeed fixed while rotating the selected physical face", () => {
    render(<ControlledPicker />);

    expect(screen.getByRole("radio", { name: "Lengthwise" })).toHaveProperty(
      "checked",
      true,
    );
    expect(
      screen
        .getByRole("button", {
          name: "Select label on displayed top edge",
        })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByLabelText("Infeed direction: left to right")
        .getAttribute("data-infeed-direction"),
    ).toBe("left-to-right");

    fireEvent.click(screen.getByRole("radio", { name: "Crosswise" }));

    expect(
      screen
        .getByRole("button", {
          name: "Select label on displayed left edge",
        })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", {
          name: "Select label on displayed top edge",
        })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen
        .getByLabelText("Infeed direction: left to right")
        .getAttribute("data-infeed-direction"),
    ).toBe("left-to-right");
  });

  it("maps a clicked crosswise display edge back to the physical package face", () => {
    const onPackageSideChange = vi.fn();
    render(
      <PackageLabelFacePicker
        packageLengthMm={400}
        packageWidthMm={300}
        inletOrientation="crosswise"
        selectedPackageSide={null}
        onInletOrientationChange={vi.fn()}
        onPackageSideChange={onPackageSideChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Select label on displayed top edge",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Select label on displayed right edge",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Select label on displayed bottom edge",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Select label on displayed left edge",
      }),
    );

    expect(onPackageSideChange).toHaveBeenCalledTimes(4);
    expect(onPackageSideChange).toHaveBeenNthCalledWith(1, "right");
    expect(onPackageSideChange).toHaveBeenNthCalledWith(2, "bottom");
    expect(onPackageSideChange).toHaveBeenNthCalledWith(3, "left");
    expect(onPackageSideChange).toHaveBeenNthCalledWith(4, "top");
  });

  it("offers an explicit no-label state without a select control", () => {
    render(<ControlledPicker initialSide="right" />);

    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No label" }));

    expect(
      screen
        .getByRole("button", { name: "No label" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("No nearest-edge label preference")).toBeTruthy();
  });

  it("uses native disabled radios and buttons while inputs are locked", () => {
    render(
      <PackageLabelFacePicker
        packageLengthMm={400}
        packageWidthMm={300}
        inletOrientation="lengthwise"
        selectedPackageSide={null}
        disabled
        onInletOrientationChange={vi.fn()}
        onPackageSideChange={vi.fn()}
      />,
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveProperty("disabled", true);
    }
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveProperty("disabled", true);
    }
  });

  it("keeps orientation and face position distinguishable for square packages", () => {
    render(<ControlledPicker packageLengthMm={300} packageWidthMm={300} />);

    fireEvent.click(screen.getByRole("radio", { name: "Crosswise" }));

    expect(screen.getByText("W →")).toBeTruthy();
    expect(screen.getByText("L ↕")).toBeTruthy();
    expect(
      screen
        .getByRole("button", {
          name: "Select label on displayed left edge",
        })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
