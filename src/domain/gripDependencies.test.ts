import { describe, expect, it } from "vitest";
import { insertMergedGripByDeltaDependencies } from "~/domain/gripDependencies";
import type { Grip } from "~/domain/palletTypes";

function grip(id: string, x: number, dx: number): Grip {
  return {
    id,
    pickX: 50,
    pickY: -50,
    pickRotation: 0,
    x,
    y: 100,
    rotation: 0,
    numPackages: 1,
    dx,
    dy: 0,
  };
}

describe("merged grip dependency placement", () => {
  it("inserts a merged grip between its prerequisites and dependents", () => {
    const prerequisite = grip("prerequisite", 50, 0);
    const firstSelected = grip("selected-1", 150, 1);
    const secondSelected = grip("selected-2", 250, 1);
    const dependent = grip("dependent", 350, 1);
    const mergedGrip = {
      ...grip("merged", 200, 1),
      numPackages: 2,
    };

    const result = insertMergedGripByDeltaDependencies(
      [prerequisite, firstSelected, secondSelected, dependent],
      new Set([1, 2]),
      mergedGrip,
      100,
      100,
      0,
    );

    expect(result?.mergedIndex).toBe(1);
    expect(result?.grips.map(({ id }) => id)).toEqual([
      "prerequisite",
      "merged",
      "dependent",
    ]);
  });

  it("rejects selections with fewer than two valid grips", () => {
    const grips = [grip("first", 50, 0), grip("second", 150, 1)];

    expect(
      insertMergedGripByDeltaDependencies(
        grips,
        new Set([0, 99]),
        { ...grip("merged", 100, 0), numPackages: 2 },
        100,
        100,
        0,
      ),
    ).toBeNull();
  });
});
