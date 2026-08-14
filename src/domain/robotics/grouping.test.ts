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

  it.each([90, 270] as const)(
    "centers the singleton in an odd vertical run at %i degrees",
    (rotation) => {
      const placements = [
        placement("fifth", 4, 50, 450, rotation),
        placement("second", 1, 50, 150, rotation),
        placement("fourth", 3, 50, 350, rotation),
        placement("first", 0, 50, 50, rotation),
        placement("third", 2, 50, 250, rotation),
      ];
      const expected = [
        ["first", "second"],
        ["third"],
        ["fourth", "fifth"],
      ];

      expect(
        groupIds(
          partitionPlacementsForSuction(placements, {
            packageLengthMm: 100,
            maxPackagesPerPick: 2,
          }),
        ),
      ).toEqual(expected);
      expect(
        groupIds(
          partitionPlacementsForSuction([...placements].reverse(), {
            packageLengthMm: 100,
            maxPackagesPerPick: 2,
          }),
        ),
      ).toEqual(expected);
    },
  );

  it("keeps non-centerable and horizontal remainders at the end", () => {
    const horizontal = Array.from({ length: 5 }, (_, index) =>
      placement(`horizontal-${index + 1}`, index, 50 + index * 100, 25),
    );
    const vertical = Array.from({ length: 7 }, (_, index) =>
      placement(`vertical-${index + 1}`, index, 50, 50 + index * 100, 90),
    );

    expect(
      groupIds(
        partitionPlacementsForSuction(horizontal, {
          packageLengthMm: 100,
          maxPackagesPerPick: 2,
        }),
      ).map((group) => group.length),
    ).toEqual([2, 2, 1]);
    expect(
      groupIds(
        partitionPlacementsForSuction(vertical, {
          packageLengthMm: 100,
          maxPackagesPerPick: 2,
        }),
      ).map((group) => group.length),
    ).toEqual([2, 2, 2, 1]);
  });

  it("centers a singleton between larger full vertical groups", () => {
    const placements = Array.from({ length: 7 }, (_, index) =>
      placement(`package-${index + 1}`, index, 50, 50 + index * 100, 90),
    );

    expect(
      groupIds(
        partitionPlacementsForSuction(placements, {
          packageLengthMm: 100,
          maxPackagesPerPick: 3,
        }),
      ),
    ).toEqual([
      ["package-1", "package-2", "package-3"],
      ["package-4"],
      ["package-5", "package-6", "package-7"],
    ]);
  });
});
