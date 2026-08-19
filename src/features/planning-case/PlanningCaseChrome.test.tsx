import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ValidationLedger } from "~/features/planning-case/PlanningCaseChrome";
import { type ValidationLedgerRow } from "~/features/planning-case/planningCaseModel";

afterEach(cleanup);

describe("planning case chrome", () => {
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
