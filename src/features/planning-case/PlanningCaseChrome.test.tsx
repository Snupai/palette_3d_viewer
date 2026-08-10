import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PlanningWorkflowNav,
  ValidationLedger,
} from "~/features/planning-case/PlanningCaseChrome";
import type {
  PlanningStage,
  ValidationLedgerRow,
} from "~/features/planning-case/planningCaseModel";

afterEach(cleanup);

function WorkflowHarness() {
  const [stage, setStage] = useState<PlanningStage>("inputs");
  return <PlanningWorkflowNav activeStage={stage} onChange={setStage} />;
}

describe("planning case chrome", () => {
  it("exposes the six ordered workflow stages and updates aria-current", () => {
    render(<WorkflowHarness />);

    expect(
      screen
        .getByRole("button", { name: /01 Inputs/i })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(screen.getAllByRole("button")).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: /04 Compare/i }));

    expect(
      screen
        .getByRole("button", { name: /04 Compare/i })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(
      screen
        .getByRole("button", { name: /01 Inputs/i })
        .getAttribute("aria-current"),
    ).toBeNull();
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
