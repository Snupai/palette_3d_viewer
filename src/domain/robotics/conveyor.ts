import type { Project } from "~/domain/project/projectSchema";
import { rotateVector2 } from "~/domain/robotics/frames";
import type {
  RobotConveyorModel,
  RobotCycle,
  RobotObstacle,
  Vector3Mm,
} from "~/domain/robotics/types";
import type { MaterializedPackageLayer } from "~/domain/stack/types";

export const CALCULATED_CONVEYOR_DIMENSIONS_MM = {
  length: 1_200,
  width: 500,
  height: 140,
} as const;

export const CALCULATED_CONVEYOR_OBSTACLE_ID = "calculated-feed-conveyor-bed";

export type CalculatedRobotConveyorInput = {
  projectSourceKind: Project["source"]["kind"];
  inletOrientation: Project["package"]["inletOrientation"];
  gripperTcpMm: Vector3Mm;
  cycles: readonly RobotCycle[];
  stack: {
    packageLayers: readonly Pick<
      MaterializedPackageLayer,
      "id" | "zBottomMm"
    >[];
  };
};

/**
 * Derives a feed bed only for ordinary calculated station-frame cycles. Imported
 * files do not establish conveyor geometry and therefore return no model.
 */
export function createCalculatedRobotConveyorModel(
  input: CalculatedRobotConveyorInput,
): RobotConveyorModel | null {
  if (
    input.projectSourceKind !== "new" ||
    input.cycles.length === 0 ||
    input.cycles.some(
      (cycle) =>
        cycle.provenance.cycleSource !== "calculated-suction-cycle" ||
        cycle.pickPose.frame !== "station" ||
        cycle.transferPose.frame !== "station" ||
        cycle.placePose.frame !== "station",
    )
  ) {
    return null;
  }

  const firstCycle = input.cycles[0]!;
  const layer = input.stack.packageLayers.find(
    ({ id }) => id === firstCycle.physicalLayerId,
  );
  if (!layer) return null;

  const cycleGeometryIsFinite = input.cycles.every((cycle) =>
    [cycle.pickPose, cycle.transferPose, cycle.placePose].every((pose) =>
      [
        pose.positionMm.x,
        pose.positionMm.y,
        pose.positionMm.z,
        pose.yawDeg,
      ].every(Number.isFinite),
    ),
  );
  if (
    !cycleGeometryIsFinite ||
    [
      input.gripperTcpMm.x,
      input.gripperTcpMm.y,
      input.gripperTcpMm.z,
      layer.zBottomMm,
    ].some((value) => !Number.isFinite(value))
  ) {
    return null;
  }

  const tcpOffset = rotateVector2(
    { x: input.gripperTcpMm.x, y: input.gripperTcpMm.y },
    firstCycle.pickPose.yawDeg,
  );
  const conveyorTopZ =
    firstCycle.pickPose.positionMm.z +
    layer.zBottomMm -
    firstCycle.placePose.positionMm.z;
  const centerMm = {
    x: firstCycle.pickPose.positionMm.x + tcpOffset.x,
    y: firstCycle.pickPose.positionMm.y + tcpOffset.y,
    z: conveyorTopZ - CALCULATED_CONVEYOR_DIMENSIONS_MM.height / 2,
  };
  if (Object.values(centerMm).some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    id: "calculated-feed-conveyor",
    frame: "station",
    centerMm,
    dimensionsMm: { ...CALCULATED_CONVEYOR_DIMENSIONS_MM },
    travelAxis: input.inletOrientation === "lengthwise" ? "x" : "y",
    provenance: {
      status: "derived",
      source: "calculated-cycle-feed-reference-v1",
      detail:
        "Feed bed visualization and conservative obstacle derived from calculated cycle poses; dimensions are a planning model, not calibrated production equipment.",
    },
  };
}

export function robotConveyorObstacle(
  conveyor: RobotConveyorModel,
): RobotObstacle {
  const sizeX =
    conveyor.travelAxis === "x"
      ? conveyor.dimensionsMm.length
      : conveyor.dimensionsMm.width;
  const sizeY =
    conveyor.travelAxis === "x"
      ? conveyor.dimensionsMm.width
      : conveyor.dimensionsMm.length;

  return {
    id: CALCULATED_CONVEYOR_OBSTACLE_ID,
    name: "Calculated feed conveyor bed",
    boundsMm: {
      minX: conveyor.centerMm.x - sizeX / 2,
      maxX: conveyor.centerMm.x + sizeX / 2,
      minY: conveyor.centerMm.y - sizeY / 2,
      maxY: conveyor.centerMm.y + sizeY / 2,
    },
    minZMm: conveyor.centerMm.z - conveyor.dimensionsMm.height / 2,
    maxZMm: conveyor.centerMm.z + conveyor.dimensionsMm.height / 2,
  };
}
