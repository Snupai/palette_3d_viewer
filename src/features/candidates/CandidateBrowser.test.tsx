import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import { CandidateBrowser } from "~/features/candidates/CandidateBrowser";

afterEach(cleanup);

const solverInput: LayerSolverInput = {
  package: {
    shape: "cuboid",
    dimensionsMm: { length: 300, width: 200 },
    clearanceMm: 0,
  },
  envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
};

function candidate(rank: number, packageCount: number): SolverCandidate {
  return {
    rank,
    id: `candidate-${rank}`,
    geometryId: `geometry-${rank}`,
    identityFingerprint: `identity-${rank}`,
    geometryFingerprint: `geometry-fingerprint-${rank}`,
    orderDependencies: [],
    placements: Array.from({ length: packageCount }, (_, index) => ({
      sequence: index,
      positionMm: { x: 150 + index * 10, y: 100 },
      rotation: 0 as const,
      labelSide: null,
      gripId: `generated-grip:${index + 1}`,
    })),
    grips: Array.from({ length: packageCount }, (_, index) => ({
      id: `generated-grip:${index + 1}`,
      groupNumber: index + 1,
      sequence: index,
      pickX: 0,
      pickY: 0,
      pickRotation: 0 as const,
      x: 150 + index * 10,
      y: 100,
      rotation: 0 as const,
      numPackages: 1,
      dx: 0,
      dy: 0,
    })),
    provenance: [],
    validation: { valid: true, issues: [] },
    metrics: {
      packageCount,
      occupiedAreaMm2: packageCount * 60_000,
      utilization: packageCount / 20,
      utilizationPercent: packageCount * 5,
      boundingBlockLengthMm: packageCount * 100,
      boundingBlockWidthMm: 200,
      boundingBlockAreaMm2: packageCount * 20_000,
      provisionalCycleCount: packageCount,
      provisionalCycleBasis: "generated-grip-groups",
      multiPackBlocks: null,
      multiPackBlocksVerification: "unverified",
    },
    score: {
      value: packageCount,
      packageCount,
      utilizationMillionths: packageCount * 50_000,
      provisionalCycleCount: packageCount,
      boundingBlockAreaMm2: packageCount * 20_000,
      boundingBlockPerimeterMm: packageCount * 200,
      multiPackBlocks: null,
    },
  };
}

const candidates = [candidate(1, 5), candidate(2, 6), candidate(3, 5)];

function Harness() {
  const [selected, setSelected] = useState<string | null>(candidates[0]!.id);
  return (
    <>
      <output data-testid="selected">{selected}</output>
      <CandidateBrowser
        candidates={candidates}
        solverInput={solverInput}
        selectedCandidateId={selected}
        onSelectionChange={setSelected}
      />
    </>
  );
}

describe("CandidateBrowser", () => {
  it("navigates the filtered listbox with arrows, Home, End, and pointer selection", () => {
    render(<Harness />);
    const listbox = screen.getByRole("listbox", { name: "Solver candidates" });
    listbox.focus();

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(screen.getByTestId("selected").textContent).toBe("candidate-2");

    fireEvent.keyDown(listbox, { key: "End" });
    expect(screen.getByTestId("selected").textContent).toBe("candidate-3");

    fireEvent.keyDown(listbox, { key: "Home" });
    expect(screen.getByTestId("selected").textContent).toBe("candidate-1");

    fireEvent.click(screen.getAllByRole("option")[2]!);
    expect(screen.getByTestId("selected").textContent).toBe("candidate-3");
  });

  it("applies exact and Maximum filters, reports x of y, and resets without losing candidates", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Exact package count"), {
      target: { value: "5" },
    });
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.click(screen.getByRole("checkbox", { name: "Maximum (6)" }));
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByTestId("selected").textContent).toBe("candidate-2");

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
});
