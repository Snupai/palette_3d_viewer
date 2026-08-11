import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LayerPattern } from "~/components/LayerPattern";
import type { PalletData } from "~/domain/palletTypes";
import type { SolverCandidate } from "~/domain/solver/types";
import {
  palletLayerToPatternPreview,
  solverCandidateToPatternPreview,
} from "~/lib/previewAdapters";

afterEach(cleanup);

function palletData(): PalletData {
  return {
    layers: [
      {
        unique_layer_id: 1,
        zwischenlage: 0,
        boxes: [
          {
            blueNumber: 1,
            blueLine: "top",
            rotation: 0,
            rect: { width: 200, length: 300, x: 200, y: 150 },
            height: 100,
            placeX: 200,
            placeY: 150,
            numPackages: 1,
          },
        ],
      },
    ],
    uniqueLayers: {},
    layer_count: 1,
    total_boxes: 1,
    package: { width: 200, length: 300, height: 100 },
    pallet: { width: 1_000, length: 700, height: 120 },
    planner: {
      projectId: "project-1",
      solutionId: "solution-1",
      layers: [
        {
          id: "physical-layer-1",
          label: "Top pattern",
          patternRef: "pattern-1",
          candidateId: "candidate-1",
          isSpecialTop: true,
        },
      ],
      metrics: {
        packageCount: 1,
        cycleCount: 1,
        loadStackHeightMm: 100,
        areaUtilizationPercent: 8.57,
        volumeUtilizationPercent: 8.57,
        grossWeightKg: null,
      },
      warningCodes: [],
    },
    inputDirection: 0,
  };
}

function candidate(): SolverCandidate {
  return {
    rank: 3,
    id: "candidate-3",
    geometryId: "geometry-3",
    identityFingerprint: "identity",
    geometryFingerprint: "geometry",
    placements: [
      {
        sequence: 0,
        positionMm: { x: -100, y: 50 },
        rotation: 90,
        labelSide: null,
        gripId: "generated-grip:1",
      },
    ],
    grips: [
      {
        id: "generated-grip:1",
        groupNumber: 1,
        sequence: 0,
        pickX: 0,
        pickY: 0,
        pickRotation: 0,
        x: -100,
        y: 50,
        rotation: 90,
        numPackages: 1,
        dx: 0,
        dy: 0,
      },
    ],
    provenance: [],
    validation: { valid: true, issues: [] },
    metrics: {
      packageCount: 1,
      occupiedAreaMm2: 60_000,
      utilization: 0.1,
      utilizationPercent: 10,
      boundingBlockLengthMm: 200,
      boundingBlockWidthMm: 300,
      boundingBlockAreaMm2: 60_000,
      provisionalCycleCount: 1,
      provisionalCycleBasis: "generated-grip-groups",
      multiPackBlocks: null,
      multiPackBlocksVerification: "unverified",
    },
    score: {
      value: 1,
      packageCount: 1,
      utilizationMillionths: 100_000,
      provisionalCycleCount: 1,
      boundingBlockAreaMm2: 60_000,
      boundingBlockPerimeterMm: 1_000,
      multiPackBlocks: null,
    },
  };
}

describe("LayerPattern", () => {
  it("renders the same read-only SVG data at thumbnail or report sizes", () => {
    const preview = palletLayerToPatternPreview(palletData(), 0);
    const { container, rerender } = render(
      <LayerPattern preview={preview} className="h-24 w-32" />,
    );

    const svg = screen.getByRole("img", { name: "Top pattern" });
    const firstGeometry = container.querySelector(
      "[data-pattern-item]",
    )?.innerHTML;
    expect(svg.getAttribute("viewBox")).toBe("0 0 1000 700");
    expect(svg.getAttribute("data-layer-pattern-id")).toBe("physical-layer-1");
    expect(screen.getByText("G1")).toBeTruthy();
    expect(container.querySelector("path")?.getAttribute("stroke")).toBe(
      "#38bdf8",
    );

    rerender(
      <LayerPattern preview={preview} className="h-[700px] w-[1000px]" />,
    );
    expect(container.querySelector("[data-pattern-item]")?.innerHTML).toBe(
      firstGeometry,
    );
    expect(container.querySelector("svg")?.onclick).toBeNull();
  });

  it("adapts solver coordinates, exact yaw, and outward label side without editor or stack state", () => {
    const source = candidate();
    const labeledCandidate: SolverCandidate = {
      ...source,
      placements: source.placements.map((placement) => ({
        ...placement,
        labelSide: "left",
      })),
    };
    const preview = solverCandidateToPatternPreview(labeledCandidate, {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 300, width: 200 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: -600, minY: -400, maxX: 600, maxY: 400 },
    });

    render(<LayerPattern preview={preview} showGrid={false} />);

    const svg = screen.getByRole("img", { name: "Candidate 3" });
    const item = document.querySelector("[data-pattern-item]");
    const box = item?.querySelector("rect");
    expect(svg.getAttribute("viewBox")).toBe("-600 -400 1200 800");
    expect(box?.getAttribute("width")).toBe("200");
    expect(box?.getAttribute("height")).toBe("300");
    expect(preview.items[0]?.centerMm).toEqual({ x: -100, y: 50 });
    expect(preview.items[0]?.rotation).toBe(90);
    expect(preview.items[0]?.labelSide).toBe("left");
    expect(item?.querySelector("path")?.getAttribute("stroke")).toBe("#38bdf8");
    expect(preview.palletBoundsMm).toEqual({
      minX: -600,
      minY: -400,
      maxX: 600,
      maxY: 400,
    });
    expect(preview.metadata).toMatchObject({
      source: "solver-candidate",
      sourceId: "candidate-3",
      rank: 3,
    });
  });

  it("shows physical, authorized, and requested frames without clipping overhang", () => {
    const preview = solverCandidateToPatternPreview(
      candidate(),
      {
        package: {
          shape: "cuboid",
          dimensionsMm: { length: 300, width: 200 },
          clearanceMm: 0,
        },
        envelopeMm: { minX: -20, minY: -10, maxX: 420, maxY: 310 },
        generationBoundsMm: {
          minX: -20,
          minY: -10,
          maxX: 420,
          maxY: 310,
        },
      },
      {
        physicalPalletBoundsMm: {
          minX: 0,
          minY: 0,
          maxX: 400,
          maxY: 300,
        },
      },
    );

    const { container } = render(
      <LayerPattern preview={preview} showGrid={false} />,
    );

    expect(screen.getByRole("img").getAttribute("viewBox")).toBe(
      "-200 -100 620 410",
    );
    expect(
      container.querySelector('[data-pattern-frame="physical-pallet"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-pattern-frame="effective-envelope"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-pattern-frame="generation-envelope"]'),
    ).toBeTruthy();
    expect(preview.palletBoundsMm).toEqual({
      minX: 0,
      minY: 0,
      maxX: 400,
      maxY: 300,
    });
  });
});
