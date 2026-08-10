import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  migrateProject,
  projectToProjectV2,
  safeMigrateProject,
} from "~/domain/project/projectMigration";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
  projectSchema,
} from "~/domain/project/projectSchema";
import { savedPalletToProjectV2 } from "~/lib/projectAdapters";
import type { SavedPallet } from "~/lib/palletTypes";
import { parseRobText } from "~/lib/robParser";

const rawText = readFileSync(
  resolve(
    process.cwd(),
    "src",
    "lib",
    "__fixtures__",
    "anonymized-plan-lf.rob",
  ),
  "utf8",
);

function projectV2() {
  const entry: SavedPallet = {
    schemaVersion: 1,
    id: "legacy-plan",
    name: "legacy.rob",
    createdAt: 123,
    data: parseRobText(rawText),
    rawText,
    originalRawText: rawText,
  };
  return savedPalletToProjectV2(entry);
}

describe("project schema migration", () => {
  it("deterministically adds package placements and robot cycles to ProjectV2", () => {
    const first = migrateProject(projectV2());
    const second = migrateProject(projectV2());

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(
      first.solutions[0]?.patterns.map(({ placements }) => placements.length),
    ).toEqual([1, 3]);
    expect(first.solutions[0]?.robotCycles).toHaveLength(3);
    expect(first.solutions[0]?.robotCycles[1]).toMatchObject({
      patternId: "imported-pattern-2",
      gripId: "imported-grip-2-1",
      placementIds: ["placement-2-1", "placement-2-2"],
    });
  });

  it("assigns missing grip group numbers from unused positive integers", () => {
    const mixed = projectV2();
    const grips = mixed.solutions[0]!.patterns[1]!.grips;
    expect(grips).toHaveLength(2);
    grips[0]!.groupNumber = undefined;
    grips[1]!.groupNumber = 1;

    const first = migrateProject(mixed);
    const second = migrateProject(structuredClone(mixed));
    const migratedNumbers = first.solutions[0]!.patterns[1]!.grips.map(
      ({ groupNumber }) => groupNumber,
    );

    expect(first).toEqual(second);
    expect(migratedNumbers).toEqual([2, 1]);
    expect(new Set(migratedNumbers).size).toBe(migratedNumbers.length);
  });

  it("projects the current model back to the exact V2 compatibility shape", () => {
    const current = migrateProject(projectV2());
    const compatibility = projectToProjectV2(current);

    expect(compatibility).toEqual(projectV2());
    expect(compatibility.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect("placements" in compatibility.solutions[0]!.patterns[0]!).toBe(
      false,
    );
    expect("robotCycles" in compatibility.solutions[0]!).toBe(false);
  });

  it("validates placement, grip, stack, cycle, and gripper references", () => {
    const project = migrateProject(projectV2());
    const broken = structuredClone(project);
    broken.solutions[0]!.patterns[0]!.placements[0]!.gripId = "missing-grip";
    broken.solutions[0]!.stack.layers[0]!.patternId = "missing-pattern";
    broken.solutions[0]!.robotCycles[0]!.placementIds = ["missing-placement"];
    broken.solutions[0]!.robotCycles[0]!.gripperId = "missing-gripper";

    const result = projectSchema.safeParse(broken);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        "references a missing grip",
        "references a missing layer pattern",
        "references a missing placement in the cycle pattern",
        "references a missing project gripper",
      ]),
    );
  });

  it("rejects unknown versions without guessing their shape", () => {
    const result = safeMigrateProject({
      ...projectV2(),
      schemaVersion: 999,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "unsupported-project-version",
        path: ["schemaVersion"],
        schemaVersion: 999,
      }),
    ]);
  });
});
