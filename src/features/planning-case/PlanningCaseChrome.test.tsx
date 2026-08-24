import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { SolverCandidate } from "~/domain/solver";
import {
  PlanningCandidateIndex,
  ValidationLedger,
} from "~/features/planning-case/PlanningCaseChrome";
import { type ValidationLedgerRow } from "~/features/planning-case/planningCaseModel";

afterEach(cleanup);

function candidate(rank: number): SolverCandidate {
  return {
    rank,
    id: `candidate-${rank}`,
    geometryId: `geometry-${rank}`,
    identityFingerprint: `identity-${rank}`,
    geometryFingerprint: `geometry-fingerprint-${rank}`,
    orderDependencies: [],
    placements: [],
    grips: [],
    provenance: [],
    validation: { valid: true, issues: [] },
    metrics: {
      packageCount: rank + 4,
      occupiedAreaMm2: rank * 60_000,
      utilization: rank / 10,
      utilizationPercent: rank * 10,
      boundingBlockLengthMm: rank * 100,
      boundingBlockWidthMm: 200,
      boundingBlockAreaMm2: rank * 20_000,
      provisionalCycleCount: rank,
      provisionalCycleBasis: "generated-grip-groups",
      multiPackBlocks: null,
      multiPackBlocksVerification: "unverified",
    },
    score: {
      value: rank,
      packageCount: rank + 4,
      utilizationMillionths: rank * 100_000,
      provisionalCycleCount: rank,
      boundingBlockAreaMm2: rank * 20_000,
      boundingBlockPerimeterMm: rank * 200,
      multiPackBlocks: null,
    },
  };
}

const candidates = [candidate(1), candidate(2), candidate(3)];

function CandidateIndexHarness({
  initialSelectedCandidateId = candidates[0]!.id,
  maximumRows,
}: {
  initialSelectedCandidateId?: string;
  maximumRows?: number;
} = {}) {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    initialSelectedCandidateId,
  );
  return (
    <>
      <output data-testid="selected-candidate">{selectedCandidateId}</output>
      <PlanningCandidateIndex
        candidates={candidates}
        selectedCandidateId={selectedCandidateId}
        onSelect={setSelectedCandidateId}
        maximumRows={maximumRows}
      />
    </>
  );
}

describe("planning case chrome", () => {
  it("moves from any selected candidate with all arrow keys and clamps at the ends", () => {
    render(<CandidateIndexHarness />);
    const options = screen.getAllByRole("option");
    const selected = screen.getByTestId("selected-candidate");

    expect(options.map((option) => option.tabIndex)).toEqual([0, -1, -1]);

    fireEvent.click(options[0]!);
    expect(selected.textContent).toBe("candidate-1");
    expect(document.activeElement).toBe(options[0]);

    expect(fireEvent.keyDown(options[0]!, { key: "ArrowDown" })).toBe(false);
    expect(selected.textContent).toBe("candidate-2");
    expect(document.activeElement).toBe(options[1]);
    expect(options.map((option) => option.tabIndex)).toEqual([-1, 0, -1]);

    fireEvent.keyDown(options[1]!, { key: "ArrowRight" });
    expect(selected.textContent).toBe("candidate-3");
    expect(document.activeElement).toBe(options[2]);

    fireEvent.keyDown(options[2]!, { key: "ArrowDown" });
    expect(selected.textContent).toBe("candidate-3");

    fireEvent.keyDown(options[2]!, { key: "ArrowLeft" });
    expect(selected.textContent).toBe("candidate-2");
    expect(document.activeElement).toBe(options[1]);

    fireEvent.keyDown(options[1]!, { key: "ArrowUp" });
    expect(selected.textContent).toBe("candidate-1");
    expect(document.activeElement).toBe(options[0]);

    fireEvent.keyDown(options[0]!, { key: "ArrowLeft" });
    expect(selected.textContent).toBe("candidate-1");

    const altArrowWasNotPrevented = fireEvent.keyDown(options[0]!, {
      key: "ArrowRight",
      altKey: true,
    });
    expect(altArrowWasNotPrevented).toBe(true);
    expect(selected.textContent).toBe("candidate-1");
  });

  it("enters on the selected visible row and does not select hidden candidates", () => {
    render(
      <CandidateIndexHarness
        initialSelectedCandidateId="candidate-3"
        maximumRows={2}
      />,
    );
    const options = screen.getAllByRole("option");
    const selected = screen.getByTestId("selected-candidate");

    expect(options).toHaveLength(2);
    expect(
      options.map((option) => option.querySelector("td")?.textContent),
    ).toEqual(["#1", "#3"]);
    expect(options.map((option) => option.tabIndex)).toEqual([-1, 0]);
    expect(options[0]?.getAttribute("aria-posinset")).toBe("1");
    expect(options[1]?.getAttribute("aria-posinset")).toBe("3");
    expect(options[1]?.getAttribute("aria-setsize")).toBe("3");
    expect(
      options.filter(
        (option) => option.getAttribute("aria-selected") === "true",
      ),
    ).toEqual([options[1]]);

    options[1]!.focus();
    fireEvent.keyDown(options[1]!, { key: "ArrowRight" });

    expect(selected.textContent).toBe("candidate-3");
    expect(document.activeElement).toBe(options[1]);
  });

  it("renders claim-specific statuses, evidence classes, and expandable detail", () => {
    const rows: ValidationLedgerRow[] = [
      {
        id: "footprint",
        label: "Footprint recreation",
        status: "PASS",
        evidence: "G",
        claim: "Physical package footprints match exactly.",
        detail: "symmetry=identity\nmaximumDelta=0 mm",
      },
      {
        id: "yaw",
        label: "Directed yaw",
        status: "OBSERVED",
        evidence: "O",
        claim: "Yaw remains observed rather than inferred.",
      },
      {
        id: "export",
        label: "Export readiness",
        status: "BLOCKED",
        evidence: "?",
        claim: "Production mapping requires review.",
      },
    ];

    render(<ValidationLedger rows={rows} />);

    expect(screen.getByText("Footprint recreation")).toBeTruthy();
    expect(screen.getByText("Directed yaw")).toBeTruthy();
    expect(screen.getByText("Export readiness")).toBeTruthy();
    expect(screen.getByText("PASS")).toBeTruthy();
    expect(screen.getByText("OBSERVED")).toBeTruthy();
    expect(screen.getByText("BLOCKED")).toBeTruthy();

    fireEvent.click(screen.getByText("Footprint recreation"));
    expect(screen.getByText(/symmetry=identity/)).toBeTruthy();
  });
});
