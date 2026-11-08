import {
  BUNDLED_UR10E_CELL,
  UR10E_MOUNT_BELOW_CAD_NODE_MM,
} from "~/domain/robotics/ur10eCell";
import type {
  ViewerRobotCellAssetConfig,
  ViewerSceneCalibrationConfig,
} from "./viewerTypes";

export const BUNDLED_ROBOT_CELL = {
  assetUrl: "/models/robot-cell/ur10-palletizer.glb",
  revision:
    "sha256:71f726b56397a93cf953a14f5af8df9ead1969fd56761f1b6e792e8d3d803b7d",
  nodes: {
    root: "robot-cell",
    fixed: "cell-fixed",
    liftCarriage: "lift-carriage",
    // The CAD arm is a flat group of baked part meshes ("Copy of Base/Link1..6"),
    // not a joint chain, so it cannot be posed. Its node only supplies the
    // mount frame of the articulated UR10e and stays hidden; the lift column
    // itself lives under `cell-fixed` and therefore stays visible.
    staticArm: "eSeries_UR10e_1",
  },
  // Articulated UR10e (Universal_Robots_ROS2_Description meshes, BSD-3; see
  // public/models/ur10e/README.md). It is mounted on the lift carriage at the
  // `staticArm` node frame lowered onto the carriage plate, which matches
  // `BUNDLED_UR10E_CELL` (base at viewer (1058.6, 599.5, 732.9) mm, −45° yaw
  // at zero travel).
  articulatedArm: {
    assetUrl: "/models/ur10e/ur10e.glb",
    revision:
      "sha256:08eb736d8864481dde95d3af3e16c3a5d1ea550685dc7f497088b89313ddfbf5",
    mountHeightMm: UR10E_MOUNT_BELOW_CAD_NODE_MM,
  },
  liftTravelMm: BUNDLED_UR10E_CELL.liftTravelMm,
  // Ewellix LIFTKIT: foot at source y = 131.9 mm, carriage plate at 876.9 mm.
  liftColumn: {
    node: "LIFTKIT_UR_900_0000_601R",
    heightMm: 745,
  },
  sourceToViewer: {
    scaleMmPerMeter: 1_000,
    rotationXRad: Math.PI / 2,
    // Calibrated against the CAD assembly: the +90° X rotation maps source
    // (x, y, z) to viewer (x, -z, y), so the translation places the pallet
    // station on the free floor west of the frame. A 800 x 1200 pallet then
    // occupies source x -1200..-400 / z 800..2000, which is clear of every
    // `Palettierer Grundgestell` member and butts against the z 760..800 cross
    // rail. Z is the negated pallet height so viewer z = 0 stays the pallet top
    // face while the cell floor (source y = 0) sits one pallet below it.
    translationMm: {
      x: 1_200,
      y: 2_000,
      z: -144,
    },
  },
  replacesProcedural: {
    // The articulated UR10e replaces the procedural two-link arm; frame, lift
    // column, conveyor and cabinet keep their CAD geometry.
    robot: true,
    conveyor: true,
  },
  evidence: {
    geometry:
      "CAD-derived visual geometry from the supplied cell assembly; articulated UR10e meshes from Universal Robots' ROS 2 description.",
    lift: "CAD-derived vertical travel: 0–900 mm.",
    placement:
      "Viewer placement derived from measured CAD bounding boxes: the pallet station is set on the free floor area west of the machine frame, with the cell floor one pallet height below the viewer origin plane.",
    limitations:
      "UR10e reach, joint limits, singularity proximity and payload are checked at every route waypoint with analytic kinematics and the lift axis. Collisions between the arm and the cell and synchronized lift timing are not checked; the flange-to-suction offset is 137.4 mm, measured on the gripper model.",
  },
} as const satisfies ViewerRobotCellAssetConfig;

export const BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION = {
  robotCellRevision: BUNDLED_ROBOT_CELL.revision,
  palletPose: {
    positionMm: { x: 789, y: -5, z: 0 },
    yawDeg: 90,
  },
  pickupPose: {
    positionMm: { x: 1_492, y: 207, z: 962 },
    yawDeg: -90,
  },
  // Belt top of `Förderband 1,5m Multi` in the viewer frame (CAD part
  // 25.0040_0_108, source y = 909.8 mm); packages stand on it.
  pickupSurfaceZMm: 765.8,
  robotBaseMm: {
    x: BUNDLED_UR10E_CELL.baseMm.x,
    y: BUNDLED_UR10E_CELL.baseMm.y,
  },
} as const satisfies ViewerSceneCalibrationConfig;
