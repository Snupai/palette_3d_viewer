import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import { MeasuredPlanField } from "~/features/planning-case/MeasuredPlanField";
import type { PatternComparison } from "~/features/planning-case/planningCaseModel";

const preview: LayerPatternPreview = {
  id: "preview",
  label: "Preview",
  palletBoundsMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
  items: [],
  metadata: {
    source: "solver-candidate",
    sourceId: "candidate",
    rank: 1,
    geometryId: "geometry",
    packageCount: 0,
    cycleCount: 0,
    utilizationPercent: 0,
  },
};

const smallerPreview: LayerPatternPreview = {
  ...preview,
  id: "smaller-preview",
  label: "Smaller preview",
  palletBoundsMm: { minX: 0, minY: 0, maxX: 800, maxY: 600 },
  metadata: {
    source: "solver-candidate",
    sourceId: "smaller-candidate",
    rank: 2,
    geometryId: "smaller-geometry",
    packageCount: 0,
    cycleCount: 0,
    utilizationPercent: 0,
  },
};

const unavailableComparison: PatternComparison = {
  status: "unavailable",
  referenceCount: 0,
  currentCount: 0,
  missingCount: 0,
  extraCount: 0,
  acceptedSymmetry: null,
  maximumAxisDisplacementMm: null,
  toleranceMm: 0.500001,
};

afterEach(cleanup);

describe("MeasuredPlanField", () => {
  it("caps the field wherever the fixed planning grid is used", () => {
    const { container } = render(
      <MeasuredPlanField
        reference={null}
        current={preview}
        comparison={unavailableComparison}
        mode="overlay"
      />,
    );

    const field = container.querySelector(".planning-plan-field");
    const svg = screen.getByRole("img", {
      name: "Reference and Current measured overlay",
    });

    expect(field).not.toBeNull();
    expect(field!.classList.contains("h-full")).toBe(true);
    expect(field!.classList.contains("max-h-[32.5rem]")).toBe(true);
    expect(field!.classList.contains("self-start")).toBe(true);
    expect(svg.classList.contains("min-h-0")).toBe(true);
    expect(svg.getAttribute("viewBox")).toBe("-72 -72 1300.8 923.84");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  });

  it("keeps split drawings readable and on the same physical scale", () => {
    const { container } = render(
      <MeasuredPlanField
        reference={preview}
        current={smallerPreview}
        comparison={unavailableComparison}
        mode="split"
      />,
    );

    const drawings = screen.getAllByRole("img");
    const split = drawings[0]!.parentElement?.parentElement;
    const body = split?.parentElement;

    expect(drawings).toHaveLength(2);
    expect(body?.classList.contains("overflow-auto")).toBe(true);
    expect(split?.classList.contains("min-h-[720px]")).toBe(true);
    expect(split?.classList.contains("2xl:grid-cols-2")).toBe(true);
    for (const drawing of drawings) {
      expect(drawing.classList.contains("min-h-0")).toBe(true);
      expect(drawing.parentElement?.classList.contains("h-[360px]")).toBe(true);
      expect(drawing.getAttribute("viewBox")).toBe("-72 -72 1300.8 923.84");
    }

    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });
});
