import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PlanningWorkflowNav,
  ValidationLedger,
} from "~/features/planning-case/PlanningCaseChrome";
import {
  GENERATION_STAGES,
  type PlanningStage,
  type ValidationLedgerRow,
} from "~/features/planning-case/planningCaseModel";

afterEach(cleanup);

function WorkflowHarness({ initial = "inputs" }: { initial?: PlanningStage }) {
  const [stage, setStage] = useState<PlanningStage>(initial);
  return (
    <PlanningWorkflowNav
      stages={GENERATION_STAGES}
      activeStage={stage}
      onChange={setStage}
    />
  );
}

describe("planning case chrome", () => {
  it("shows the current step and keeps later steps from being clicked", () => {
    render(<WorkflowHarness />);

    expect(
      screen
        .getByRole("button", { name: /01 Inputs/i })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(screen.getByText("1/4")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Generate/i })).toBeNull();
    expect(screen.getByText("Generate")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("lets a completed step be opened again", () => {
    render(<WorkflowHarness initial="generate" />);

    expect(
      screen
        .getByRole("button", { name: /02 Generate/i })
        .getAttribute("aria-current"),
    ).toBe("step");

    fireEvent.click(screen.getByRole("button", { name: /01 Inputs/i }));

    expect(
      screen
        .getByRole("button", { name: /01 Inputs/i })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(screen.queryByRole("button", { name: /Generate/i })).toBeNull();
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
