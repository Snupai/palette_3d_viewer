import { describe, expect, it } from "vitest";
import {
  countLabel,
  describeDiagnostic,
  gripLabel,
  packageLabel,
} from "~/features/editor/editorLabels";
import type { ProjectEditorGroup } from "~/features/editor/editorModel";

const pattern = {
  placements: [
    { id: "a", sequence: 0 },
    { id: "b", sequence: 1 },
  ],
};

const groups: ProjectEditorGroup[] = [
  {
    id: "g-second",
    groupNumber: 2,
    placementIds: ["b"],
    centerMm: { x: 0, y: 0 },
    rotation: 0,
    persisted: true,
    orderIndex: 1,
  },
  {
    id: "g-first",
    groupNumber: 1,
    placementIds: ["a"],
    centerMm: { x: 0, y: 0 },
    rotation: 0,
    persisted: true,
    orderIndex: 0,
  },
];

describe("editor labels", () => {
  it("names packages by sequence and grips by execution order", () => {
    expect(packageLabel(pattern, "b")).toBe("#2");
    expect(packageLabel(pattern, "missing")).toBe("missing");
    expect(gripLabel(groups, "g-second")).toBe("G2");
    expect(countLabel(1, "Griff", "Griffe")).toBe("1 Griff");
    expect(countLabel(3, "Griff", "Griffe")).toBe("3 Griffe");
  });

  it("describes model diagnostics in German with labels instead of ids", () => {
    expect(
      describeDiagnostic(
        {
          severity: "error",
          code: "placement-overlap",
          message: 'Packages "a" and "b" overlap or violate clearance.',
          placementIds: ["a", "b"],
        },
        pattern,
        groups,
      ),
    ).toBe(
      "Pakete #1 und #2 überlappen sich oder unterschreiten den Paketabstand.",
    );
    expect(
      describeDiagnostic(
        {
          severity: "warning",
          code: "placement-unassigned",
          message: 'Package "b" is not assigned to a grip group.',
          placementIds: ["b"],
        },
        pattern,
        groups,
      ),
    ).toBe("Paket #2 gehört zu keinem Griff.");
    expect(
      describeDiagnostic(
        {
          severity: "error",
          code: "invalid-group-geometry",
          message:
            "Group 2: Grouped packages must be aligned on one cross axis.",
          gripIds: ["g-second"],
        },
        pattern,
        groups,
      ),
    ).toBe("Griff G2: Grouped packages must be aligned on one cross axis.");
    expect(
      describeDiagnostic(
        {
          severity: "error",
          code: "group-order-omission",
          message:
            "Execution order must contain every grip group exactly once.",
        },
        pattern,
        groups,
      ),
    ).toBe("Die Reihenfolge muss jeden Griff genau einmal enthalten.");
  });
});
