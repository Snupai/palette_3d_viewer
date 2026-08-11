import { describe, expect, it } from "vitest";
import { partitionPlacementsForSuction } from "~/domain/robotics/grouping";
import type { Rotation } from "~/domain/palletTypes";

function placement(
  id: string,
  sequence: number,
  x: number,
  y: number,
  rotation: Rotation = 0,
) {
  return {
    id,
    sequence,
    positionMm: { x, y },
    rotation,
  };
}

function groupIds(
  groups: ReturnType<typeof partitionPlacementsForSuction>,
): string[][] {
  return groups.map((group) => group.map(({ id }) => id));
}

describe("deterministic suction placement partitioning", () => {
  it("groups adjacent packages into doubles and leaves an odd remainder single", () => {
    const groups = partitionPlacementsForSuction(
      [
        placement("third", 2, 250, 25),
        placement("first", 0, 50, 25),
        placement("second", 1, 150, 25),
      ],
      { packageLengthMm: 100, maxPackagesPerPick: 2 },
    );

    expect(groupIds(groups)).toEqual([["first", "second"], ["third"]]);
  });

  it("keeps gaps and different directed yaws in separate singleton groups", () => {
    const groups = partitionPlacementsForSuction(
      [
        placement("zero", 0, 50, 25, 0),
        placement("gap", 1, 175, 25, 0),
        placement("opposite", 2, 150, 25, 180),
      ],
      { packageLengthMm: 100, maxPackagesPerPick: 2 },
    );

    expect(groupIds(groups)).toEqual([["zero"], ["gap"], ["opposite"]]);
  });

  it("uses the package local-length axis for crosswise placements", () => {
    const groups = partitionPlacementsForSuction(
      [
        placement("crosswise-b", 1, 50, 150, 90),
        placement("other-column", 2, 150, 150, 90),
        placement("crosswise-a", 0, 50, 50, 90),
      ],
      { packageLengthMm: 100, maxPackagesPerPick: 2 },
    );

    expect(groupIds(groups)).toEqual([
      ["crosswise-a", "crosswise-b"],
      ["other-column"],
    ]);
  });
});
