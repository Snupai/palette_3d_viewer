import { describe, expect, it } from "vitest";
import {
  PLACE_APPROACH_CLEARANCE_MM,
  PLACE_APPROACH_OFFSET_MM,
  placeApproachDirection,
  placeApproachPosition,
} from "~/domain/placeApproach";
import { createRobotCycleMotionRoute } from "~/domain/robotics/motionRoute";
import type { RobotPose } from "~/domain/robotics/types";

function pose(x: number, y: number, z: number, yawDeg = 0): RobotPose {
  return { frame: "pallet", positionMm: { x, y, z }, yawDeg };
}

describe(".rob fields 8/9 place pre-position", () => {
  it("uses one 80 mm offset and a provisional 10 mm clearance", () => {
    expect(PLACE_APPROACH_OFFSET_MM).toBe(80);
    expect(PLACE_APPROACH_CLEARANCE_MM).toBe(10);
  });

  it("offsets the final position by (dx, dy) · 80 mm and raises it by package height + 10 mm", () => {
    const final = { x: 500, y: 300, z: 420 };
    expect(
      placeApproachPosition(final, placeApproachDirection(1, 0), 200),
    ).toEqual({ x: 580, y: 300, z: 630 });
    expect(
      placeApproachPosition(final, placeApproachDirection(0, -1), 200),
    ).toEqual({ x: 500, y: 220, z: 630 });
    expect(
      placeApproachPosition(final, placeApproachDirection(-1, 1), 150),
    ).toEqual({ x: 420, y: 380, z: 580 });
    expect(
      placeApproachPosition(final, placeApproachDirection(0, 0), 200),
    ).toBeNull();
  });

  it("keeps only the sign of out-of-range field values", () => {
    expect(placeApproachDirection(7, -9)).toEqual({ dx: 1, dy: -1 });
    expect(placeApproachDirection(0, 14)).toEqual({ dx: 0, dy: 1 });
  });

  it("honours explicit offset and clearance settings", () => {
    expect(
      placeApproachPosition({ x: 500, y: 300, z: 0 }, { dx: 1, dy: 1 }, 100, {
        offsetMm: 30,
        clearanceMm: 5,
      }),
    ).toEqual({ x: 530, y: 330, z: 105 });
  });
});

describe("carried route with a place pre-position", () => {
  const pick = pose(-1_000, 0, 200);
  const transfer = pose(-250, 150, 600, 90);
  const place = pose(500, 300, 420, 180);

  it("keeps the vertical place for 0 0", () => {
    const route = createRobotCycleMotionRoute({
      pickPose: pick,
      transferPose: transfer,
      placePose: place,
      placeApproachPose: null,
    });
    expect(route.waypoints.map(({ name }) => name)).toEqual([
      "pick",
      "pick-lift",
      "transfer",
      "place-approach",
      "place",
    ]);
    expect(route.segments.map(({ kind }) => kind)).toEqual([
      "pick-lift",
      "pick-traverse",
      "transfer-traverse",
      "place-approach",
    ]);
    expect(route.waypoints[3]?.pose.positionMm).toEqual({
      x: 500,
      y: 300,
      z: 600,
    });
  });

  it("lowers onto the pre-position and slides diagonally into the place", () => {
    const route = createRobotCycleMotionRoute({
      pickPose: pick,
      transferPose: pose(-250, 150, 800, 90),
      placePose: place,
      placeApproachPose: pose(580, 300, 630, 180),
    });
    expect(route.waypoints.map(({ name }) => name)).toEqual([
      "pick",
      "pick-lift",
      "transfer",
      "place-approach-above",
      "place-approach",
      "place",
    ]);
    expect(
      route.segments.map(({ kind, from, to }) => [
        kind,
        from.pose.positionMm,
        to.pose.positionMm,
      ]),
    ).toEqual([
      ["pick-lift", { x: -1_000, y: 0, z: 200 }, { x: -1_000, y: 0, z: 800 }],
      [
        "pick-traverse",
        { x: -1_000, y: 0, z: 800 },
        { x: -250, y: 150, z: 800 },
      ],
      [
        "transfer-traverse",
        { x: -250, y: 150, z: 800 },
        { x: 580, y: 300, z: 800 },
      ],
      [
        "place-approach",
        { x: 580, y: 300, z: 800 },
        { x: 580, y: 300, z: 630 },
      ],
      ["place-slide", { x: 580, y: 300, z: 630 }, { x: 500, y: 300, z: 420 }],
    ]);
  });

  it("raises the traverse to the pre-position when it is the highest point", () => {
    const route = createRobotCycleMotionRoute({
      pickPose: pick,
      transferPose: transfer,
      placePose: place,
      placeApproachPose: pose(500, 220, 630, 180),
    });
    expect(
      route.segments.map(({ kind, from, to }) => [
        kind,
        from.pose.positionMm,
        to.pose.positionMm,
      ]),
    ).toEqual([
      ["pick-lift", { x: -1_000, y: 0, z: 200 }, { x: -1_000, y: 0, z: 630 }],
      [
        "pick-traverse",
        { x: -1_000, y: 0, z: 630 },
        { x: -250, y: 150, z: 630 },
      ],
      [
        "place-approach",
        { x: -250, y: 150, z: 630 },
        { x: 500, y: 220, z: 630 },
      ],
      ["place-slide", { x: 500, y: 220, z: 630 }, { x: 500, y: 300, z: 420 }],
    ]);
  });

  it("rejects a pre-position in another frame", () => {
    expect(() =>
      createRobotCycleMotionRoute({
        pickPose: pick,
        transferPose: transfer,
        placePose: place,
        placeApproachPose: { ...pose(580, 300, 630), frame: "station" },
      }),
    ).toThrow(/one coordinate frame/);
  });
});
